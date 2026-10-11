"""
The ten living-room furniture-arrangement rules.

Each rule is applied in up to three ways, and `RULES` records which:

* **decides**  - it settles what is planned before anything is placed (the
  furniture sizes, the furniture each daily activity needs, the zones, the
  clearances for an occupant with mobility needs) - see `programme.py` and
  `layouts/zones.py`;
* **hard**     - a position that breaks it is discarded while searching
  (`rules/hard_constraints.py`);
* **scored**   - a 0..1 mark for how well a finished layout does, weighted into
  the 0-100 total and reported with the measured numbers behind it.

`RuleEvaluator.evaluate()` produces the scored part.  That total is what the
optimiser maximises (`soft_constraints.score_layout`), so the ten rules - not a
separate points table - decide which arrangement wins.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

from ..models.furniture import Furniture
from ..models.geometry import Rect, Shape, angle_between, clamp, corridor_polygon
from ..models.room import OPPOSITE_WALL
from .circulation_rules import CirculationReport, build_grid, entrance_corridor
from .context import PlacementContext
from .door_rules import preferred_clearance_satisfied
from .furniture_rules import (
    _is_circulation_obstacle,
    center_distance,
    clearance_in_direction,
    gap_between,
    in_front_of,
    wall_behind,
)
from .window_rules import is_near_window, window_coverage_penalty_terms

SOFA_TYPES = ("sofa", "l_sofa", "loveseat")


@dataclass(frozen=True)
class Rule:
    id: str
    key: str       # also the name of its weight in config.RuleWeights
    title: str
    text: str      # the rule as written
    method: str    # how the engine applies it


RULES: Tuple[Rule, ...] = (
    Rule("R1", "face_to_face", "Face-to-face conversation",
         "Arrange sofas and chairs to support face-to-face conversation.",
         "Built in: armchairs are only ever tried turned towards the sofa. Hard: a chair stays within 4.5 m "
         "of another seat. Scored: how squarely each chair faces the sofa, and whether they sit at talking "
         "distance (1.2-3.0 m)."),
    Rule("R2", "views", "Views of other people",
         "Arrange seating furniture to provide suitable views of other people.",
         "Scored: for every pair of seats, whether one person can see the other without turning more than "
         "60 degrees, and that nothing taller than a seated person's eye level stands between them."),
    Rule("R3", "zones", "Zones where needed",
         "Divide the room into living, dining, and entertainment zones when necessary.",
         "Decides the zones: one floor band per activity area (living with its TV wall, dining, reading, "
         "work) when the room holds more than one. Scored: pieces inside their own zone, a walkway between "
         "zones, and a clear view from the sofa to the screen. Not applicable to a single seating group."),
    Rule("R4", "clear_openings", "Doors, windows and paths clear",
         "Keep doors, windows, and main walking paths unobstructed.",
         "Hard: nothing in a door opening, its swing or the 900 mm inside it; nothing tall in front of a "
         "window; a 900 mm path from the entrance to every seat and door. Scored: 1.2 m kept clear inside "
         "the doors, how much of each window front is free, and a 1.2 m wide main path."),
    Rule("R5", "furniture_fit", "Furniture sized to the room",
         "Select furniture sizes that fit the available room space.",
         "Decides the sizes: compact, standard or generous pieces for the floor area, a size down when a "
         "layout cannot place its furniture. Scored: every planned piece placed, and the sofa between a "
         "third and two thirds of the wall it runs along."),
    Rule("R6", "within_reach", "Tables within reach",
         "Position coffee tables and frequently used furniture within comfortable reach of seating areas.",
         "Hard: the coffee table is 400 mm to 900 mm from the sofa. Scored: 400-500 mm, directly in front "
         "of the sofa, and every seat with a table surface within arm's reach (700 mm)."),
    Rule("R7", "daily_activities", "Arranged for daily activities",
         "Arrange furniture according to the household's daily activities.",
         "Decides the furniture: a TV unit for watching TV, shelves and a reading chair for reading, a desk "
         "for working, a table and chairs for dining. Scored: each activity has its furniture and can be "
         "done there - the sofa faces the screen at viewing distance, the reading chair has light, the "
         "desk has daylight, the dining chairs can be pulled out."),
    Rule("R8", "openness", "Open, uncrowded room",
         "Maintain visual openness and avoid overcrowding.",
         "Scored: the share of the floor left free (70% for full marks), the largest clear square of "
         "floor, and nothing tall standing in the view from the entrance across the room."),
    Rule("R9", "movement", "Easy movement between areas",
         "Position furniture to support comfortable movement between different activity areas.",
         "Hard: one continuous 900 mm path reaches every seat, every door and every activity area. "
         "Scored: whether that path is 1.2 m wide, and that the straight way to the other doors and "
         "areas does not cut between the sofa and its coffee table."),
    Rule("R10", "accessibility", "Occupants' physical needs",
         "Consider the physical needs and accessibility requirements of occupants.",
         "Decides the clearances: with mobility needs, 1.2 m inside every door, 900 mm behind a "
         "free-standing seat and no loose rug. Scored: a step-free path to every seat, space to turn "
         "(1.5 m with mobility needs, 1.2 m otherwise) and clear floor beside a seat to get in and out of it."),
)
RULE_BY_ID: Dict[str, Rule] = {rule.id: rule for rule in RULES}


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
        if self.score >= 0.85:
            return "satisfied"
        return "partly_satisfied" if self.score >= 0.5 else "not_satisfied"

    def to_dict(self, scale: float = 1.0) -> Dict:
        return {
            "id": self.rule.id,
            "key": self.rule.key,
            "title": self.rule.title,
            "rule": self.rule.text,
            "status": self.status,
            "score": round(self.score, 3),
            "points": round(self.points * scale, 1),
            "max_points": round(self.weight * scale, 1) if self.applicable else 0.0,
            "detail": self.detail,
        }


def rule_catalogue(config=None) -> List[Dict]:
    """The ten rules as written, and how the engine applies each one."""
    from ..config import Config

    weights = (config or Config()).rule_weights
    return [
        {"id": rule.id, "key": rule.key, "title": rule.title, "rule": rule.text, "method": rule.method,
         "weight": getattr(weights, rule.key)}
        for rule in RULES
    ]


def total_score(results: Dict[str, RuleResult]) -> float:
    """0-100: points earned out of the points the applicable rules could give."""
    weight = sum(r.weight for r in results.values() if r.applicable)
    return 100.0 * sum(r.points for r in results.values()) / weight if weight else 0.0


# --------------------------------------------------------------------------- #
# small helpers
# --------------------------------------------------------------------------- #
def metres(mm: float) -> str:
    return "{:.2f} m".format(mm / 1000.0)


def clamp01(value: float) -> float:
    return clamp(value, 0.0, 1.0)


def ramp(value: float, zero: float, full: float) -> float:
    """0 at `zero`, 1 at `full`, linear between (works in either direction)."""
    if full == zero:
        return 1.0 if value >= full else 0.0
    return clamp01((value - zero) / (full - zero))


def grade(value: float, minimum: float, preferred: float) -> float:
    """Half marks at the hard minimum, full marks at the preferred figure, none at zero."""
    if value >= preferred - 1.0:
        return 1.0
    if value >= minimum - 1.0:
        return 0.5 + 0.5 * (value - minimum) / (preferred - minimum) if preferred > minimum else 1.0
    return 0.5 * clamp01(value / minimum) if minimum > 0 else 0.0


def _mix(parts: Sequence[Tuple[float, float]]) -> float:
    """Weighted mean of (weight, score) pairs."""
    weight = sum(w for w, _ in parts)
    return sum(w * s for w, s in parts) / weight if weight else 0.0


def _mean(values: Sequence[float]) -> float:
    return sum(values) / len(values) if values else 0.0


PIECE_NAMES = {"l_sofa": "corner sofa", "tv_console": "TV unit", "tv": "TV", "dining_set": "dining table"}


def _name(item: Furniture) -> str:
    return PIECE_NAMES.get(item.type) or (item.role or item.type).replace("_", " ")


def _target(name: str, items: Sequence[Furniture]) -> str:
    """A circulation target ("seat:sofa_1", "door:d2", "room_centre") in plain words."""
    kind, _, ident = name.partition(":")
    if kind == "room_centre":
        return "the middle of the room"
    if kind == "door":
        return "door {}".format(ident)
    item = next((f for f in items if f.id == ident), None)
    return "the {}".format(_name(item)) if item is not None else name


def _join(names: List[str]) -> str:
    if not names:
        return ""
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def _sentence(notes: List[str]) -> str:
    text = "; ".join(n for n in notes if n)
    return text[:1].upper() + text[1:] + "." if text else ""


def look_angle(a: Furniture, b: Furniture) -> float:
    """How far someone seated on `a` turns to look at `b` (degrees).

    A corner sofa seats people facing two ways - along its main run and along
    its return - so the smaller of the two turns counts.
    """
    origin, target = a.seat_point(), b.seat_point()
    towards = (target[0] - origin[0], target[1] - origin[1])
    facings = [a.facing]
    if a.spec.shape == "l":
        fx, fy = a.facing
        side = (fy, -fx)                     # the piece's own +x, turned with it
        facings.append(side if a.variant != "right" else (-side[0], -side[1]))
    return min(angle_between(facing, towards) for facing in facings)


def look_quality(a: Furniture, b: Furniture) -> float:
    """1.0 when someone on `a` looks straight at `b`, 0 at 90 degrees off."""
    return clamp01(1.0 - look_angle(a, b) / 90.0)


def conversation_mark(chair: Furniture, sofa: Furniture, config) -> float:
    """Rule 1 for one armchair: turned to the sofa, in front of it, at talking distance (0..1)."""
    t = config.rule_thresholds
    turned = ramp(look_angle(chair, sofa), 110.0, 45.0)      # the chair looks at the sofa
    seen = ramp(look_angle(sofa, chair), 150.0, 90.0)        # and does not stand behind it
    gap = center_distance(chair, sofa)
    if gap < t.talk_near:
        near = 0.7
    else:
        near = 1.0 if gap <= t.talk_far else ramp(gap, config.clearances.seating_group_max_span, t.talk_far)
    return 0.45 * turned + 0.2 * seen + 0.35 * near


def _bounds(items: Sequence[Furniture]) -> Rect:
    boxes = [i.bbox for i in items]
    return Rect.from_bounds(min(b.x0 for b in boxes), min(b.y0 for b in boxes),
                            max(b.x1 for b in boxes), max(b.y1 for b in boxes))


class RuleEvaluator:
    """Scores one finished layout against the ten rules."""

    def __init__(self, ctx: PlacementContext, items: List[Furniture], report: CirculationReport,
                 planned: Optional[Sequence] = None):
        self.ctx = ctx
        self.items = list(items)
        self.report = report
        self.planned = list(planned or [])      # the layout's PlacementSpecs
        self.room = ctx.room
        self.c = ctx.config.clearances
        self.t = ctx.config.rule_thresholds
        self.weights = {rule.id: float(getattr(ctx.config.rule_weights, rule.key)) for rule in RULES}
        self.programme = getattr(ctx.analysis, "programme", None)
        self.zone_by_role: Dict[str, Rect] = getattr(ctx.analysis, "zone_by_role", None) or {}
        self.accessible = bool(self.programme and self.programme.accessible)
        self.entry = ctx.analysis.entry_point
        self._grid = None

        self.sofas = [f for f in items if f.type in SOFA_TYPES]
        self.sofa = max(self.sofas, key=lambda f: f.spec.footprint_area) if self.sofas else None
        self.chairs = [f for f in items if f.type == "chair"]
        self.reading_chairs = [f for f in items if f.type == "reading_chair"]
        self.lounge = self.sofas + self.chairs + self.reading_chairs
        self.tables = [f for f in items if f.type in ("coffee_table", "side_table")]
        self.coffee_table = self._first("coffee_table")
        self.screen = self._first("tv") or self._first("tv_console")

    # ------------------------------------------------------------------ #
    def evaluate(self) -> Dict[str, RuleResult]:
        return {
            "R1": self._face_to_face(),
            "R2": self._views(),
            "R3": self._zones(),
            "R4": self._clear_openings(),
            "R5": self._furniture_fit(),
            "R6": self._within_reach(),
            "R7": self._daily_activities(),
            "R8": self._openness(),
            "R9": self._movement(),
            "R10": self._accessibility(),
        }

    def _result(self, rule_id: str, score: float, detail: str = "") -> RuleResult:
        return RuleResult(RULE_BY_ID[rule_id], clamp01(score), self.weights[rule_id], detail)

    def _skip(self, rule_id: str, detail: str) -> RuleResult:
        return RuleResult(RULE_BY_ID[rule_id], 0.0, self.weights[rule_id], detail, applicable=False)

    def _first(self, type_name: str) -> Optional[Furniture]:
        return next((f for f in self.items if f.type == type_name), None)

    def _activities(self) -> List[str]:
        if self.programme is not None:
            return list(self.programme.activities)
        found = ["conversation"]
        for type_name, activity in (("tv_console", "tv"), ("bookshelf", "reading"), ("desk", "work"),
                                    ("dining_set", "dining")):
            if self._first(type_name) is not None:
                found.append(activity)
        return found

    def grid(self):
        if self._grid is None:
            self._grid = self.report.grid or build_grid(self.ctx, self.items)
        return self._grid

    def _unreached(self) -> str:
        """What the walking path fails to reach, in plain words."""
        names = [_target(name, self.items) for name in self.report.unreachable_targets[:3]]
        return _join(names) or "the room"

    def _sight_blocker(self, a, b, skip: Sequence[Furniture], min_height: float,
                       width: float = 300.0) -> Optional[Furniture]:
        """The first piece at least `min_height` tall standing on the line from a to b."""
        line = Shape.of(corridor_polygon(a, b, width))
        skipped = {f.id for f in skip}
        for item in self.items:
            if item.id in skipped or item.spec.flat or item.spec.slim or item.spec.height < min_height:
                continue
            if item.footprint().intersects(line):
                return item
        return None

    # ------------------------------------------------------------------ #
    # 1. face-to-face conversation
    # ------------------------------------------------------------------ #
    def _face_to_face(self) -> RuleResult:
        t = self.t
        group = self.sofas + self.chairs
        if not group:
            return self._skip("R1", "No sofa or armchair was placed.")
        main = self.sofa or group[0]
        others = [f for f in group if f.id != main.id]
        if not others:
            if main.type == "l_sofa":
                return self._result("R1", 0.7, "The corner sofa seats people at right angles to each other; "
                                    "no separate chair faces it.")
            return self._result("R1", 0.35, "Everyone sits side by side on the {}; no seat faces it.".format(
                _name(main)))
        marks, notes = [], []
        for seat in others:
            turned = ramp(look_angle(seat, main), 110.0, 45.0)
            gap = center_distance(seat, main)
            marks.append(conversation_mark(seat, main, self.ctx.config))
            notes.append("{}, {} from the {}, {}".format(
                _name(seat), metres(gap), _name(main), "faces it" if turned >= 0.75
                else "is turned partly away from it" if turned > 0.0 else "has its back or side to it"))
        return self._result("R1", _mean(marks), _sentence(
            notes + ["talking distance is {} to {}".format(metres(t.talk_near), metres(t.talk_far))]))

    # ------------------------------------------------------------------ #
    # 2. views of other people
    # ------------------------------------------------------------------ #
    def _views(self) -> RuleResult:
        t = self.t
        seats = self.lounge
        if not seats:
            return self._skip("R2", "No seating was placed.")
        if len(seats) == 1:
            if seats[0].type == "l_sofa":
                return self._result("R2", 0.7, "People on the two arms of the corner sofa see each other at a "
                                    "right angle.")
            return self._result("R2", 0.3, "Everyone sits in a row on the {} and has to turn to see the "
                                "others.".format(_name(seats[0])))
        marks: List[float] = []
        easy = 0
        blocked: List[str] = []
        for a in seats:
            for b in seats:
                if a.id == b.id:
                    continue
                mark = ramp(look_angle(a, b), t.view_lost_angle, t.view_easy_angle)
                blocker = self._sight_blocker(a.seat_point(), b.seat_point(), (a, b), t.eye_level)
                if blocker is not None:
                    mark = 0.0
                    blocked.append(_name(blocker))
                elif mark >= 0.999:
                    easy += 1
                marks.append(mark)
        notes = ["{} of the {} seat-to-seat views are open without turning more than {:.0f} degrees".format(
            easy, len(marks), t.view_easy_angle)]
        if blocked:
            notes.append("the {} stands between two seats".format(_join(sorted(set(blocked)))))
        return self._result("R2", _mean(marks), _sentence(notes))

    # ------------------------------------------------------------------ #
    # 3. zones
    # ------------------------------------------------------------------ #
    def _area_groups(self) -> Dict[str, List[Furniture]]:
        groups = {
            "living": self.sofas + self.chairs + ([self.coffee_table] if self.coffee_table else []),
            "reading": [f for f in self.items if f.type in ("bookshelf", "reading_chair")],
            "work": [f for f in self.items if f.type in ("desk", "desk_chair")],
            "dining": [f for f in self.items if f.type == "dining_set"],
        }
        return {name: members for name, members in groups.items() if members}

    def _zones(self) -> RuleResult:
        t = self.t
        groups = self._area_groups()
        parts: List[Tuple[float, float]] = []
        notes: List[str] = []

        # entertainment: the screen and the view of it from the sofa
        if self.screen is not None and self.sofa is not None:
            blocker = self._sight_blocker(self.sofa.seat_point(), self.screen.bbox.center,
                                          (self.sofa, self.screen), 700.0, width=600.0)
            parts.append((1.0, 0.0 if blocker else 1.0))
            notes.append("the {} stands between the sofa and the screen".format(_name(blocker)) if blocker
                         else "the entertainment zone - the view from the sofa to the screen - is clear")

        names = list(groups)
        if len(names) < 2 and not parts:
            return self._skip("R3", "The room holds one seating group, so it needs no division into zones.")

        # every pair of areas keeps to its own floor, with a walkway between
        for i in range(len(names)):
            for j in range(i + 1, len(names)):
                a, b = _bounds(groups[names[i]]), _bounds(groups[names[j]])
                if a.intersection_area(b) > 1.0:
                    parts.append((1.0, 0.0))
                    notes.append("the {} and {} zones overlap".format(names[i], names[j]))
                    continue
                gap = a.distance_to_rect(b)
                parts.append((1.0, grade(gap, t.zone_gap_min, t.zone_gap_preferred)))
                notes.append("{} between the {} and {} zones".format(metres(gap), names[i], names[j]))

        # the pieces stand in the floor band planned for their zone
        zoned = [f for f in self.items if f.role in self.zone_by_role]
        if zoned:
            inside = [f for f in zoned if self.zone_by_role[f.role].contains_point(f.center, tol=250.0)]
            parts.append((1.0, len(inside) / float(len(zoned))))
            notes.append("{} of {} pieces stand inside the zone planned for them".format(len(inside), len(zoned)))
        return self._result("R3", _mix(parts), _sentence(notes))

    # ------------------------------------------------------------------ #
    # 4. doors, windows and main paths
    # ------------------------------------------------------------------ #
    def _clear_openings(self) -> RuleResult:
        ctx, c, report = self.ctx, self.c, self.report
        parts: List[Tuple[float, float]] = []
        notes: List[str] = []
        if ctx.doors:
            roomy = preferred_clearance_satisfied(ctx, self.items)
            parts.append((0.3, 1.0 if roomy else 0.6))
            notes.append("{} is clear inside every door".format(
                metres(c.door_clearance_preferred if roomy else c.door_clearance_min)))
        if ctx.windows:
            covered: Dict[str, float] = {}
            for window_id, _item, coverage in window_coverage_penalty_terms(self.items, ctx):
                covered[window_id] = min(1.0, covered.get(window_id, 0.0) + coverage)
            cut_off = set(report.unreachable_windows)
            marks = [(1.0 - covered.get(w.id, 0.0)) * (0.7 if w.id in cut_off else 1.0) for w in ctx.windows]
            parts.append((0.3, _mean(marks)))
            free = sum(1 for w in ctx.windows if w.id not in covered)
            if len(ctx.windows) == 1:
                notes.append("nothing stands in front of the window" if free
                             else "furniture stands in front of {:.0f}% of the window".format(
                                 100 * covered[ctx.windows[0].id]))
            else:
                notes.append("{} of {} windows have nothing standing in front".format(free, len(ctx.windows)))
        if self.entry is not None:
            if not report.valid:
                mark = 0.0
                notes.append("no {} path links the entrance to {}".format(
                    metres(c.circulation_min), self._unreached()))
            else:
                mark = 1.0 if report.preferred_width_met else 0.7
                corridor = entrance_corridor(ctx)
                in_way = [f for f in self.items if corridor is not None and not f.spec.flat
                          and f.footprint().intersects(corridor)]
                if in_way:
                    mark *= 0.7
                notes.append("the main path is {} wide{}".format(
                    metres(report.width_achieved),
                    ", but the {} stands in the straight way in from the entrance".format(_name(in_way[0]))
                    if in_way else ""))
            parts.append((0.4, mark))
        if not parts:
            return self._skip("R4", "No door or window was detected on this room's walls.")
        return self._result("R4", _mix(parts), _sentence(notes))

    # ------------------------------------------------------------------ #
    # 5. furniture sized to the room
    # ------------------------------------------------------------------ #
    def _furniture_fit(self) -> RuleResult:
        t, room = self.t, self.room
        parts: List[Tuple[float, float]] = []
        notes: List[str] = []
        programme = self.programme
        if programme is not None:
            notes.append("{} sizes were chosen for a {:.1f} m2 room".format(programme.tier, programme.area_m2))
            if programme.tier != programme.planned_tier:
                notes.append("a size down from {}, which did not fit".format(programme.planned_tier))

        required = [s for s in self.planned if s.required]
        if required:
            placed_roles = {f.role for f in self.items}
            missing = [s for s in required if s.role not in placed_roles]
            parts.append((0.5, 1.0 - len(missing) / float(len(required))))
            notes.append("every planned piece found a place" if not missing else "no place was found for the {}".format(
                _join([s.label().replace("_", " ") for s in missing])))

        if self.sofa is not None:
            box = self.sofa.bbox
            if self.sofa.spec.shape == "l":
                share = max(box.width / room.width, box.height / room.length)
                length = max(box.width, box.height)
            else:
                along_x = bool(self.sofa.facing[1])            # facing north/south -> its length runs east-west
                length = box.width if along_x else box.height
                share = length / (room.width if along_x else room.length)
            if share > t.sofa_share_high:
                mark = ramp(share, t.sofa_share_max, t.sofa_share_high)
            else:
                mark = 1.0 if share >= t.sofa_share_low else 0.6 + 0.4 * share / t.sofa_share_low
            parts.append((0.5, mark))
            notes.append("the {} {} takes {:.0f}% of the {} room dimension it runs along".format(
                metres(length), _name(self.sofa), 100 * share,
                metres(length / share if share else 0.0)))
        if not parts:
            return self._skip("R5", "No furniture was planned for this room.")
        return self._result("R5", _mix(parts), _sentence(notes))

    # ------------------------------------------------------------------ #
    # 6. tables within reach
    # ------------------------------------------------------------------ #
    def _within_reach(self) -> RuleResult:
        c, t = self.c, self.t
        if not self.lounge:
            return self._skip("R6", "No seating was placed.")
        parts: List[Tuple[float, float]] = []
        notes: List[str] = []
        table_planned = any(s.type == "coffee_table" for s in self.planned)
        if self.coffee_table is not None and self.sofa is not None:
            gap = gap_between(self.coffee_table, self.sofa)
            if gap < c.coffee_table_min - 1.0:
                mark = 0.3
            elif gap <= c.coffee_table_max + 1.0:
                mark = 1.0
            else:
                mark = 1.0 - 0.6 * clamp01((gap - c.coffee_table_max) / c.coffee_table_surround)
            ahead = in_front_of(self.sofa, self.coffee_table)
            parts.append((0.5, mark if ahead else 0.6 * mark))
            notes.append("the coffee table is {} {} the sofa ({:.0f}-{:.0f} mm is comfortable)".format(
                metres(gap), "in front of" if ahead else "to one side of", c.coffee_table_min, c.coffee_table_max))
        elif table_planned:
            parts.append((0.5, 0.0))
            notes.append("the coffee table could not be placed")

        marks = []
        for seat in self.lounge:
            gap = min((gap_between(seat, table) for table in self.tables), default=float("inf"))
            marks.append(1.0 if gap <= c.arm_reach else ramp(gap, t.surface_reach_far, c.arm_reach))
        served = sum(1 for m in marks if m >= 0.999)
        parts.append((0.5, _mean(marks)))
        notes.append("{} of {} seats have a table within {}".format(served, len(marks), metres(c.arm_reach)))

        reader = self.reading_chairs[0] if self.reading_chairs else None
        lamp = self._first("lamp")
        if reader is not None and lamp is not None:
            gap = gap_between(reader, lamp)
            parts.append((0.2, 1.0 if gap <= t.lamp_reach else ramp(gap, 2 * t.lamp_reach, t.lamp_reach)))
            notes.append("the lamp is {} from the reading chair".format(metres(gap)))
        return self._result("R6", _mix(parts), _sentence(notes))

    # ------------------------------------------------------------------ #
    # 7. daily activities
    # ------------------------------------------------------------------ #
    def _daily_activities(self) -> RuleResult:
        activities = self._activities()
        if not activities:
            return self._skip("R7", "No daily activity was given for this room.")
        judge = {
            "conversation": self._activity_conversation, "tv": self._activity_tv,
            "reading": self._activity_reading, "work": self._activity_work, "dining": self._activity_dining,
        }
        marks, notes = [], []
        for activity in activities:
            mark, note = judge[activity]()
            marks.append(mark)
            notes.append(note)
        source = self.programme.activities_source if self.programme else "inferred"
        notes.append("activities {}".format("as given" if source == "provided" else "assumed from the room's purpose"))
        return self._result("R7", _mean(marks), _sentence(notes))

    def _activity_conversation(self) -> Tuple[float, str]:
        places = sum(max(1, f.spec.seats) for f in self.lounge)
        if not self.lounge:
            return 0.0, "conversation: no seating was placed"
        grouped = len(self.lounge) >= 2 or self.lounge[0].type == "l_sofa"
        mark = (1.0 if places >= 3 else 0.7) if grouped else 0.6
        return mark, "conversation: {} places to sit{}".format(
            places, " around one group" if grouped else " in a single row")

    def _activity_tv(self) -> Tuple[float, str]:
        c = self.c
        if self.screen is None:
            return 0.0, "TV: no screen or TV unit could be placed"
        if self.sofa is None:
            return 0.3, "TV: no sofa to watch from"
        gap = center_distance(self.sofa, self.screen)
        mark = look_quality(self.sofa, self.screen)
        note = "TV: the sofa {} the screen from {}".format("faces" if mark >= 0.7 else "does not face", metres(gap))
        if not (c.tv_distance_min <= gap <= c.tv_distance_max):
            mark *= 0.6
            note += " (outside the {:.1f}-{:.1f} m viewing distance)".format(
                c.tv_distance_min / 1000.0, c.tv_distance_max / 1000.0)
        wall = wall_behind(self.screen, self.room)
        if wall is not None and self.ctx.analysis.wall_info(OPPOSITE_WALL[wall]).window_coverage > 0.35:
            mark *= 0.7
            note += ", with a glazed wall behind the viewer that will reflect in it"
        return mark, note

    def _activity_reading(self) -> Tuple[float, str]:
        t = self.t
        seat = self.reading_chairs[0] if self.reading_chairs else (self.chairs[0] if self.chairs else self.sofa)
        if seat is None:
            return 0.0, "reading: no seat to read in"
        parts = [(0.4, 1.0 if seat.type == "reading_chair" else 0.6)]
        note = "reading: the {}".format(_name(seat))
        shelf = self._first("bookshelf")
        if shelf is None:
            parts.append((0.3, 0.0))
            note += " has no bookshelf"
        else:
            gap = gap_between(seat, shelf)
            parts.append((0.3, 1.0 if gap <= t.shelf_reach else ramp(gap, 2 * t.shelf_reach, t.shelf_reach)))
            note += " is {} from the shelves".format(metres(gap))
        lamp = self._first("lamp")
        lit = lamp is not None and gap_between(seat, lamp) <= t.lamp_reach
        window = is_near_window(seat, self.ctx, radius=t.daylight_reach)
        parts.append((0.3, 1.0 if (lit or window is not None) else 0.2))
        note += ", with {}".format("a lamp beside it" if lit else "daylight from window '{}'".format(window.id)
                                   if window is not None else "no lamp or window near it")
        return _mix(parts), note

    def _activity_work(self) -> Tuple[float, str]:
        desk, chair = self._first("desk"), self._first("desk_chair")
        if desk is None:
            return 0.0, "working: no desk could be placed"
        parts = [(0.5, 1.0 if chair is not None else 0.5)]
        note = "working: the desk" + ("" if chair is not None else " has no chair and")
        if self.ctx.windows:
            window = is_near_window(desk, self.ctx, radius=1200.0)
            parts.append((0.25, 1.0 if window is not None else 0.3))
            note += " {} daylight".format("has" if window is not None else "is away from the")
        corridor = entrance_corridor(self.ctx)
        on_route = corridor is not None and any(f.footprint().intersects(corridor) for f in (desk, chair) if f)
        parts.append((0.25, 0.0 if on_route else 1.0))
        note += " and {} the way in from the entrance".format("stands in" if on_route else "is clear of")
        return _mix(parts), note

    def _activity_dining(self) -> Tuple[float, str]:
        c, t = self.c, self.t
        table = self._first("dining_set")
        if table is None:
            return 0.0, "dining: no table and chairs could be placed"
        behind = min(clearance_in_direction(table, table.facing, self.ctx, self.items),
                     clearance_in_direction(table, table.back_direction, self.ctx, self.items))
        mark = 0.6 + 0.4 * grade(behind, c.dining_pull_out, t.dining_pull_preferred)
        return mark, "dining: a table for {} with {} behind the pushed-in chairs to pull them out".format(
            table.spec.seats, metres(behind))

    # ------------------------------------------------------------------ #
    # 8. openness
    # ------------------------------------------------------------------ #
    def _openness(self) -> RuleResult:
        t, room = self.t, self.room
        grid = self.grid()
        free = grid.free_area() / room.area if room.area else 0.0
        square = grid.largest_free_square_side()
        wanted = min(t.open_square, 0.45 * min(room.width, room.length))
        parts = [(0.4, ramp(free, t.free_floor_low, t.free_floor_high)),
                 (0.3, 1.0 if wanted <= t.open_square_min else ramp(square, t.open_square_min, wanted))]
        notes = ["{:.0f}% of the floor is free".format(100 * free),
                 "the largest clear square of floor is {} across".format(metres(square))]
        if self.entry is not None:
            targets = [room.center]
            window = self.ctx.analysis.largest_window()
            if window is not None:
                targets.append(window.center_point(room))
            blockers = [b for b in (self._sight_blocker(self.entry, target, (), t.eye_level) for target in targets)
                        if b is not None]
            parts.append((0.3, 1.0 - len(blockers) / float(len(targets))))
            notes.append("the {} stands in the view from the entrance".format(_name(blockers[0])) if blockers
                         else "nothing tall stands in the view from the entrance across the room")
        return self._result("R8", _mix(parts), _sentence(notes))

    # ------------------------------------------------------------------ #
    # 9. movement between activity areas
    # ------------------------------------------------------------------ #
    def _path_mark(self, at_minimum: float) -> float:
        report = self.report
        if not report.valid:
            return 0.0
        mark = 1.0 if report.preferred_width_met else at_minimum
        if report.reachable_ratio < 0.9:
            mark *= report.reachable_ratio / 0.9
        return mark

    def _movement(self) -> RuleResult:
        c, report = self.c, self.report
        if self.entry is None:
            return self._skip("R9", "No door was detected, so there is no route through the room to judge.")
        parts = [(0.6, self._path_mark(0.7))]
        if report.valid:
            notes = ["a continuous {} path links the entrance to every seat, door and activity area".format(
                metres(report.width_achieved))]
        else:
            notes = ["no {} path reaches {}".format(metres(c.circulation_min), self._unreached())]

        # the straight way to the other doors and areas should not cut through the seating group
        main = self.ctx.analysis.main_door
        targets = [(d.id, d.entry_point(self.room, 700.0)) for d in self.ctx.doors if main is None or d.id != main.id]
        for name, members in self._area_groups().items():
            if name != "living":
                targets.append((name + " zone", _bounds(members).center))
        if targets and self.sofa is not None:
            core = Shape.of(self.sofa.front_zone(c.coffee_table_max))
            crossed = [name for name, point in targets
                       if Shape.of(corridor_polygon(self.entry, point, 600.0)).intersects(core)]
            parts.append((0.4, 1.0 - len(crossed) / float(len(targets))))
            notes.append("the straight way to {} cuts between the sofa and its table".format(_join(crossed))
                         if crossed else "the way to the other doors and areas passes round the seating group")
        return self._result("R9", _mix(parts), _sentence(notes))

    # ------------------------------------------------------------------ #
    # 10. physical needs and accessibility
    # ------------------------------------------------------------------ #
    def _accessibility(self) -> RuleResult:
        t, report = self.t, self.report
        needs = self.accessible
        turn = t.turning_space_accessible if needs else t.turning_space
        approach = t.seat_approach_accessible if needs else t.seat_approach
        parts: List[Tuple[float, float]] = []
        notes = ["planned for an occupant with mobility needs" if needs
                 else "no mobility needs were given, so the room is judged for everyday ease"]
        if self.entry is not None:
            parts.append((0.4, self._path_mark(0.6 if needs else 0.85)))
            notes.append("the path to every seat is {} wide".format(metres(report.width_achieved)) if report.valid
                         else "not every seat can be reached")
        square = self.grid().largest_free_square_side()
        parts.append((0.3, ramp(square, 800.0, turn)))
        notes.append("{} of clear floor to turn in ({} wanted)".format(metres(square), metres(turn)))

        if self.lounge:
            # With mobility needs a seat is approached from the side (a wheelchair or a
            # walking frame stands beside it); otherwise from the front as well, and a
            # low table there is walked round rather than counted as in the way.
            obstacles = [f for f in self.items if _is_circulation_obstacle(f)
                         and (needs or f.spec.category != "table")]
            open_seats = 0
            for seat in self.lounge:
                facing = seat.facing
                sides = [(-facing[1], facing[0]), (facing[1], -facing[0])]
                if not needs:
                    sides.append(facing)
                if any(clearance_in_direction(seat, side, self.ctx, obstacles) >= approach for side in sides):
                    open_seats += 1
            parts.append((0.3, open_seats / float(len(self.lounge))))
            notes.append("{} of {} seats have {} of clear floor {} them".format(
                open_seats, len(self.lounge), metres(approach), "beside" if needs else "beside or in front of"))
        if needs:
            rug = self._first("rug")
            parts.append((0.2, 0.0 if rug is not None else 1.0))
            notes.append("a loose rug lies on the floor" if rug is not None else "there is no loose rug to trip on")
        return self._result("R10", _mix(parts), _sentence(notes))
