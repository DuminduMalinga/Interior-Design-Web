"""
The twelve kitchen furniture-arrangement rules.

Each rule is applied in up to three ways, and `RULES` records which:

* **built in** - the generator only ever proposes positions that obey it
  (the utensil drawers are created beside the stove, never searched for);
* **hard**     - a position that breaks it is discarded, and `violations()`
  re-checks every such limit on the finished layout;
* **scored**   - a 0..1 mark for how well the layout does, weighted into the
  0-100 total and reported with the measured numbers behind it.

Six rules depend only on where the sink, the stove and the refrigerator stand
(1-5 and 11). `measure()` works those facts out once per combination and
`core()` scores them, which is what lets the search compare thousands of
combinations. The other six need the finished kitchen - its worktops, its
table, its walking routes - and are scored by `finish()`.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from .circulation import CirculationReport
from .config import Config
from .geometry import (
    Point,
    Rect,
    center,
    clamp01,
    contains,
    distance,
    intersects,
    rect_meets_triangle,
    segment_hits,
    segment_meets_triangle,
    span_overlap,
)
from .programme import SEAT_WORDS, Programme
from .room import Door, Room, Window
from .runs import Arrangement
from .units import Item, Layout, Station, Stretch


@dataclass(frozen=True)
class Rule:
    id: str
    key: str       # also the name of its weight in config.Weights
    title: str
    text: str      # the rule as written
    method: str    # how the engine applies it


RULES: Tuple[Rule, ...] = (
    Rule("R1", "sink_location", "Sink in a convenient place",
         "Position the sink in a convenient location for washing and food preparation.",
         "Hard: the sink stands 300 mm clear of an inside corner. Scored: worktop on both sides of it, "
         "a window over it, and room at the corner."),
    Rule("R2", "prep_by_sink", "Preparation worktop by the sink",
         "Place the food preparation countertop close to the sink.",
         "Built in: the preparation worktop always starts at the sink. Hard: it is at least 600 mm long. "
         "Scored: up to 900 mm."),
    Rule("R3", "safe_workflow", "Safe sink-to-stove workflow",
         "Arrange the sink, food preparation area, and stove to support a safe workflow.",
         "Hard: sink and stove are never side by side. Scored: sink, preparation worktop and stove in one "
         "line with nothing between; the stove away from the doorway and not under a window."),
    Rule("R4", "work_triangle", "Work triangle",
         "Consider the sink, stove, and refrigerator when planning the kitchen work triangle.",
         "Scored: each leg between the three is 1.2 to 2.7 m and the triangle is 4.0 to 7.9 m round, "
         "with nothing standing across a leg."),
    Rule("R5", "stove_counter", "Worktop beside the stove",
         "Provide adequate countertop space near the stove.",
         "Hard: at least 300 mm of worktop on one side of the stove, and worktop between the stove and the "
         "refrigerator. Scored: 400 mm on one side and 300 mm on the other."),
    Rule("R6", "fridge_door", "Refrigerator door opens fully",
         "Leave sufficient space for refrigerator doors to open fully.",
         "Hard: the floor the door swings over is empty. Scored: a further 500 mm to stand in, and the open "
         "door clear of the room's doorway."),
    Rule("R7", "opened_units", "Open cupboards and drawers off the path",
         "Arrange cupboards and drawers so they do not block essential walking paths when opened.",
         "Scored: each cupboard, drawer and appliance door is opened in turn, and a person must still get "
         "from the entrance to the sink, the stove, the refrigerator and the table."),
    Rule("R8", "utensils", "Utensils by the cooking area",
         "Store frequently used cooking utensils near the preparation or cooking area.",
         "Built in: a utensil drawer unit always stands beside the stove. Scored: on the preparation side."),
    Rule("R9", "working_route", "Clear working route",
         "Keep a clear working route between the sink, preparation area, stove, and refrigerator.",
         "Hard: 900 mm of clear floor in front of every unit, and a path from the entrance to the sink, the "
         "stove and the refrigerator. Scored: up to 1200 mm, nothing standing on the route, and no "
         "through-traffic across it."),
    Rule("R10", "dining", "Dining clear of the cooking",
         "Position the dining table and chairs so they do not interfere with cooking and washing activities.",
         "Hard: table and chairs, pushed back, stay off the floor in front of every unit. Scored: outside "
         "the work triangle, reached without crossing it, and away from the stove."),
    Rule("R11", "food_separation", "Raw and ready-to-eat food apart",
         "Organize raw-food preparation and ready-to-eat food handling to reduce cross-contamination.",
         "Scored: a second worktop, apart from the one beside the sink, for cooked and ready-to-eat food; "
         "and food moving one way - refrigerator, sink, preparation, stove."),
    Rule("R12", "appliances_and_space", "Appliance sizes, doors and floor space",
         "Consider appliance dimensions, door-opening directions, and available floor space before "
         "finalizing the layout.",
         "Decides the size of the sink, the stove and the refrigerator. Scored: the size the room called "
         "for fits, no two doors open into each other, and the furniture leaves a clear area of floor."),
)
RULE_BY_ID: Dict[str, Rule] = {rule.id: rule for rule in RULES}

#: the rules `core()` scores - the ones the search can compare combinations by
CORE_RULES = ("R1", "R2", "R3", "R4", "R5", "R11")


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
class Facts:
    """Everything measured about where the sink, the stove and the refrigerator stand."""

    stretches: Tuple[Stretch, ...]
    prep: Stretch                       # the preparation worktop, beside the sink
    sink_far: float                     # worktop on the other side of the sink
    sink_window: str                    # "under" | "wall" | "away" | "none"
    sink_corner: float                  # worktop between the sink and the nearest inside corner
    relation: str                       # "direct" | "blocked" | "across": how the stove relates to the sink
    facing: bool                        # across the aisle, and directly opposite each other
    stove_sides: Tuple[float, float]    # worktop either side of the stove, larger first
    stove_window: bool
    stove_door: float                   # from the stove to the doorway
    legs: Tuple[float, float, float]    # sink-stove, sink-refrigerator, stove-refrigerator
    ready: Optional[Stretch]            # the worktop for cooked and ready-to-eat food
    ready_len: float
    flow: str                           # the order food meets the three in


def metres(mm: float) -> str:
    return "{:.2f} m".format(mm / 1000.0)


def _band_score(value: float, low: float, high: float, floor: float, ceiling: float) -> float:
    """1 inside [low, high], falling to 0 at `floor` below it and at `ceiling` above."""
    if value < low:
        return clamp01((value - floor) / (low - floor))
    if value > high:
        return clamp01((ceiling - value) / (ceiling - high))
    return 1.0


class Evaluator:
    """Scores a kitchen against the twelve rules and re-checks every hard limit."""

    def __init__(self, room: Room, doors: List[Door], windows: List[Window], programme: Programme, config: Config):
        self.room = room
        self.doors = doors
        self.windows = windows
        self.programme = programme
        self.config = config
        self.c = config.clearances
        self.main_door: Optional[Door] = next((d for d in doors if d.is_main), None)
        # every patch of floor nothing may stand on: each door's sweep, then the
        # parts of a non-rectangular room's box that are not floor. The doors
        # come first, so zip(self.doors, self.door_zones) still pairs them up.
        self.door_zones = [d.keep_clear(room, self.c.door_entry_depth) for d in doors] + list(room.cutouts)
        self.window_bands = [(w, w.access(room, self.c.window_access_depth)) for w in windows]
        self.weights = {rule.id: float(getattr(config.weights, rule.key)) for rule in RULES}

    def _result(self, rule_id: str, score: float, detail: str = "") -> RuleResult:
        return RuleResult(RULE_BY_ID[rule_id], clamp01(score), self.weights[rule_id], detail)

    def _skip(self, rule_id: str, detail: str) -> RuleResult:
        return RuleResult(RULE_BY_ID[rule_id], 0.0, self.weights[rule_id], detail, applicable=False)

    @staticmethod
    def total(results: Dict[str, RuleResult]) -> float:
        """0-100: points earned out of the points the applicable rules could give."""
        weight = sum(r.weight for r in results.values() if r.applicable)
        return 100.0 * sum(r.points for r in results.values()) / weight if weight else 0.0

    # ------------------------------------------------------------------ #
    # measuring one sink / stove / refrigerator combination
    # ------------------------------------------------------------------ #
    def measure(self, arr: Arrangement, sink: Station, stove: Station, fridge: Station) -> Optional[Facts]:
        """The facts rules 1-5 and 11 are scored on - or None when a hard limit is broken."""
        c = self.c
        stations = (sink, stove, fridge)

        # the worktop left between the appliances on every chain
        stretches: List[Stretch] = []
        for index, chain in enumerate(arr.chains):
            cursor, last = 0.0, ""
            for station in sorted((s for s in stations if s.chain == index), key=lambda s: s.s0):
                gap = station.s0 - cursor
                if gap < -1.0:
                    return None                     # two appliances overlap
                if gap > 1.0:
                    if gap < c.min_counter - 1.0:
                        return None                 # a filler nobody can work on
                    stretches.append(Stretch(index, cursor, station.s0, tuple(k for k in (last, station.kind) if k)))
                elif last and "stove" in (last, station.kind):
                    return None                     # rules 3 and 5: nothing stands hard against the stove
                cursor, last = station.s1, station.kind
            tail = chain.length - cursor
            if tail > 1.0:
                if tail < c.min_counter - 1.0:
                    return None
                stretches.append(Stretch(index, cursor, chain.length, (last,) if last else ()))

        # rule 2: the preparation worktop is the one beside the sink - towards the stove when it can be
        by_sink = [s for s in stretches if "sink" in s.touches]
        between = next((s for s in by_sink if "stove" in s.touches), None)
        if between is not None:
            relation, prep = "direct", between
        else:
            relation = "blocked" if sink.chain == stove.chain else "across"
            prep = max(by_sink, key=lambda s: s.length, default=None)
        if prep is None or prep.length < c.prep_min - 1.0:
            return None
        sink_far = max((s.length for s in by_sink if s is not prep), default=0.0)

        # rule 5: worktop either side of the stove
        by_stove = sorted((s.length for s in stretches if "stove" in s.touches), reverse=True) + [0.0, 0.0]
        if by_stove[0] < c.stove_landing_min - 1.0:
            return None

        sink_window = "none"
        if self.windows:
            on_wall = [w for w in self.windows if w.wall == sink.wall]
            under = max((span_overlap(sink.t0, sink.t1, w.start, w.end) for w in on_wall), default=0.0)
            sink_window = "under" if under >= 0.5 * sink.spec.width else "wall" if on_wall else "away"
        stove_window = any(
            w.wall == stove.wall and span_overlap(stove.t0, stove.t1, w.start, w.end) > 1.0 for w in self.windows)

        # rule 11: a second worktop for cooked and ready-to-eat food, the further from the sink the better
        ready, ready_len = None, 0.0
        for stretch in stretches:
            if stretch is prep or stretch.length < c.ready_counter_min - 1.0:
                continue
            worth = min(stretch.length, 1200.0) * (0.6 if "sink" in stretch.touches else 1.0)
            if worth > ready_len:
                ready, ready_len = stretch, worth

        legs = (
            math.dist(sink.front, stove.front),
            math.dist(sink.front, fridge.front),
            math.dist(stove.front, fridge.front),
        )
        if sink.chain == stove.chain == fridge.chain:
            middle = sorted(stations, key=lambda s: s.s0)[1].kind
            flow = {"sink": "fridge-sink-stove", "stove": "fridge-stove-sink", "fridge": "sink-fridge-stove"}[middle]
        else:
            flow = "near" if legs[1] <= legs[2] + 300.0 else "far"

        return Facts(
            stretches=tuple(stretches),
            prep=prep,
            sink_far=sink_far,
            sink_window=sink_window,
            sink_corner=arr.chains[sink.chain].corner_gap(sink.s0, sink.s1),
            relation=relation,
            facing=relation == "across" and span_overlap(sink.t0, sink.t1, stove.t0, stove.t1) > 1.0,
            stove_sides=(by_stove[0], by_stove[1]),
            stove_window=stove_window,
            stove_door=distance(stove.rect, self.main_door.opening(self.room)) if self.main_door else float("inf"),
            legs=legs,
            ready=ready,
            ready_len=ready_len,
            flow=flow,
        )

    # ------------------------------------------------------------------ #
    # rules 1-5 and 11: scored from the facts alone
    # ------------------------------------------------------------------ #
    def core(self, facts: Facts, explain: bool = False) -> Dict[str, RuleResult]:
        return {
            "R1": self._sink_location(facts, explain),
            "R2": self._prep_by_sink(facts, explain),
            "R3": self._safe_workflow(facts, explain),
            "R4": self._work_triangle(facts, explain),
            "R5": self._stove_counter(facts, explain),
            "R11": self._food_separation(facts, explain),
        }

    def rank(self, facts: Facts) -> float:
        """Points the six core rules give - what the search sorts combinations by."""
        return sum(result.points for result in self.core(facts).values())

    def _sink_location(self, facts: Facts, explain: bool) -> RuleResult:
        c = self.c
        landing = 0.4 + 0.6 * clamp01(facts.sink_far / c.sink_landing_good)
        corner = 1.0 if facts.sink_corner >= 2 * c.corner_clear else 0.8
        if facts.sink_window == "none":
            score = (0.45 * landing + 0.20 * corner) / 0.65
        else:
            window = {"under": 1.0, "wall": 0.7, "away": 0.5}[facts.sink_window]
            score = 0.45 * landing + 0.35 * window + 0.20 * corner
        if not explain:
            return self._result("R1", score)
        where = {
            "under": "The sink stands under a window, with daylight on the washing-up",
            "wall": "The sink is on the window wall but not under the window",
            "away": "The sink is on a wall without a window",
            "none": "The sink",
        }[facts.sink_window]
        if facts.sink_far > 1.0:
            text = "{}{} {} of worktop on its other side to drain and stack".format(
                where, "; it has" if facts.sink_window != "none" else " has", metres(facts.sink_far))
        else:
            text = "{}{} no worktop on its other side".format(
                where, "; it has" if facts.sink_window != "none" else " has")
        if facts.sink_corner < 2 * c.corner_clear:
            text += ", and is only {} from the corner".format(metres(facts.sink_corner))
        return self._result("R1", score, text + ".")

    def _prep_by_sink(self, facts: Facts, explain: bool) -> RuleResult:
        c = self.c
        length = facts.prep.length
        score = 0.6 + 0.4 * clamp01((length - c.prep_min) / (c.prep_preferred - c.prep_min))
        text = "The preparation worktop starts at the sink and is {} long (at least {} is needed).".format(
            metres(length), metres(c.prep_min))
        return self._result("R2", score, text if explain else "")

    def _safe_workflow(self, facts: Facts, explain: bool) -> RuleResult:
        c = self.c
        carry = facts.prep.length
        if facts.relation == "direct":
            score = 1.0 - 0.4 * clamp01((carry - c.prep_far) / (c.prep_too_far - c.prep_far))
        elif facts.relation == "across":
            score = 0.55 if facts.facing else 0.7
        else:
            score = 0.3
        if facts.stove_window:
            score *= 0.6
        if self.main_door is not None:
            score *= 0.6 + 0.4 * clamp01(facts.stove_door / c.stove_door_good)
        if not explain:
            return self._result("R3", score)

        if facts.relation == "direct":
            text = "Sink, {} of preparation worktop, then the stove, in one line with nothing between".format(
                metres(carry))
            if carry > c.prep_far:
                text += " - a long way to carry a full pan"
        elif facts.relation == "across":
            text = "The stove is across the aisle from the sink{}, so pans are carried over the walkway".format(
                ", directly opposite it" if facts.facing else "")
        else:
            text = "The refrigerator stands between the sink and the stove, so food is carried round it"
        text += "."
        if facts.stove_window:
            text += " The stove is under a window, where a draught can reach the flame."
        if self.main_door is not None:
            text += " The stove is {} from the doorway.".format(metres(facts.stove_door))
        return self._result("R3", score, text)

    def _work_triangle(self, facts: Facts, explain: bool, blocked_by: str = "") -> RuleResult:
        c = self.c
        legs = facts.legs
        floor, ceiling = c.leg_min / 2.0, c.leg_max + (c.leg_max - c.leg_min)
        leg_score = sum(_band_score(leg, c.leg_min, c.leg_max, floor, ceiling) for leg in legs) / 3.0
        round_trip = sum(legs)
        round_score = _band_score(round_trip, c.triangle_min, c.triangle_max,
                                  c.triangle_min * 0.6, c.triangle_max * 1.4)
        score = 0.6 * leg_score + 0.4 * round_score
        if blocked_by:
            score *= 0.7
        if not explain:
            return self._result("R4", score)
        text = ("Sink to stove {}, sink to refrigerator {}, stove to refrigerator {}; {} round "
                "(each leg should be {:.1f} to {:.1f} m, the triangle {:.1f} to {:.1f} m).").format(
            metres(legs[0]), metres(legs[1]), metres(legs[2]), metres(round_trip),
            c.leg_min / 1000.0, c.leg_max / 1000.0, c.triangle_min / 1000.0, c.triangle_max / 1000.0)
        if blocked_by:
            text += " The {} stands across one of its legs.".format(blocked_by)
        return self._result("R4", score, text)

    def _stove_counter(self, facts: Facts, explain: bool) -> RuleResult:
        c = self.c
        big, small = facts.stove_sides
        score = 0.6 * clamp01(big / c.stove_landing_good) + 0.4 * clamp01(small / c.stove_landing_min)
        if not explain:
            return self._result("R5", score)
        if small > 1.0:
            text = "{} of worktop on one side of the stove and {} on the other, to set pans down.".format(
                metres(big), metres(small))
        else:
            text = "{} of worktop on one side of the stove and none on the other.".format(metres(big))
        return self._result("R5", score, text)

    def _food_separation(self, facts: Facts, explain: bool) -> RuleResult:
        c = self.c
        if facts.ready_len < c.ready_counter_min - 1.0:
            apart = 0.2
        else:
            apart = 0.6 + 0.4 * clamp01(
                (facts.ready_len - c.ready_counter_min) / (c.ready_counter_good - c.ready_counter_min))
        one_way = {
            "fridge-sink-stove": 1.0, "near": 1.0, "far": 0.7, "fridge-stove-sink": 0.6, "sink-fridge-stove": 0.4,
        }[facts.flow]
        score = 0.6 * apart + 0.4 * one_way
        if not explain:
            return self._result("R11", score)

        text = "Raw food is washed and cut on the {} worktop beside the sink".format(metres(facts.prep.length))
        if facts.ready is None:
            text += "; there is no second worktop, so cooked and ready-to-eat food has to share it"
        else:
            beside = "beside the stove" if "stove" in facts.ready.touches else \
                "beside the refrigerator" if "fridge" in facts.ready.touches else "on its own"
            text += "; cooked and ready-to-eat food has a separate {} worktop {}".format(
                metres(facts.ready.length), beside)
            if "sink" in facts.ready.touches:
                text += ", though it also adjoins the sink"
        text += ". " + {
            "fridge-sink-stove": "Food moves one way: refrigerator, sink, preparation, stove.",
            "near": "Food moves one way: the refrigerator is nearer the sink than the stove.",
            "far": "The refrigerator is nearer the stove than the sink, so raw food passes the cooking area "
                   "on its way to be washed.",
            "fridge-stove-sink": "The stove stands between the refrigerator and the sink, so raw food passes "
                                 "the cooking area on its way to be washed.",
            "sink-fridge-stove": "The refrigerator stands between the sink and the stove, which breaks the "
                                 "line from washing to cooking.",
        }[facts.flow]
        return self._result("R11", score, text)

    # ------------------------------------------------------------------ #
    # measurements on the finished kitchen
    # ------------------------------------------------------------------ #
    def front_clear(self, lay: Layout, rect: Rect, wall: str, limit: float = 2000.0,
                    line: Optional[float] = None) -> float:
        """Clear floor straight in front of a unit, measured up to `limit`.

        Measured from the unit's own front, or from `line` - the front of the
        worktop - when the unit stands proud of the run, as a refrigerator does.
        """
        room = self.room
        lo, hi = room.along(wall, rect)
        far = room.out_from(wall, rect)[1] if line is None else line
        clear = min(limit, room.depth_from(wall) - far)
        front = room.band(wall, lo, hi, clear, offset=far)
        for item in lay.items:
            if item.rect != rect and intersects(front, item.rect):
                clear = min(clear, room.out_from(wall, item.rect)[0] - far)
        return max(clear, 0.0)

    def aisle(self, lay: Layout, station: Station, limit: float = 2000.0) -> float:
        """Rule 9: the working floor in front of a station, from the line of the worktop it stands in."""
        line = self.c.counter_depth if station.chain >= 0 else None
        return self.front_clear(lay, station.rect, station.wall, limit, line)

    def fridge_swing(self, lay: Layout) -> Rect:
        """The floor the refrigerator door sweeps as it opens."""
        fridge = lay.fridge
        return self.room.band(fridge.wall, fridge.t0, fridge.t1, fridge.spec.door, offset=fridge.spec.depth)

    def oven_door(self, lay: Layout) -> Rect:
        stove = lay.stove
        return self.room.band(stove.wall, stove.t0, stove.t1, stove.spec.door, offset=stove.spec.depth)

    @staticmethod
    def triangle(lay: Layout) -> Tuple[Point, Point, Point]:
        return (lay.sink.front, lay.stove.front, lay.fridge.front)

    def standing(self, station: Station, back: float = 350.0) -> Point:
        """Where someone using a station stands: `back` millimetres out from its front."""
        return self.room.point(station.wall, (station.t0 + station.t1) / 2.0, station.spec.depth + back)

    def route_blocker(self, lay: Layout) -> Optional[Item]:
        """The first thing standing on the line someone walks between refrigerator, sink and stove."""
        stops = [self.standing(lay.fridge), self.standing(lay.sink), self.standing(lay.stove)]
        for a, b in zip(stops, stops[1:]):
            for item in lay.items:
                if segment_hits(a, b, item.rect):
                    return item
        return None

    def triangle_blocker(self, lay: Layout) -> str:
        """What stands across a leg of the work triangle, if anything."""
        if lay.dining is None:
            return ""
        return "dining table" if rect_meets_triangle(lay.dining.seated, self.triangle(lay)) else ""

    def dining_marks(self, lay: Layout, dining) -> Tuple[bool, bool, float]:
        """Rule 10 for one table position: outside the work triangle, reached across it, distance from the stove."""
        triangle = self.triangle(lay)
        outside = not rect_meets_triangle(dining.seated, triangle)
        crossed = False
        if self.main_door is not None:
            start = self.room.point(self.main_door.wall, self.main_door.middle, 450.0 + self.main_door.inset)
            crossed = segment_meets_triangle(start, center(dining.table), triangle)
        return outside, crossed, distance(dining.seated, lay.stove.rect)

    # ------------------------------------------------------------------ #
    # rules 6-10 and 12: scored on the finished kitchen
    # ------------------------------------------------------------------ #
    def finish(
        self,
        lay: Layout,
        facts: Facts,
        report: CirculationReport,
        opened: Tuple[int, int, str],
        open_side: float,
    ) -> Dict[str, RuleResult]:
        """All twelve rules, with the measured numbers behind each."""
        results = self.core(facts, explain=True)
        results["R4"] = self._work_triangle(facts, True, self.triangle_blocker(lay))
        results["R6"] = self._fridge_door(lay)
        results["R7"] = self._opened_units(opened)
        results["R8"] = self._utensils(lay)
        results["R9"] = self._working_route(lay, report)
        results["R10"] = self._dining(lay)
        results["R12"] = self._appliances_and_space(lay, open_side)
        return {rule.id: results[rule.id] for rule in RULES}

    def _fridge_door(self, lay: Layout) -> RuleResult:
        c, fridge = self.c, lay.fridge
        door = fridge.spec.door
        clear = self.front_clear(lay, fridge.rect, fridge.wall)
        score = 0.6 + 0.4 * clamp01((clear - door) / c.fridge_standing) if clear >= door - 1.0 else 0.0
        text = "The refrigerator door swings {} into the room and {} is clear in front of it".format(
            metres(door), metres(clear))
        if fridge.spec.model == "double door":
            text = "Each leaf of the refrigerator swings {} into the room and {} is clear in front of it".format(
                metres(door), metres(clear))
        swing = self.fridge_swing(lay)
        doorway = next((d for d, zone in zip(self.doors, self.door_zones) if intersects(swing, zone)), None)
        if doorway is not None:
            score *= 0.7
            text += ", but the open door stands in the way of door {}".format(doorway.id)
        return self._result("R6", score, text + ".")

    def _opened_units(self, opened: Tuple[int, int, str]) -> RuleResult:
        passable, total, blocker = opened
        if self.main_door is None:
            return self._skip("R7", "No door was detected, so there was no way in to keep clear.")
        if total == 0:
            return self._skip("R7", "This kitchen has no cupboards or drawers to open.")
        text = ("{} of the {} cupboards, drawers and appliance doors can stand open and still leave {:.0f} mm "
                "to walk past").format(passable, total, self.c.opened_passage)
        if blocker:
            text += "; the {} blocks the way when it is open".format(blocker)
        return self._result("R7", passable / total, text + ".")

    def _utensils(self, lay: Layout) -> RuleResult:
        if lay.drawers is None:
            return self._result("R8", 0.0, "There is no worktop beside the stove to put utensil drawers under.")
        reach = distance(lay.drawers.rect, lay.stove.rect)
        score = (1.0 if lay.drawers_on_prep else 0.85) * (1.0 - 0.5 * clamp01(reach / self.c.utensil_reach))
        text = "The utensil drawers are {} the stove{}.".format(
            "right beside" if reach <= 1.0 else metres(reach) + " from",
            ", under the preparation worktop" if lay.drawers_on_prep
            else ", on the side away from the preparation worktop")
        return self._result("R8", score, text)

    def _working_route(self, lay: Layout, report: CirculationReport) -> RuleResult:
        c = self.c
        fronts = {s.kind: self.aisle(lay, s, 1500.0) for s in lay.stations}
        tightest = min(fronts, key=fronts.get)
        aisle = fronts[tightest]
        aisle_score = 0.6 + 0.4 * clamp01((aisle - c.aisle_min) / (c.aisle_preferred - c.aisle_min)) \
            if aisle >= c.aisle_min - 1.0 else 0.0
        blocker = self.route_blocker(lay)
        direct = 0.5 if blocker is not None else 1.0

        text = "{} of clear floor in front of the sink, the stove and the refrigerator".format(metres(aisle))
        if aisle < c.aisle_preferred:
            text += " (tightest at the {})".format({"fridge": "refrigerator"}.get(tightest, tightest))
        if report.checked:
            widths = c.path_widths
            span = max(widths) - min(widths)
            wide = 0.5 + 0.5 * (report.width - min(widths)) / span if span else 1.0
            score = 0.5 * aisle_score + 0.3 * wide + 0.2 * direct
            text += "; a path {:.0f} mm wide links them from the entrance".format(report.width)
        else:
            score = (0.5 * aisle_score + 0.2 * direct) / 0.7
        text += "."
        if blocker is not None:
            text += " The {} stands on the line walked between them.".format(blocker.role)

        # household traffic through the work zone: another door reached across the triangle
        if self.main_door is not None and len(self.doors) > 1:
            start = self.room.point(self.main_door.wall, self.main_door.middle, 450.0 + self.main_door.inset)
            for door in self.doors:
                if door is not self.main_door and segment_meets_triangle(
                        start, self.room.point(door.wall, door.middle, 450.0 + door.inset), self.triangle(lay)):
                    score *= 0.8
                    text += " The way from the entrance to door {} crosses the work triangle.".format(door.id)
                    break
        return self._result("R9", score, text)

    def _dining(self, lay: Layout) -> RuleResult:
        if lay.dining is None:
            return self._skip(
                "R10",
                "A dining table was planned but there is no floor for it clear of the working area."
                if self.programme.dining else "This kitchen has no dining table.")
        c, dining = self.c, lay.dining
        outside, crossed, from_stove = self.dining_marks(lay, dining)
        score = 0.5 * outside + 0.3 * (not crossed) + 0.2 * clamp01(from_stove / c.stove_table_good)
        text = "The table for {} stands {} the work triangle, {} from the stove".format(
            SEAT_WORDS[dining.seats], "outside" if outside else "inside", metres(from_stove))
        if self.main_door is not None:
            text += "; it is reached from the entrance {} the cooking area".format(
                "by crossing" if crossed else "without crossing")
        text += "."
        if any(intersects(dining.pullout, aisle) for aisle in lay.aisles):
            score *= 0.8
            text += " A chair pushed right back reaches into the floor the kitchen works on."
        return self._result("R10", score, text)

    def _appliances_and_space(self, lay: Layout, open_side: float) -> RuleResult:
        programme, thresholds, room = self.programme, self.config.rooms, self.room
        rank = programme.size_classes.index(lay.size_class) if lay.size_class in programme.size_classes else 0
        fit = max(0.4, 1.0 - 0.3 * rank)

        swing, oven = self.fridge_swing(lay), self.oven_door(lay)
        clashes = []
        if intersects(swing, oven):
            clashes.append("the refrigerator door and the oven door cannot both be open")
        for door, zone in zip(self.doors, self.door_zones):
            if intersects(oven, zone):
                clashes.append("the oven door opens into the way of door {}".format(door.id))
            if intersects(swing, zone):
                clashes.append("the refrigerator door opens into the way of door {}".format(door.id))
        doors = max(0.2, 1.0 - 0.4 * len(clashes))

        wanted = min(thresholds.open_floor_side, thresholds.open_floor_share * min(room.width, room.length))
        floor = clamp01(open_side / wanted)
        no_table = programme.dining and lay.dining is None      # the table the room was planned with did not fit
        score = 0.30 * fit + 0.30 * doors + 0.20 * floor + 0.20 * (not no_table)

        specs = lay.sink.spec, lay.stove.spec, lay.fridge.spec
        text = "{} appliances for a {:.1f} m2 kitchen ({} x {}): {}".format(
            lay.size_class.capitalize(), room.area_m2, metres(room.width), metres(room.length),
            ", ".join("{} {:.0f} mm wide".format(spec.label, spec.width) for spec in specs))
        if rank > 0:
            text += " - the {} ones the room called for do not fit this shape".format(programme.size_classes[0])
        text += ". " + (clashes[0].capitalize() + "." if clashes else "No two doors open into each other.")
        text += " The largest clear square of floor is {} across.".format(metres(open_side))
        if no_table:
            text += " This shape leaves no floor for the dining table the room was planned with."
        return self._result("R12", score, text)

    # ------------------------------------------------------------------ #
    # hard limits, re-checked on the finished kitchen
    # ------------------------------------------------------------------ #
    def violations(self, lay: Layout, facts: Facts, report: Optional[CirculationReport]) -> List[Dict]:
        """Every hard limit a finished kitchen breaks (empty for a valid one)."""
        room, c = self.room, self.c
        found: List[Dict] = []

        def add(rule_id: str, check: str, message: str, subject: str = "") -> None:
            found.append({
                "rule": RULE_BY_ID[rule_id].key, "rule_id": rule_id, "check": check,
                "message": message, "subject": subject,
            })

        items = list(lay.items)
        for index, item in enumerate(items):
            if not contains(room.rect, item.rect):
                add("R12", "boundary", "The {} extends outside the room.".format(item.role), item.id)
            for other in items[index + 1:]:
                if intersects(item.rect, other.rect):
                    add("R12", "overlap", "The {} overlaps the {}.".format(item.role, other.role), item.id)
            for door, zone in zip(self.doors, self.door_zones):
                if intersects(item.rect, zone):
                    add("R9", "door", "The {} stands where door {} needs to open.".format(item.role, door.id), item.id)
            for window, band in self.window_bands:
                if intersects(item.rect, band) and (
                        item.height >= c.tall_furniture_height or item.height > window.sill_height):
                    add("R12", "window", "The {} blocks window {}.".format(item.role, window.id), item.id)

        if facts.prep.length < c.prep_min - 1.0:
            add("R2", "prep", "The preparation worktop beside the sink is shorter than {:.0f} mm.".format(c.prep_min))
        if facts.stove_sides[0] < c.stove_landing_min - 1.0:
            add("R5", "stove", "The stove has less than {:.0f} mm of worktop beside it.".format(c.stove_landing_min))
        for station in (lay.sink, lay.stove):
            if station.chain >= 0 and lay.arrangement.chains[station.chain].corner_gap(
                    station.s0, station.s1) < c.corner_clear - 1.0:
                add("R1" if station.kind == "sink" else "R3", "corner",
                    "The {} is jammed into the corner.".format(station.kind), station.kind)

        fridge = lay.fridge
        if self.front_clear(lay, fridge.rect, fridge.wall) < fridge.spec.door - 1.0:
            add("R6", "fridge", "The refrigerator door cannot open fully.", "fridge")
        for station in lay.stations:
            if self.aisle(lay, station) < c.aisle_min - 1.0:
                add("R9", "aisle", "Less than {:.0f} mm is clear in front of the {}.".format(
                    c.aisle_min, {"fridge": "refrigerator"}.get(station.kind, station.kind)), station.kind)

        if lay.dining is not None:
            for zone in lay.aisles + tuple(self.door_zones):
                if intersects(lay.dining.seated, zone):
                    add("R10", "dining", "The dining table and chairs stand on floor the kitchen works on.")
                    break
            if not contains(room.rect, lay.dining.pullout) or any(
                    intersects(lay.dining.pullout, item.rect) for item in items if item.wall):
                add("R10", "dining", "There is no floor to push the dining chairs back.")

        if report is not None and report.checked and not report.valid:
            add("R9", "path", "No path at least {:.0f} mm wide links the entrance to {}.".format(
                c.path_min, ", ".join(report.unreachable) or "the rest of the kitchen"))
        return found
