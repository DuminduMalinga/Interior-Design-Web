"""
The ten living-room furniture-arrangement rules.

Each rule is applied in up to three ways, and `RULES` records which:

* **built in** - the generator only ever proposes positions that obey it
  (the coffee table is created 400 mm in front of the sofa, never searched for);
* **hard**     - a position that breaks it is discarded, and `violations()`
  re-checks every such limit on the finished layout;
* **scored**   - a 0..1 mark for how well the layout does, weighted into the
  0-100 total and reported with the measured numbers behind it.

`Evaluator.static()` scores every rule that depends only on where things
stand. Rules 9 and 10 need the walkability map; they are filled in from the
walk once a layout is complete (see `circulation.py`), and assumed perfect
while the search is still comparing candidates.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from .circulation import CirculationReport, open_square
from .config import Config
from .furniture import DESK, LAMP, READING_CHAIR, TIER_ORDER, TIERS, Item, Layout
from .geometry import (
    Point,
    Rect,
    area,
    center,
    clamp01,
    contains,
    distance,
    hits_any,
    intersects,
    segment_hits,
)
from .programme import Programme
from .room import FACING_VECTOR, OPPOSITE, Door, Room, Window


@dataclass(frozen=True)
class Rule:
    id: str
    key: str       # also the name of its weight in config.Weights
    title: str
    text: str      # the rule as written
    method: str    # how the engine applies it


RULES: Tuple[Rule, ...] = (
    Rule("R1", "face_to_face", "Face-to-face conversation",
         "Arrange sofas and chairs to support face-to-face conversation.",
         "Built in: the armchairs stand across the coffee table from the sofa or at its ends, turned to it. "
         "Scored: the distance from seat to seat (0.9 to 2.7 m), and every seat facing the centre of the group."),
    Rule("R2", "views", "Views of other people",
         "Arrange seating furniture to provide suitable views of other people.",
         "Scored: how far each person has to turn to see each of the others (within 60 degrees is no turn at "
         "all), nothing tall standing between them, and the entrance in view from the sofa."),
    Rule("R3", "zones", "Zones where needed",
         "Divide the room into living, dining, and entertainment zones when necessary.",
         "Built in: the sofa, armchairs and TV form one living and entertainment zone on a rug. Hard: a dining "
         "table, desk or reading corner stands at least 600 mm clear of it. Scored: up to 900 mm. Not "
         "applicable when the activities need no second zone."),
    Rule("R4", "clear_openings", "Doors, windows and paths clear",
         "Keep doors, windows, and main walking paths unobstructed.",
         "Hard: nothing stands in a door's swing or landing, and nothing tall in front of a window. Scored: "
         "distance from the furniture to the nearest doorway, window fronts left free, and the straight "
         "line between the doors."),
    Rule("R5", "furniture_fit", "Furniture sized to the room",
         "Select furniture sizes that fit the available room space.",
         "Decides the furniture: compact, standard or generous by floor area, a class down when it does not "
         "fit. Scored: the sofa's length against the room, the class placed, and the planned pieces placed."),
    Rule("R6", "within_reach", "Tables within reach",
         "Position coffee tables and frequently used furniture within comfortable reach of seating areas.",
         "Built in: the coffee table stands 400 mm in front of the sofa. Scored: every seat with a table "
         "within 600 mm, and a side table at the sofa's end."),
    Rule("R7", "daily_activities", "Arranged for daily activities",
         "Arrange furniture according to the household's daily activities.",
         "Decides the furniture: a TV, a dining table, a desk or a reading chair for the activity that needs "
         "it. Hard: the TV at least 1.5 m from the sofa and within 35 degrees of straight ahead. Scored: how "
         "well each activity is provided for."),
    Rule("R8", "openness", "Open, uncrowded room",
         "Maintain visual openness and avoid overcrowding.",
         "Scored: the share of the floor the furniture covers (28 % full marks, 45 % none) and the largest "
         "clear square of floor against the room's shorter side."),
    Rule("R9", "movement", "Easy movement between areas",
         "Position furniture to support comfortable movement between different activity areas.",
         "Hard: one continuous path at least 600 mm wide links the entrance to the seating, every other "
         "zone and every other door. Scored: whether it is 750 or 900 mm wide, and the width of the "
         "seating group's open side."),
    Rule("R10", "accessibility", "Occupants' physical needs",
         "Consider the physical needs and accessibility requirements of occupants.",
         "With mobility needs stated - hard: every path at least 900 mm wide and no loose rug. Scored "
         "always: the path width, a 1.5 m turning space, and a place for a wheelchair in the seating group."),
)
RULE_BY_ID: Dict[str, Rule] = {rule.id: rule for rule in RULES}

ZONE_NAMES = {"dining": "the dining table", "work": "the desk", "reading": "the reading corner"}


@dataclass
class RuleResult:
    """How one layout does against one rule."""

    rule: Rule
    score: float              # 0..1
    weight: float
    detail: str = ""
    applicable: bool = True   # False when the room gives the rule nothing to judge

    @property
    def points(self) -> float:
        return self.weight * self.score if self.applicable else 0.0

    @property
    def status(self) -> str:
        if not self.applicable:
            return "not_applicable"
        if self.score >= 0.75:
            return "satisfied"
        return "partly_satisfied" if self.score >= 0.5 else "not_satisfied"


def metres(mm: float) -> str:
    return "{:.2f} m".format(mm / 1000.0)


def grade(value: float, minimum: float, preferred: float) -> float:
    """Half marks at the hard minimum, full marks at the preferred figure, none at zero."""
    if value >= preferred - 1.0:
        return 1.0
    if value >= minimum - 1.0:
        return 0.5 + 0.5 * (value - minimum) / (preferred - minimum) if preferred > minimum else 1.0
    return 0.5 * clamp01(value / minimum) if minimum > 0 else 0.0


def _mix(parts: List[Tuple[float, float]]) -> float:
    """Weighted mean of (weight, score) pairs."""
    weight = sum(w for w, _ in parts)
    return sum(w * s for w, s in parts) / weight if weight else 0.0


def _join(names: List[str]) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def _mean(values: List[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def front(item: Item) -> Point:
    """The middle of a seat's front edge."""
    x0, y0, x1, y1 = item.rect
    if item.facing == "north":
        return ((x0 + x1) / 2.0, y1)
    if item.facing == "south":
        return ((x0 + x1) / 2.0, y0)
    if item.facing == "east":
        return (x1, (y0 + y1) / 2.0)
    return (x0, (y0 + y1) / 2.0)


