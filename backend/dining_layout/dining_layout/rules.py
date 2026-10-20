"""
The twelve dining-area furniture-arrangement rules.

Each rule is applied in up to three ways, and `RULES` records which:

* **built in** - the generator only ever proposes positions that obey it
  (a chair is created every seat-width along the table, never searched for);
* **hard**     - a position that breaks it is discarded, and `violations()`
  re-checks every such limit on the finished layout;
* **scored**   - a 0..1 mark for how well the layout does, weighted into the
  0-100 total and reported with the measured numbers behind it.

`Evaluator.static()` scores every rule that depends only on where things
stand. Rule 3 and part of rule 9 need the walkability map; they are filled in
from the walk once a layout is complete (see `circulation.py`), and assumed
perfect while the search is still comparing candidates.

The rules score is then converted to 90 points, and the extra `FURNITURE_RULE`
adds the last 10, rewarding the layout with the most furniture.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from .circulation import CirculationReport
from .config import Config
from .furniture import Item, Layout
from .geometry import (
    Point,
    Rect,
    area,
    beyond,
    center,
    clamp01,
    contains,
    distance,
    intersects,
    point_gap,
    segment_hits,
)
from .programme import Programme
from .room import Door, Room, Window

SIDES = ("north", "east", "south", "west")


@dataclass(frozen=True)
class Rule:
    id: str
    key: str       # also the name of its weight in config.Weights
    title: str
    text: str      # the rule as written
    method: str    # how the engine applies it


RULES: Tuple[Rule, ...] = (
    Rule("R1", "table_access", "Table easy to reach",
         "Place the dining table where occupants can access it easily.",
         "Hard: every side with chairs can be walked to from the entrance. Scored: the distance from "
         "the doorway to the table, and nothing standing in the direct line."),
    Rule("R2", "chair_pullout", "Room to pull chairs out",
         "Leave sufficient space around the table for chairs to be pulled out.",
         "Hard: 0.70 m from the table edge to a wall or furniture on every side with chairs. "
         "Scored: up to 0.90 m."),
    Rule("R3", "table_paths", "Clear paths round the table",
         "Keep clear walking paths around the dining table and chairs.",
         "Hard: one continuous path at least 0.60 m wide reaches every side with chairs. Scored: whether "
         "it is 0.75 or 0.90 m wide, and on how many sides someone can pass behind a seated person (1.1 m)."),
    Rule("R4", "table_size", "Table sized to the floor",
         "Select a dining table size that fits the available floor space.",
         "Decides the table: the largest that fits with every clearance, a size down when it does not. "
         "Scored: the share of the floor the table and its seated diners cover."),
    Rule("R5", "seating_comfort", "Comfortable seating",
         "Arrange chairs so occupants can sit down and stand up comfortably.",
         "Built in: one chair per 0.60 m of table edge. Scored: the table edge each person gets and "
         "free elbows for the chairs at the table's ends."),
    Rule("R6", "openings_clear", "Doors, windows and entrances clear",
         "Position the dining table to avoid blocking doors, windows, and entrances.",
         "Hard: the table and its pulled-out chairs stay out of every door's swing and landing. "
         "Scored: distance from the table to the nearest doorway, and window fronts left free."),
    Rule("R7", "furniture_gap", "Space to nearby furniture",
         "Keep sufficient space between the dining table and nearby furniture.",
         "Hard: 0.90 m between the table and the sideboard when chairs stand between them, 0.60 m "
         "otherwise. Scored: up to 1.2 m."),
    Rule("R8", "kitchen_proximity", "Close to the kitchen",
         "Position the dining area close to the kitchen when practical.",
         "Scored: the distance from the table to the kitchen door, or to the wall nearest the kitchen. "
         "Not applicable when the plan shows no kitchen nearby."),
    Rule("R9", "main_route", "Main route unobstructed",
         "Ensure that the dining table does not obstruct the main circulation route.",
         "Scored: with every chair occupied, a 0.75 m path still links the entrance to the other doors "
         "and the sideboard, and the straight line between doors misses the diners."),
    Rule("R10", "lighting", "Light over the table",
         "Arrange lighting to provide sufficient illumination over the dining table.",
         "Built in: a pendant centred over the table, 0.75 m above its top (two over a long table). "
         "Scored: daylight - how near the table stands to a window."),
    Rule("R11", "items_in_reach", "Dining items within reach",
         "Keep frequently used dining items within convenient reach.",
         "Scored: the sideboard that holds tableware stands within 1.5 m of the table. Not applicable "
         "when the room is too small for a sideboard."),
    Rule("R12", "occupants_fit", "Fit to occupants and use",
         "Arrange the dining furniture according to the number of occupants and expected use.",
         "Decides the number of seats (from the occupants given, or the floor area) and the sideboard. "
         "Scored: seats placed out of seats wanted."),
)
RULE_BY_ID: Dict[str, Rule] = {rule.id: rule for rule in RULES}

#: the extra rule, scored last: it compares a layout with the others generated
#: for the same room, so it is added once they are all chosen (see generator.py)
FURNITURE_RULE = Rule(
    "R13", "furniture_count", "Most furniture",
    "Give the most points to the layout that fits the most furniture.",
    "Scored after the rules score is converted to 90 points: the layout with the most furniture for this room "
    "earns all 10 and one piece fewer earns 5; below that the points fall evenly with each piece fewer, to 0 "
    "with no furniture.")


def furniture_mark(count: int, most: int) -> float:
    """The extra rule's 0..1 mark for `count` pieces when the fullest layout has `most`.

    Full marks for the most furniture, half for one piece fewer, then falling
    evenly with each piece fewer, to nothing with no furniture.
    """
    if count >= most:
        return 1.0
    return 0.5 * count / (most - 1) if most > 1 else 0.0


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


@dataclass
class Walk:
    """What only walking a finished layout can tell."""

    occupied_ok: Optional[bool] = None    # rule 9: the route survives every chair being occupied
    route_targets: int = 0                # how many places that route had to reach


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


class Evaluator:
    """Scores a layout against the twelve rules and re-checks every hard limit."""

    def __init__(self, room: Room, doors: List[Door], windows: List[Window], programme: Programme, config: Config,
                 kitchen: Optional[Tuple[Point, str]] = None):
        self.room = room
        self.doors = doors
        self.windows = windows
        self.programme = programme
        self.config = config
        self.c = config.clearances
        self.kitchen = kitchen             # (point on this room's boundary, "door" | "wall")
        self.main_door: Optional[Door] = next((d for d in doors if d.is_main), None)
        self.door_point: Optional[Point] = self.main_door.center(room) if self.main_door else None
        # every patch of floor nothing may stand on: each door's sweep, then the
        # parts of a non-rectangular room's box that are not floor. The doors
        # come first, so zip(self.doors, self.door_zones) still pairs them up.
        self.door_zones = [d.keep_clear(room, self.c.door_entry_depth) for d in doors] + list(room.cutouts)
        self.window_bands = [(w, w.access(room, self.c.window_access_depth)) for w in windows]
        self.weights = {rule.id: float(getattr(config.weights, rule.key)) for rule in RULES}

    # ------------------------------------------------------------------ #
    def _result(self, rule_id: str, score: float, detail: str = "") -> RuleResult:
        return RuleResult(RULE_BY_ID[rule_id], clamp01(score), self.weights[rule_id], detail)

    def _skip(self, rule_id: str, detail: str) -> RuleResult:
        return RuleResult(RULE_BY_ID[rule_id], 0.0, self.weights[rule_id], detail, applicable=False)

    def static(self, lay: Layout, explain: bool = False, walk: Optional[Walk] = None) -> Dict[str, RuleResult]:
        """Every rule but the walking paths. Without a `walk`, the part of rule 9 that needs one is assumed perfect."""
        return {
            "R1": self._table_access(lay, explain),
            "R2": self._chair_pullout(lay, explain),
            "R4": self._table_size(lay, explain),
            "R5": self._seating_comfort(lay, explain),
            "R6": self._openings_clear(lay, explain),
            "R7": self._furniture_gap(lay, explain),
            "R8": self._kitchen(lay, explain),
            "R9": self._main_route(lay, explain, walk),
            "R10": self._lighting(lay, explain),
            "R11": self._items_in_reach(lay, explain),
            "R12": self._occupants_fit(lay, explain),
        }

    @staticmethod
    def total(results: Dict[str, RuleResult]) -> float:
        """0-100: points earned out of the points the applicable rules could give."""
        weight = sum(r.weight for r in results.values() if r.applicable)
        return 100.0 * sum(r.points for r in results.values()) / weight if weight else 0.0

    # ------------------------------------------------------------------ #
    # measurements shared by the rules and the hard-limit re-check
    # ------------------------------------------------------------------ #
    def clearances(self, lay: Layout) -> Dict[str, float]:
        """Clear floor from each edge of the table to the wall or the sideboard beyond it."""
        room, t = self.room, lay.table.rect
        out = {"east": room.width - t[2], "west": t[0], "north": room.length - t[3], "south": t[1]}
        if lay.sideboard is not None:
            s = lay.sideboard.rect
            gaps = {"east": s[0] - t[2], "west": t[0] - s[2], "north": s[1] - t[3], "south": t[1] - s[3]}
            for side in SIDES:
                if out[side] > 0 and intersects(beyond(t, side, out[side]), s):
                    out[side] = max(min(out[side], gaps[side]), 0.0)
        return out

    @staticmethod
    def envelope(lay: Layout, depth: float) -> Rect:
        """The table grown by `depth` on every side that has chairs."""
        x0, y0, x1, y1 = lay.table.rect
        sides = lay.chair_sides
        return (x0 - depth * ("west" in sides), y0 - depth * ("south" in sides),
                x1 + depth * ("east" in sides), y1 + depth * ("north" in sides))

    def seat_zones(self, lay: Layout) -> List[Tuple[str, Rect]]:
        """Where a person stands to pull a chair out, one zone per side with chairs."""
        return [("the {} side of the table".format(side), beyond(lay.table.rect, side, self.c.chair_pull_min))
                for side in lay.chair_sides]

    # ------------------------------------------------------------------ #
    def _table_access(self, lay: Layout, explain: bool) -> RuleResult:
        if self.door_point is None:
            return self._skip("R1", "No door was detected, so there is no entrance to measure from.")
        c = self.c
        gap = point_gap(self.door_point, lay.table.rect)
        near = clamp01((c.table_door_far - gap) / (c.table_door_far - c.table_door_near))
        blocked = lay.sideboard is not None and segment_hits(
            self.door_point, center(lay.table.rect), lay.sideboard.rect)
        score = 0.7 * near + 0.3 * (0.0 if blocked else 1.0)
        if not explain:
            return self._result("R1", score)
        return self._result("R1", score, "The table is {} from the doorway; {}.".format(
            metres(gap), "the sideboard stands in the direct line to it" if blocked
            else "nothing stands in the direct line to it"))

    def _chair_pullout(self, lay: Layout, explain: bool) -> RuleResult:
        c = self.c
        clear = self.clearances(lay)
        tightest = min(lay.chair_sides, key=lambda side: clear[side])
        score = grade(clear[tightest], c.chair_pull_min, c.chair_pull_preferred)
        if not explain:
            return self._result("R2", score)
        listed = ", ".join("{} {}".format(side, metres(clear[side])) for side in lay.chair_sides)
        return self._result("R2", score, "Behind the chairs: {} ({} needed to pull a chair out, {} to do it "
                            "comfortably).".format(listed, metres(c.chair_pull_min), metres(c.chair_pull_preferred)))

    def path_result(self, lay: Layout, report: CirculationReport) -> RuleResult:
        """Rule 3, from the walkability report."""
        c = self.c
        clear = self.clearances(lay)
        passable = [side for side in lay.chair_sides if clear[side] >= c.walk_behind - 1.0]
        behind = len(passable) / float(len(lay.chair_sides))
        tail = "someone can pass behind a seated person on {} of the {} sides with chairs ({} needed)".format(
            len(passable), len(lay.chair_sides), metres(c.walk_behind))
        if not report.checked:
            return self._result("R3", behind, "No door was detected to walk from; {}.".format(tail))
        if not report.valid:
            return self._result("R3", 0.0, "No path {} wide reaches {}.".format(
                metres(c.path_min), _join(report.unreachable) if report.unreachable else "the table"))
        top, low = max(c.path_widths), c.path_min
        width = 1.0 if report.width >= top else 0.6 + 0.4 * max(report.width - low, 0.0) / ((top - low) or 1.0)
        detail = "A continuous path {} wide runs from the entrance to every side with chairs".format(
            metres(report.width))
        if report.reached_ratio < c.cut_off_tolerance:
            width *= report.reached_ratio / c.cut_off_tolerance
            detail += "; {:.0f}% of the open floor cannot be walked on to".format(100 * (1 - report.reached_ratio))
        return self._result("R3", 0.6 * width + 0.4 * behind, "{}; {}.".format(detail, tail))

    def _table_size(self, lay: Layout, explain: bool) -> RuleResult:
        t = self.config.rooms
        ratio = area(self.envelope(lay, self.c.chair_occupied)) / (self.room.width * self.room.length)
        score = clamp01((t.overcrowded_ratio - ratio) / (t.overcrowded_ratio - t.crowded_ratio))
        if not explain:
            return self._result("R4", score)
        detail = "The {} with everyone seated covers {:.0f}% of the {:.1f} m2 floor".format(
            lay.spec.label, 100 * ratio, self.room.area_m2)
        if lay.spec.seats < self.programme.seats:
            detail += "; the table for {} did not fit with every clearance".format(self.programme.seats)
        return self._result("R4", score, detail + ".")

    def _seating_comfort(self, lay: Layout, explain: bool) -> RuleResult:
        c, spec = self.c, lay.spec
        seat = spec.length / spec.per_side
        clear = self.clearances(lay)
        ends = [side for side in SIDES if side not in lay.chair_sides]
        tight = [side for side in ends if clear[side] < c.elbow_gap]
        score = 0.5 * grade(seat, c.seat_width_min, c.seat_width_preferred) + 0.5 * (0.4 if tight else 1.0)
        if not explain:
            return self._result("R5", score)
        detail = "Each person has {} of table edge ({} needed)".format(metres(seat), metres(c.seat_width_min))
        if tight:
            detail += "; the table's {} end is against the wall, so the chairs next to it have a wall at the " \
                      "elbow".format(_join(tight))
        elif ends:
            detail += "; the chairs at the table's ends have free elbows"
        return self._result("R5", score, detail + ".")

    def _openings_clear(self, lay: Layout, explain: bool) -> RuleResult:
        c, room = self.c, self.room
        parts: List[Tuple[float, float]] = []
        notes: List[str] = []
        if self.doors:
            gap = min(distance(lay.table.rect, d.opening(room)) for d in self.doors)
            parts.append((0.5, clamp01((gap - c.table_door_min) / (c.table_door_good - c.table_door_min))))
            notes.append("the table and its pulled-out chairs are clear of every door's swing, {} from the nearest "
                         "doorway".format(metres(gap)))
        if self.window_bands:
            pieces = [lay.table.rect] + [chair.rect for chair in lay.chairs]
            taken = [w.id for w, band in self.window_bands if any(intersects(p, band) for p in pieces)]
            parts.append((0.5, 1.0 - len(taken) / float(len(self.window_bands))))
            notes.append("the floor in front of every window is free" if not taken
                         else "chairs stand in front of window {}".format(_join(taken)))
        if not parts:
            return self._skip("R6", "No door or window was detected on this room's walls.")
        return self._result("R6", _mix(parts), "; ".join(notes).capitalize() + "." if explain else "")

    def sideboard_gap(self, lay: Layout) -> Tuple[float, float]:
        """(gap between the table and the sideboard, the least it may be)."""
        c = self.c
        board = lay.sideboard.rect
        between = any(intersects(beyond(lay.table.rect, side, self.room.width + self.room.length), board)
                      for side in lay.chair_sides)
        return distance(lay.table.rect, board), c.furniture_gap_min if between else c.furniture_gap_side

    def _furniture_gap(self, lay: Layout, explain: bool) -> RuleResult:
        if lay.sideboard is None:
            return self._skip("R7", "No other furniture stands near the table in this layout.")
        gap, least = self.sideboard_gap(lay)
        score = grade(gap, least, self.c.furniture_gap_preferred)
        return self._result("R7", score, "{} between the table and the sideboard ({} needed{}).".format(
            metres(gap), metres(least),
            ", with chairs between them" if least == self.c.furniture_gap_min else "") if explain else "")

    def _kitchen(self, lay: Layout, explain: bool) -> RuleResult:
        if self.kitchen is None:
            return self._skip("R8", "The plan shows no kitchen next to this room.")
        c = self.c
        point, kind = self.kitchen
        gap = point_gap(point, lay.table.rect)
        score = clamp01((c.kitchen_far - gap) / (c.kitchen_far - c.kitchen_near))
        return self._result("R8", score, "The table is {} from the {}.".format(
            metres(gap), "kitchen door" if kind == "door" else "wall nearest the kitchen") if explain else "")

    def route_lines(self, lay: Layout) -> Tuple[int, int]:
        """Rule 9: (straight routes the seated diners sit across, routes there are)."""
        if self.main_door is None:
            return (0, 0)
        room, c = self.room, self.c
        seated = self.envelope(lay, c.chair_occupied)
        others = [d for d in self.doors if not d.is_main]
        if others:
            crossed = sum(1 for d in others if segment_hits(self.door_point, d.center(room), seated))
            return (crossed, len(others))
        door = self.main_door
        ahead = room.band(door.wall, door.start, door.end, c.route_ahead, door.inset)
        return (1 if intersects(ahead, seated) else 0, 1)

    def _main_route(self, lay: Layout, explain: bool, walk: Optional[Walk]) -> RuleResult:
        if self.main_door is None:
            return self._skip("R9", "No door was detected, so there is no route through the room to judge.")
        c = self.c
        crossed, routes = self.route_lines(lay)
        parts = [(0.5, 1.0 - crossed / float(routes))]
        through = len(self.doors) > 1
        notes = [("the straight line between the doors {} the diners" if through
                  else "the floor straight ahead of the door is {} the diners").format(
            ("crosses" if through else "taken by") if crossed else ("misses" if through else "clear of"))]
        if walk is not None and walk.route_targets:
            parts.append((0.5, 1.0 if walk.occupied_ok else 0.0))
            notes.append("with every chair occupied a {} path {} the entrance to {}".format(
                metres(c.route_width), "still links" if walk.occupied_ok else "no longer links",
                "the other doors and the sideboard" if through and lay.sideboard is not None
                else "the other doors" if through else "the sideboard"))
        return self._result("R9", _mix(parts), "; ".join(notes).capitalize() + "." if explain else "")

    def _lighting(self, lay: Layout, explain: bool) -> RuleResult:
        c, room = self.c, self.room
        count = 2 if lay.spec.length >= c.two_pendants_from else 1
        lamp = "{} centred over the table, {} above its top".format(
            "Two pendants" if count == 2 else "A pendant", metres(c.pendant_drop))
        if not self.windows:
            return self._result("R10", 0.8, lamp + "; the room has no window, so there is no daylight to place "
                                "the table by." if explain else "")
        gap = min(distance(lay.table.rect, w.access(room, 0.0)) for w in self.windows)
        day = clamp01((c.daylight_far - gap) / (c.daylight_far - c.daylight_near))
        return self._result("R10", 0.6 + 0.4 * day, "{}; by day the nearest window is {} away.".format(
            lamp, metres(gap)) if explain else "")

    def _items_in_reach(self, lay: Layout, explain: bool) -> RuleResult:
        c = self.c
        if not self.programme.sideboard:
            return self._skip("R11", "No sideboard was planned for a room this size; tableware is carried from "
                              "the kitchen.")
        if lay.sideboard is None:
            return self._result("R11", 0.3, "No wall had room for the sideboard, so tableware has to be carried in.")
        gap = distance(lay.table.rect, lay.sideboard.rect)
        score = clamp01((c.serve_far - gap) / (c.serve_far - c.serve_near))
        return self._result("R11", score, "Plates, cutlery and glasses are in the sideboard on the {} wall, {} "
                            "from the table.".format(lay.sideboard.wall, metres(gap)) if explain else "")

    def _occupants_fit(self, lay: Layout, explain: bool) -> RuleResult:
        programme = self.programme
        wanted, placed = programme.seats, lay.spec.seats
        score = min(placed / float(wanted), 1.0)
        if not explain:
            return self._result("R12", score)
        basis = "as asked for" if programme.seats_source == "provided" else "for a room of {:.1f} m2".format(
            self.room.area_m2)
        detail = "Planned for {} seats, {}, for {} use; {} placed".format(wanted, basis, programme.use, placed)
        return self._result("R12", score, detail + ".")

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

        table = lay.table
        if not contains(room.rect, table.rect):
            add("R4", "boundary", "The table extends outside the room.", table.id)
        clear = self.clearances(lay)
        for side in SIDES:
            if side in lay.chair_sides:
                if clear[side] < c.chair_pull_min - 1.0:
                    add("R2", "chair_pullout", "Only {} is clear on the {} side of the table; {} is "
                        "needed to pull a chair out.".format(metres(clear[side]), side, metres(c.chair_pull_min)), table.id)
            elif 1.0 < clear[side] < c.end_gap_min - 1.0 and lay.sideboard is None:
                add("R5", "end_gap", "The {} end of the table is {} from the wall - too far to be against "
                    "it, too close to walk past.".format(side, metres(clear[side])), table.id)
        pulled = self.envelope(lay, c.chair_pull_min)
        for door, zone in zip(self.doors, self.door_zones):
            if intersects(pulled, zone):
                add("R6", "door", "The table or its pulled-out chairs stand where door {} needs to open.".format(
                    door.id), table.id)

        if lay.sideboard is not None:
            board = lay.sideboard
            if not contains(room.rect, board.rect):
                add("R7", "boundary", "The sideboard extends outside the room.", board.id)
            if intersects(board.rect, table.rect):
                add("R7", "overlap", "The sideboard overlaps the table.", board.id)
            gap, least = self.sideboard_gap(lay)
            if gap < least - 1.0:
                add("R7", "furniture_gap", "Only {} separates the table and the sideboard; {} is "
                    "needed.".format(metres(gap), metres(least)), board.id)
            for door, zone in zip(self.doors, self.door_zones):
                if intersects(board.rect, zone):
                    add("R6", "door", "The sideboard stands where door {} needs to open.".format(door.id), board.id)
            for window, band in self.window_bands:
                if intersects(board.rect, band) and board.height > window.sill_height:
                    add("R6", "window", "The sideboard stands in front of window {}.".format(window.id), board.id)

        if report is not None and report.checked and not report.valid:
            add("R3", "path", "No path at least {} wide links the entrance to {}.".format(
                metres(c.path_min), _join(report.unreachable) if report.unreachable else "the table"))
        return found