def turn(item: Item, target: Point) -> float:
    """Degrees between the way a piece faces and the direction from its centre to `target`."""
    cx, cy = center(item.rect)
    dx, dy = target[0] - cx, target[1] - cy
    length = math.hypot(dx, dy)
    if length < 1.0:
        return 0.0
    fx, fy = FACING_VECTOR[item.facing]
    return math.degrees(math.acos(max(-1.0, min(1.0, (dx * fx + dy * fy) / length))))


class Evaluator:
    """Scores a layout against the ten rules and re-checks every hard limit."""

    def __init__(self, room: Room, doors: List[Door], windows: List[Window], programme: Programme, config: Config):
        self.room = room
        self.doors = doors
        self.windows = windows
        self.programme = programme
        self.config = config
        self.c = config.clearances
        self.main_door: Optional[Door] = next((d for d in doors if d.is_main), None)
        self.door_point: Optional[Point] = self.main_door.center(room) if self.main_door else None
        self.door_zones = [d.keep_clear(room, self.c.door_entry_depth) for d in doors]
        self.window_bands = [(w, w.access(room, self.c.window_access_depth)) for w in windows]
        self.weights = {rule.id: float(getattr(config.weights, rule.key)) for rule in RULES}
        #: rule 10 widens every path when an occupant has mobility needs
        self.path_widths = self.c.accessible_path_widths if programme.accessible else self.c.path_widths
        self.path_min = min(self.path_widths)
        #: the size class the floor area asks for; the one placed may be smaller
        self.planned_tier = TIERS[programme.tier]

    # ------------------------------------------------------------------ #
    def _result(self, rule_id: str, score: float, detail: str = "") -> RuleResult:
        return RuleResult(RULE_BY_ID[rule_id], clamp01(score), self.weights[rule_id], detail)

    def _skip(self, rule_id: str, detail: str) -> RuleResult:
        return RuleResult(RULE_BY_ID[rule_id], 0.0, self.weights[rule_id], detail, applicable=False)

    def static(self, lay: Layout, explain: bool = False, final: bool = False,
               openness: bool = True) -> Dict[str, RuleResult]:
        """Rules 1 to 8.

        Before a layout is `final` the pieces still to come - the other zones,
        the side tables - are assumed to be placed, and placed well, so the
        mark is the best the seating group could still reach. `openness=False`
        leaves out the one costly measurement while positions are being sifted.
        """
        results = {
            "R1": self._conversation(lay, explain),
            "R2": self._views(lay, explain),
            "R3": self._zones(lay, explain, final),
            "R4": self._openings(lay, explain),
            "R5": self._fit(lay, explain, final),
            "R6": self._reach(lay, explain, final),
            "R7": self._activities(lay, explain, final),
        }
        results["R8"] = self._openness(lay, explain) if openness else self._result("R8", 1.0)
        return results

    @staticmethod
    def total(results: Dict[str, RuleResult]) -> float:
        """0-100: points earned out of the points the applicable rules could give."""
        weight = sum(r.weight for r in results.values() if r.applicable)
        return 100.0 * sum(r.points for r in results.values()) / weight if weight else 0.0

    # ------------------------------------------------------------------ #
    # measurements shared by the rules, the search and the hard-limit re-check
    # ------------------------------------------------------------------ #
    def tall(self, item: Item, window: Window) -> bool:
        """Would this piece cover the window? The TV unit counts: the screen hangs above it."""
        return item.type == "tv_console" or item.height > window.sill_height

    def obstacles(self, lay: Layout) -> List[Rect]:
        """Everything that takes up floor, pushed-in chairs included (the rug does not)."""
        return [i.rect for i in lay.solids] + [i.rect for i in lay.loose if i.type in ("dining_chair", "desk_chair")]

    def coverage(self, lay: Layout) -> float:
        return sum(area(r) for r in self.obstacles(lay)) / (self.room.width * self.room.length)

    def open_square(self, lay: Layout) -> float:
        return open_square(self.room.rect, self.obstacles(lay))

    def tv_angle(self, lay: Layout) -> float:
        """Degrees the TV stands off straight ahead of the middle of the sofa."""
        if lay.console is None or lay.view <= 0:
            return 0.0
        back = OPPOSITE[lay.facing]
        s0, s1 = self.room.along(back, lay.sofa.rect)
        t0, t1 = self.room.along(back, lay.console.rect)
        return math.degrees(math.atan(abs((t0 + t1) - (s0 + s1)) / 2.0 / lay.view))

    def room_for_zones(self, lay: Layout) -> bool:
        """Does the floor round the seating group leave a place for every other zone that is planned?"""
        c, room = self.c, self.room
        x0, y0, x1, y1 = lay.group_box
        gap = c.zone_gap_min
        strips = [(x0 - gap, room.length), (room.width - x1 - gap, room.length),
                  (room.width, y0 - gap), (room.width, room.length - y1 - gap)]
        needs = {
            "dining": (lay.tier.dining.length, lay.tier.dining.width + 2 * c.chair_pull_min),
            "work": (DESK.width, DESK.depth + c.desk_chair_space),
            "reading": (READING_CHAIR.width + LAMP.width, READING_CHAIR.depth + c.armchair_front),
        }
        for kind in self.programme.zones:
            a, b = needs[kind]
            if not any((w >= a and h >= b) or (w >= b and h >= a) for w, h in strips):
                return False
        return True

    def wheelchair_place(self, lay: Layout) -> Optional[str]:
        """Rule 10: where in the seating group a wheelchair can pull up, if anywhere."""
        c, room = self.c, self.room
        back = OPPOSITE[lay.facing]
        w, d = c.transfer_width, c.transfer_depth
        s0, s1 = room.along(back, lay.sofa.rect)
        t0, t1 = room.along(back, lay.coffee.rect)
        v0, v1 = room.out_from(back, lay.coffee.rect)
        mid_u, mid_v = (t0 + t1) / 2.0, (v0 + v1) / 2.0
        options = [
            ("across the coffee table from the sofa", room.band(back, mid_u - w / 2, mid_u + w / 2, d, v1)),
            ("at the end of the coffee table", room.band(back, t0 - d, t0, w, mid_v - w / 2)),
            ("at the end of the coffee table", room.band(back, t1, t1 + d, w, mid_v - w / 2)),
            ("beside the sofa", room.band(back, s0 - w, s0, d, lay.offset)),
            ("beside the sofa", room.band(back, s1, s1 + w, d, lay.offset)),
        ]
        solids = [i.rect for i in lay.solids]
        for name, rect in options:
            if contains(room.rect, rect) and not hits_any(rect, solids) and not hits_any(rect, self.door_zones):
                return name
        return None

    def route_lines(self, lay: Layout) -> Tuple[int, int]:
        """Rule 4: (straight routes the furniture stands across, routes there are)."""
        if self.main_door is None:
            return (0, 0)
        room, c = self.room, self.c
        solids = [i.rect for i in lay.solids]
        others = [d for d in self.doors if not d.is_main]
        if others:
            crossed = sum(1 for d in others
                          if any(segment_hits(self.door_point, d.center(room), r) for r in solids))
            return (crossed, len(others))
        door = self.main_door
        ahead = room.band(door.wall, door.start, door.end, c.route_ahead)
        return (1 if hits_any(ahead, solids) else 0, 1)

    # ------------------------------------------------------------------ #
    def _conversation(self, lay: Layout, explain: bool) -> RuleResult:
        c = self.c
        seats = lay.seats
        if len(seats) < 2:
            return self._result("R1", 0.5, "Only the {} fits, so people sit side by side on it rather than face "
                                "to face.".format(lay.sofa.label) if explain else "")
        gaps: List[float] = []
        marks: List[float] = []
        for i, a in enumerate(seats):
            for b in seats[i + 1:]:
                pa, pb = front(a), front(b)
                gap = math.hypot(pa[0] - pb[0], pa[1] - pb[1])
                gaps.append(gap)
                if gap < c.conversation_near:
                    marks.append(gap / c.conversation_near)
                elif gap <= c.conversation_far:
                    marks.append(1.0)
                else:
                    marks.append(clamp01((c.conversation_limit - gap) / (c.conversation_limit - c.conversation_far)))
        focus = center(lay.coffee.rect)
        turned = [s for s in seats if turn(s, focus) <= c.facing_angle]
        wanted = 1 + self.programme.chairs
        score = (0.6 * _mean(marks) + 0.4 * len(turned) / float(len(seats)))             * (0.7 + 0.3 * min(len(seats) / float(wanted), 1.0))
        if not explain:
            return self._result("R1", score)
        people = sum(s.seats for s in seats)
        detail = "{} seats on {} pieces round the coffee table, {} to {} apart front to front (talking is easy "                  "between {} and {}); {} of the {} pieces face the centre of the group".format(
                     people, len(seats), metres(min(gaps)), metres(max(gaps)), metres(c.conversation_near),
                     metres(c.conversation_far), len(turned), len(seats))
        if len(seats) < wanted:
            detail += "; {} of the {} armchairs planned {} left out".format(
                wanted - len(seats), self.programme.chairs, "is" if wanted - len(seats) == 1 else "are")
        return self._result("R1", score, detail + ".")

    def _views(self, lay: Layout, explain: bool) -> RuleResult:
        c = self.c
        seats = lay.seats
        screens = [i.rect for i in lay.solids if i.height > c.eye_height]
        marks: List[float] = []
        blocked = 0
        for a in seats:
            for b in seats:
                if a is b:
                    continue
                if any(segment_hits(center(a.rect), center(b.rect), r) for r in screens):
                    blocked += 1
                    marks.append(0.0)
                    continue
                marks.append(clamp01((c.sight_none - turn(a, center(b.rect))) / (c.sight_none - c.sight_full)))
        parts: List[Tuple[float, float]] = [(0.75, _mean(marks) if marks else 0.5)]
        notes = ["Each person sees the others {}".format(
            "without turning" if marks and min(marks) >= 0.999 else
            "with at most a turn of the head" if marks and min(marks) >= 0.5 else
            "only by turning round" if marks else "only by turning to the person beside them")]
        if blocked:
            notes.append("tall furniture stands between {} pair{} of seats".format(blocked, "" if blocked == 1 else "s"))
        if self.door_point is not None:
            seen = turn(lay.sofa, self.door_point) <= c.entrance_angle
            parts.append((0.25, 1.0 if seen else 0.3))
            notes.append("the entrance is {} from the sofa".format("in view" if seen else "behind the people sitting on it"))
        return self._result("R2", _mix(parts), "; ".join(notes) + "." if explain else "")

    def _zones(self, lay: Layout, explain: bool, final: bool) -> RuleResult:
        c = self.c
        planned = self.programme.zones
        if not planned:
            return self._skip("R3", "The activities planned need one zone only: the seating group{}.".format(
                " and its TV" if lay.console is not None else ""))
        if not final:
            return self._result("R3", 1.0 if self.room_for_zones(lay) else 0.4)
        marks, notes = [], []
        box = lay.group_box
        for kind in planned:
            zone = lay.zone(kind)
            if zone is None:
                marks.append(0.0)
                notes.append("{} found no place of its own".format(ZONE_NAMES[kind]))
                continue
            gap = distance(zone.box, box)
            marks.append(grade(gap, c.zone_gap_min, c.zone_gap_preferred))
            notes.append("{} stands {} clear of the seating".format(ZONE_NAMES[kind], metres(gap)))
        detail = "Living zone{} round the sofa; {} ({} wanted between zones).".format(
            " on its rug" if lay.find("rug") else "", "; ".join(notes), metres(c.zone_gap_preferred))
        return self._result("R3", _mean(marks), detail if explain else "")

    def _openings(self, lay: Layout, explain: bool) -> RuleResult:
        c, room = self.c, self.room
        solids = lay.solids
        parts: List[Tuple[float, float]] = []
        notes: List[str] = []
        if self.doors:
            gap = min(distance(i.rect, d.opening(room)) for i in solids for d in self.doors)
            parts.append((0.4, clamp01((gap - c.door_gap_min) / (c.door_gap_good - c.door_gap_min))))
            notes.append("every door's swing and landing is clear, with the nearest piece {} from a doorway".format(
                metres(gap)))
        if self.window_bands:
            taken = [w.id for w, band in self.window_bands if any(intersects(i.rect, band) for i in solids)]
            parts.append((0.3, 1.0 - len(taken) / float(len(self.window_bands))))
            notes.append("the floor in front of every window is free" if not taken
                         else "low furniture stands in front of window {}".format(_join(taken)))
        crossed, routes = self.route_lines(lay)
        if routes:
            parts.append((0.3, 1.0 - crossed / float(routes)))
            through = len(self.doors) > 1
            notes.append(("the straight line between the doors {} the furniture" if through
                          else "the floor straight ahead of the door is {} furniture").format(
                ("crosses" if through else "taken by") if crossed else ("misses" if through else "free of")))
        if not parts:
            return self._skip("R4", "No door or window was detected on this room's walls.")
        return self._result("R4", _mix(parts), "; ".join(notes).capitalize() + "." if explain else "")

    def planned_pieces(self) -> int:
        """How many pieces the programme asks for (rule 5)."""
        programme = self.programme
        return (2 + programme.chairs + (1 if programme.tv else 0) + self.planned_tier.side_tables
                + len(programme.zones))

    def _fit(self, lay: Layout, explain: bool, final: bool) -> RuleResult:
        c = self.c
        along = self.room.wall_length(OPPOSITE[lay.facing])
        ratio = lay.sofa.width / along
        length = clamp01((c.sofa_wall_max - ratio) / (c.sofa_wall_max - c.sofa_wall_ideal))
        down = TIER_ORDER.index(lay.tier.name) - TIER_ORDER.index(self.programme.tier)
        size = (1.0, 0.7, 0.5)[min(max(down, 0), 2)]
        planned = self.planned_pieces()
        placed = planned - len(lay.unplaced) if final else planned
        score = 0.4 * length + 0.3 * size + 0.3 * max(placed, 0) / float(planned)
        if not explain:
            return self._result("R5", score)
        detail = "{} furniture for {:.1f} m2".format(lay.tier.name.capitalize(), self.room.area_m2)
        if down > 0:
            detail += " (the {} class did not fit)".format(self.programme.tier)
        detail += "; the {} takes {:.0f}% of the {} it stands along; {} of {} planned pieces placed.".format(
            lay.sofa.label, 100 * ratio, metres(along), max(placed, 0), planned)
        return self._result("R5", score, detail)

    def _reach(self, lay: Layout, explain: bool, final: bool) -> RuleResult:
        c = self.c
        tables = [lay.coffee] + lay.find("side_table")
        seats = lay.seats
        served = [s for s in seats if min(distance(s.rect, t.rect) for t in tables) <= c.reach + 1.0]
        gap = distance(lay.sofa.rect, lay.coffee.rect)
        in_range = c.reach_gap_min - 1.0 <= gap <= c.reach_gap_max + 1.0
        wanted = self.planned_tier.side_tables
        beside = len(lay.find("side_table")) if final else wanted
        score = _mix([(0.5, len(served) / float(len(seats))), (0.3, 1.0 if in_range else 0.3),
                      (0.2, min(beside / float(wanted), 1.0) if wanted else 1.0)])
        if not explain:
            return self._result("R6", score)
        return self._result("R6", score, "The coffee table is {} in front of the sofa; {} of {} seating pieces "
                            "have a table within {}; {} of {} side tables stand at the sofa's end.".format(
                                metres(gap), len(served), len(seats), metres(c.reach), beside, wanted))

    def _tv_marks(self, lay: Layout) -> Tuple[float, float]:
        c = self.c
        view = lay.view
        if view < c.tv_near:
            far = 0.5 + 0.5 * clamp01((view - c.tv_min) / (c.tv_near - c.tv_min))
        elif view <= c.tv_far:
            far = 1.0
        else:
            far = clamp01((c.tv_limit - view) / (c.tv_limit - c.tv_far))
        angle = clamp01((c.tv_angle_max - self.tv_angle(lay)) / (c.tv_angle_max - c.tv_angle_full))
        return far, angle

    def _daylight(self, rect: Rect) -> Optional[float]:
        if not self.windows:
            return None
        gap = min(distance(rect, w.access(self.room, 0.0)) for w in self.windows)
        c = self.c
        return clamp01((c.daylight_far - gap) / (c.daylight_far - c.daylight_near))

    def _activities(self, lay: Layout, explain: bool, final: bool) -> RuleResult:
        programme = self.programme
        marks: List[float] = []
        notes: List[str] = []
        for activity in programme.activities:
            if activity == "conversation":
                placed = sum(s.seats for s in lay.seats)
                wanted = self.planned_tier.sofa.seats + programme.chairs
                marks.append((1.0 if len(lay.seats) > 1 else 0.6) * min(placed / float(wanted), 1.0))
                notes.append("conversation - {} seats in one group{}".format(
                    placed, "" if placed >= wanted else ", {} planned".format(wanted)))
            elif activity == "tv":
                if lay.console is None:
                    marks.append(0.0)
                    notes.append("TV - no wall had room for the TV unit")
                    continue
                far, angle = self._tv_marks(lay)
                marks.append(0.6 * far + 0.4 * angle)
                notes.append("TV - on the {} wall, {} from the sofa and {:.0f} degrees off straight ahead".format(
                    lay.console.wall, metres(lay.view), self.tv_angle(lay)))
            elif not final:
                marks.append(1.0)
            elif activity == "dining":
                table = next(iter(lay.find("dining_table")), None)
                if table is None:
                    marks.append(0.0)
                    notes.append("dining - no room for a table with space to pull the chairs out")
                else:
                    seats = len(lay.find("dining_chair"))
                    marks.append(min(seats / float(self.planned_tier.dining.seats), 1.0))
                    notes.append("dining - {} with {} chairs".format(table.label, seats))
            elif activity == "work":
                desk = next(iter(lay.find("desk")), None)
                if desk is None:
                    marks.append(0.0)
                    notes.append("work - no wall had room for a desk")
                else:
                    day = self._daylight(desk.rect)
                    marks.append(1.0 if day is None else 0.7 + 0.3 * day)
                    notes.append("work - desk on the {} wall".format(desk.wall))
            elif activity == "reading":
                chair = next(iter(lay.find("reading_chair")), None)
                if chair is None:
                    marks.append(0.0)
                    notes.append("reading - no wall had room for a reading chair")
                else:
                    day = self._daylight(chair.rect)
                    marks.append(1.0 if day is None else 0.7 + 0.3 * day)
                    notes.append("reading - chair and lamp on the {} wall{}".format(
                        chair.wall, ", with a bookshelf" if lay.find("bookshelf") else ""))
        if not explain:
            return self._result("R7", _mean(marks))
        basis = "as given" if programme.activities_source == "provided" else "assumed for this room"
        return self._result("R7", _mean(marks), "Activities {}: {}.".format(basis, "; ".join(notes)))

    def _openness(self, lay: Layout, explain: bool) -> RuleResult:
        t = self.config.rooms
        ratio = self.coverage(lay)
        cover = clamp01((t.overcrowded_ratio - ratio) / (t.overcrowded_ratio - t.crowded_ratio))
        square = self.open_square(lay)
        short = min(self.room.width, self.room.length)
        share = square / short
        open_ = clamp01((share - t.open_square_min) / (t.open_square_good - t.open_square_min))
        score = 0.5 * cover + 0.5 * open_
        if not explain:
            return self._result("R8", score)
        return self._result("R8", score, "The furniture covers {:.0f}% of the {:.1f} m2 floor; the largest clear "
                            "square of floor is {} across, {:.0f}% of the room's shorter side.".format(
                                100 * ratio, self.room.area_m2, metres(square), 100 * share))

    # ------------------------------------------------------------------ #
    # the two rules that need the walk
    # ------------------------------------------------------------------ #
    def movement_result(self, lay: Layout, report: CirculationReport) -> RuleResult:
        """Rule 9, from the walkability report."""
        c = self.c
        top, low = max(self.path_widths), self.path_min
        side = grade(lay.open_gap, low, top)
        tail = "the seating group's open side is {} wide".format(metres(lay.open_gap))
        if not report.checked:
            return self._result("R9", side, "No door was detected to walk from; {}.".format(tail))
        if not report.valid:
            return self._result("R9", 0.0, "No path {} wide reaches {}.".format(
                metres(low), _join(report.unreachable) if report.unreachable else "the seating"))
        width = 1.0 if report.width >= top else 0.6 + 0.4 * max(report.width - low, 0.0) / ((top - low) or 1.0)
        areas = ["the seating"] + [ZONE_NAMES[z.kind] for z in lay.zones]
        if len(self.doors) > 1:
            areas.append("the other door{}".format("" if len(self.doors) == 2 else "s"))
        detail = "A continuous path {} wide links the entrance to {}".format(metres(report.width), _join(areas))
        if report.reached_ratio < c.cut_off_tolerance:
            width *= report.reached_ratio / c.cut_off_tolerance
            detail += "; {:.0f}% of the open floor cannot be walked on to".format(100 * (1 - report.reached_ratio))
        return self._result("R9", 0.7 * width + 0.3 * side, "{}; {}.".format(detail, tail))

    def access_result(self, lay: Layout, report: CirculationReport) -> RuleResult:
        """Rule 10, from the walkability report."""
        c = self.c
        need = self.programme.accessible
        wide, widest = c.accessible_path_widths[-1], c.accessible_path_widths[0]
        parts: List[Tuple[float, float]] = []
        notes: List[str] = []
        if report.checked:
            if not report.valid:
                parts.append((0.4, 0.0))
                notes.append("no continuous path reaches every area")
            else:
                parts.append((0.4, grade(report.width, wide, widest) if need else clamp01(report.width / wide)))
                notes.append("the path through the room is {} wide ({} lets a wheelchair or a walking frame "
                             "through)".format(metres(report.width), metres(wide)))
        square = self.open_square(lay)
        parts.append((0.35, clamp01(square / c.turning_space)))
        notes.append("the largest clear square of floor is {} across ({} is needed to turn a wheelchair)".format(
            metres(square), metres(c.turning_space)))
        place = self.wheelchair_place(lay)
        parts.append((0.25, 1.0 if place else 0.0))
        notes.append("a wheelchair can pull up {}".format(place) if place
                     else "the seating group has no free place for a wheelchair")
        if need:
            notes.append("no loose rug was laid")
        lead = "Planned for an occupant with mobility needs" if need else "No mobility needs were stated"
        return self._result("R10", _mix(parts), "{}: {}.".format(lead, "; ".join(notes)))

    # ------------------------------------------------------------------ #
    # hard limits, re-checked on the finished layout
    # ------------------------------------------------------------------ #
    def violations(self, lay: Layout, report: Optional[CirculationReport]) -> List[Dict]:
        """Every hard limit a finished layout breaks (empty for a valid one)."""
        room, c = self.room, self.c
        found: List[Dict] = []

        def add(rule_id: str, check: str, message: str, subject: str = "") -> None:
            found.append({
                "rule": RULE_BY_ID[rule_id].key, "rule_id": rule_id, "check": check,
                "message": message, "subject": subject,
            })

        solids = lay.solids
        for index, item in enumerate(solids):
            name = item.label or item.type
            if not contains(room.rect, item.rect):
                add("R5", "boundary", "The {} extends outside the room.".format(name), item.id)
            for other in solids[index + 1:]:
                if intersects(item.rect, other.rect):
                    add("R8", "overlap", "The {} overlaps the {}.".format(name, other.label or other.type), item.id)
            for door, zone in zip(self.doors, self.door_zones):
                if intersects(item.rect, zone):
                    add("R4", "door", "The {} stands where door {} needs to open.".format(name, door.id), item.id)
            for window, band in self.window_bands:
                if self.tall(item, window) and intersects(item.rect, band):
                    add("R4", "window", "The {} stands in front of window {}.".format(name, window.id), item.id)

        gap = distance(lay.sofa.rect, lay.coffee.rect)
        if not c.reach_gap_min - 1.0 <= gap <= c.reach_gap_max + 1.0:
            add("R6", "reach", "The coffee table is {:.0f} mm from the sofa; it belongs between {:.0f} and "
                "{:.0f} mm.".format(gap, c.reach_gap_min, c.reach_gap_max), lay.coffee.id)
        if lay.console is not None:
            if lay.view < c.tv_min - 1.0:
                add("R7", "tv_distance", "The TV is only {:.0f} mm from the sofa; {:.0f} mm is needed.".format(
                    lay.view, c.tv_min), lay.console.id)
            if self.tv_angle(lay) > c.tv_angle_max + 0.5:
                add("R7", "tv_angle", "The TV stands {:.0f} degrees off straight ahead of the sofa.".format(
                    self.tv_angle(lay)), lay.console.id)
        if lay.open_gap < self.path_min - 1.0:
            add("R9", "open_side", "Only {:.0f} mm is clear on the open side of the seating group; {:.0f} mm is "
                "needed to walk in.".format(lay.open_gap, self.path_min), lay.sofa.id)
        box = lay.group_box
        for zone in lay.zones:
            if distance(zone.box, box) < c.zone_gap_min - 1.0:
                add("R3", "zone_gap", "Only {:.0f} mm separates {} from the seating; {:.0f} mm is needed.".format(
                    distance(zone.box, box), ZONE_NAMES[zone.kind], c.zone_gap_min))
        if self.programme.accessible and lay.find("rug"):
            add("R10", "rug", "A loose rug is a trip hazard for an occupant with mobility needs.")
        if report is not None and report.checked and not report.valid:
            add("R9", "path", "No path at least {:.0f} mm wide links the entrance to {}.".format(
                self.path_min, _join(report.unreachable) if report.unreachable else "the seating"))
        return found
