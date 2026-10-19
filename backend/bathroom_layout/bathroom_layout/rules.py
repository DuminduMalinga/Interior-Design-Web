"""
The fifteen bathroom furniture- and fixture-arrangement rules.

Each rule is applied in up to three ways, and `RULES` records which:

* **built in** - the generator only ever proposes positions that obey it
  (the mirror is hung above the basin, never searched for);
* **hard**     - a position that breaks it is discarded, and `violations()`
  re-checks every such limit on the finished layout;
* **scored**   - a 0..1 mark for how well the layout does, weighted into the
  0-100 total and reported with the measured numbers behind it.

`Evaluator.static()` scores every rule that depends only on where things
stand. Rule 4 and parts of rules 7, 11 and 13 need the walkability map; they
are filled in from a `Walk` once a layout is complete (see `circulation.py`),
and assumed perfect while the search is still comparing candidates.

Rules 13 and 15 apply "where required": they are scored only when the request
says the user has mobility needs, and are reported as not applicable otherwise.

The rules score is then converted to 90 points, and the extra `FURNITURE_RULE`
adds the last 10, rewarding the layout with the most furniture.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .circulation import CirculationReport
from .config import Config
from .fixtures import BASINS, SHOWERS, Item, Layout
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
    span_overlap,
)
from .programme import Programme
from .room import WALL_ENDS, Door, Room, Window


@dataclass(frozen=True)
class Rule:
    id: str
    key: str       # also the name of its weight in config.Weights
    title: str
    text: str      # the rule as written
    method: str    # how the engine applies it


RULES: Tuple[Rule, ...] = (
    Rule("R1", "basin_entrance", "Basin near the entrance",
         "Position the washbasin where it can be easily accessed from the bathroom entrance.",
         "Scored: how far the basin is from the doorway, whether it is the first fixture reached and "
         "whether anything stands in the direct line."),
    Rule("R2", "toilet_space", "Space at the toilet",
         "Arrange the toilet to provide sufficient space for comfortable use.",
         "Hard: 380 mm from the pan's centre line to anything at either side and 500 mm clear in front. "
         "Scored: up to 450 mm and 750 mm, and out of the direct view from the door."),
    Rule("R3", "shower_entry", "Safe way in and out of the shower",
         "Position the shower area to allow safe entry and exit.",
         "Built in: the shower stands in a corner with a 700 mm way in. Hard: 600 mm of dry floor to "
         "step out on to. Scored: up to 800 mm, and clear of the door's swing."),
    Rule("R4", "walking_paths", "Clear walking paths",
         "Keep clear walking paths between the entrance, washbasin, toilet, and shower.",
         "Hard: one continuous path at least 600 mm wide links the entrance to all three. Scored: "
         "whether it is 750 or 900 mm wide, and how much floor is cut off."),
    Rule("R5", "basin_standing", "Standing room at the basin",
         "Provide sufficient space in front of the washbasin for standing and washing.",
         "Hard: 550 mm of floor in front of the basin, 700 mm wide. Scored: up to 750 mm in front and "
         "450 mm of elbow room either side of its centre line."),
    Rule("R6", "cabinet_position", "Cabinets out of the way",
         "Position bathroom cabinets so they do not obstruct movement or access to fixtures.",
         "Hard: a cabinet never stands in the floor a fixture or a door needs. Scored: clear of the "
         "direct lines from the door to each fixture and of the floor straight ahead of the door."),
    Rule("R7", "cabinet_doors", "Cabinet doors clear of the path",
         "Ensure cabinet doors and drawers can open without blocking essential walking paths.",
         "Hard: an open door never hits a fixture. Scored: each door is opened in turn; 500 mm must "
         "remain to reach the other fixtures, and the leaf must stay out of the room door's swing."),
    Rule("R8", "towel_reach", "Towels within reach",
         "Place towel racks within convenient reach of the shower or washbasin.",
         "Built in: the rail goes on the free wall nearest the way out of the shower, a towel ring "
         "nearest the basin. Scored: the reach to each, with full marks within 700 mm."),
    Rule("R9", "mirror", "Mirror at the basin",
         "Position mirrors above or near the washbasin at a suitable height.",
         "Built in: the mirror is hung above the basin, 1.1 to 1.9 m above the floor. Scored: above the "
         "basin, on the side wall beside it when a window is in the way, or nowhere."),
    Rule("R10", "toiletries_reach", "Toiletries within reach",
         "Keep frequently used toiletries within easy reach.",
         "Built in: a shelf inside the shower. Scored: a mirror cabinet over the basin, the paper "
         "holder within 600 mm of the pan, and the storage one step from the basin."),
    Rule("R11", "splash_control", "Water kept off the walking area",
         "Arrange fixtures to reduce water splashing onto walking areas.",
         "Scored: the shower is the fixture furthest from the door, the route to the basin and the "
         "toilet stays out of the wet floor at the shower, and walls enclose the shower."),
    Rule("R12", "clear_floor", "Unobstructed floor",
         "Keep the floor area unobstructed to reduce tripping risks.",
         "Built in: every fixture stands against a wall and nothing stands in a door's swing. Scored: "
         "floor covered, the largest clear square and straight lines from the door to each fixture."),
    Rule("R13", "wheelchair_access", "Wheelchair and mobility-aid access",
         "Provide sufficient space for wheelchair or mobility-aid access where required.",
         "When required - hard: a clear 1.5 m turning square, 800 mm beside the pan to transfer and a "
         "900 mm path. Scored on those and on the door width. Otherwise not applicable."),
    Rule("R14", "floor_and_drainage", "Non-slip floor and drainage",
         "Use suitable non-slip flooring and provide effective drainage to reduce water accumulation.",
         "Built in: a non-slip finish laid to a 1:80 fall towards a drain in the shower. Scored: the "
         "water runs away from the door and no part of the floor is far from the drain."),
    Rule("R15", "grab_bars", "Grab bars at the toilet and shower",
         "Install appropriate grab bars near the toilet and shower when required by the user's mobility needs.",
         "When required - built in: a bar inside the shower and bars at the pan. Scored: a fixed bar on "
         "a side wall within 500 mm of the pan rather than drop-down rails. Otherwise not applicable."),
)
RULE_BY_ID: Dict[str, Rule] = {rule.id: rule for rule in RULES}

#: the extra rule, scored last: it compares a layout with the others generated
#: for the same room, so it is added once they are all chosen (see generator.py)
FURNITURE_RULE = Rule(
    "R16", "furniture_count", "Most furniture",
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

    path_width: float = 0.0                     # widest path that links every fixture
    dry_route: Optional[bool] = None            # rule 11: the route avoids the wet floor at the shower
    leaves: List[Tuple[str, bool, bool]] = field(default_factory=list)   # rule 7: (door, path ok, in room door)
    open_side: float = 0.0                      # rule 12: largest clear square of floor
    turning: float = 0.0                        # rule 13: the same, with a level shower floor counted as floor


def metres(mm: float) -> str:
    return "{:.2f} m".format(mm / 1000.0)


def label(item: Item) -> str:
    return {"washbasin": "basin", "bathroom_cabinet": "cabinet"}.get(item.type, item.type.replace("_", " "))


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
    """Scores a layout against the fifteen rules and re-checks every hard limit."""

    def __init__(self, room: Room, doors: List[Door], windows: List[Window], programme: Programme, config: Config):
        self.room = room
        self.doors = doors
        self.windows = windows
        self.programme = programme
        self.config = config
        self.c = config.clearances
        self.a = config.access
        self.accessible = programme.accessible
        self.main_door: Optional[Door] = next((d for d in doors if d.is_main), None)
        self.door_point: Optional[Point] = self.main_door.center(room) if self.main_door else None
        # every patch of floor nothing may stand on: each door's sweep, then the
        # parts of a non-rectangular room's box that are not floor. The doors
        # come first, so zip(self.doors, self.door_zones) still pairs them up.
        self.door_zones = [d.keep_clear(room, self.c.door_entry_depth) for d in doors] + list(room.cutouts)
        self.window_bands = [(w, w.access(room, self.c.window_access_depth)) for w in windows]
        self.weights = {rule.id: float(getattr(config.weights, rule.key)) for rule in RULES}
        corners = [(0.0, 0.0), (room.width, 0.0), (0.0, room.length), (room.width, room.length)]
        self.corners = corners
        self.door_far = max(math.hypot(x - self.door_point[0], y - self.door_point[1])
                            for x, y in corners) if self.door_point else 0.0

    # ------------------------------------------------------------------ #
    def _result(self, rule_id: str, score: float, detail: str = "") -> RuleResult:
        return RuleResult(RULE_BY_ID[rule_id], clamp01(score), self.weights[rule_id], detail)

    def _skip(self, rule_id: str, detail: str) -> RuleResult:
        return RuleResult(RULE_BY_ID[rule_id], 0.0, self.weights[rule_id], detail, applicable=False)

    def static(self, lay: Layout, explain: bool = False, walk: Optional[Walk] = None) -> Dict[str, RuleResult]:
        """Every rule but the walking path. Without a `walk`, the parts that need one are assumed perfect."""
        return {
            "R1": self._basin_entrance(lay, explain),
            "R2": self._toilet_space(lay, explain),
            "R3": self._shower_entry(lay, explain),
            "R5": self._basin_standing(lay, explain),
            "R6": self._cabinet_position(lay, explain),
            "R7": self._cabinet_doors(lay, explain, walk),
            "R8": self._towel_reach(lay, explain),
            "R9": self._mirror(lay, explain),
            "R10": self._toiletries(lay, explain),
            "R11": self._splash(lay, explain, walk),
            "R12": self._clear_floor(lay, explain, walk),
            "R13": self._wheelchair(lay, explain, walk),
            "R14": self._drainage(lay, explain),
            "R15": self._grab_bars(lay, explain),
        }

    @staticmethod
    def total(results: Dict[str, RuleResult]) -> float:
        """0-100: points earned out of the points the applicable rules could give."""
        weight = sum(r.weight for r in results.values() if r.applicable)
        return 100.0 * sum(r.points for r in results.values()) / weight if weight else 0.0

    # ------------------------------------------------------------------ #
    # measurements shared by the rules, the fit-out and the hard-limit re-check
    # ------------------------------------------------------------------ #
    def side_clear(self, lay: Layout, item: Item, reach: float) -> Dict[str, Tuple[float, str]]:
        """From the centre line of `item` to the nearest thing on each side: (distance, what it is).

        Only what stands within `reach` of the item's own wall counts - that is
        what the user's elbows and knees meet.
        """
        room, wall = self.room, item.wall
        lo, hi = room.along(wall, item.rect)
        mid, length = (lo + hi) / 2.0, room.wall_length(wall)
        out = {"lo": (mid, "wall"), "hi": (length - mid, "wall")}
        strip = room.band(wall, 0.0, length, reach)
        for other in lay.fixtures:
            if other is item or not intersects(other.rect, strip):
                continue
            o_lo, o_hi = room.along(wall, other.rect)
            if o_hi <= mid:
                hits = [("lo", mid - o_hi)]
            elif o_lo >= mid:
                hits = [("hi", o_lo - mid)]
            else:
                hits = [("lo", 0.0), ("hi", 0.0)]
            for side, gap in hits:
                if gap < out[side][0]:
                    out[side] = (gap, label(other))
        return out

    def reach_out(self, lay: Layout, rect: Rect, direction: str, skip: Tuple[Item, ...] = (),
                  limit: float = 1500.0) -> float:
        """Clear floor beyond the `direction` face of `rect`, across its whole width."""
        room = self.room
        clear = {
            "east": room.width - rect[2], "west": rect[0], "north": room.length - rect[3], "south": rect[1],
        }[direction]
        if clear <= 0:
            return 0.0
        sweep = beyond(rect, direction, clear)
        for other in lay.fixtures:
            if any(other is s for s in skip) or not intersects(sweep, other.rect):
                continue
            o = other.rect
            gap = {"east": o[0] - rect[2], "west": rect[0] - o[2], "north": o[1] - rect[3], "south": rect[1] - o[3]}
            clear = min(clear, gap[direction])
        return max(min(clear, limit), 0.0)

    def front_clear(self, lay: Layout, item: Item) -> float:
        return self.reach_out(lay, item.rect, item.facing, (item,))

    @staticmethod
    def opening(lay: Layout) -> Rect:
        """The way into the shower, as a zero-depth strip on its open side."""
        s, (a, b) = lay.shower.rect, lay.entry_span
        return {
            "east": (s[2], a, s[2], b), "west": (s[0], a, s[0], b),
            "north": (a, s[3], b, s[3]), "south": (a, s[1], b, s[1]),
        }[lay.entry_side]

    def side_strip(self, wall: str, side: str, out0: float, out1: float, thickness: float) -> Rect:
        """A strip against the wall at the `side` ("lo" / "hi") end of `wall`, from `out0` to `out1` out from it."""
        length = self.room.wall_length(wall)
        start = 0.0 if side == "lo" else length - thickness
        return self.room.band(wall, start, start + thickness, out1 - out0, offset=out0)

    def stands(self, lay: Layout) -> List[Tuple[str, Rect, Item]]:
        """Where a person stands to use each fixture."""
        out = [("the basin", lay.basin_stand, lay.basin), ("the toilet", lay.toilet_stand, lay.toilet)]
        if lay.shower is not None:
            out.append(("the shower", lay.shower_exit, lay.shower))
        return out

    def lines(self, lay: Layout) -> List[Tuple[str, Optional[Item]]]:
        """For each fixture, the first other fixture standing in the straight line to it from the door."""
        out: List[Tuple[str, Optional[Item]]] = []
        if self.door_point is None:
            return out
        for name, stand, owner in self.stands(lay):
            target = center(stand)
            out.append((name, next(
                (f for f in lay.fixtures if f is not owner and segment_hits(self.door_point, target, f.rect)),
                None)))
        return out

    def mirror_place(self, lay: Layout) -> Tuple[str, str]:
        """Rule 9: ("above", "") | ("beside", side) | ("none", "")."""
        room, basin = self.room, lay.basin
        wall = basin.wall
        lo, hi = room.along(wall, basin.rect)
        if not any(w.wall == wall and span_overlap(lo, hi, w.start, w.end) > 50.0 for w in self.windows):
            return ("above", "")
        length = room.wall_length(wall)
        for side, gap in (("lo", lo), ("hi", length - hi)):
            if gap > self.c.mirror_side_reach:
                continue
            side_wall = WALL_ENDS[wall][0 if side == "lo" else 1]
            strip = self.side_strip(wall, side, 0.0, basin.depth, 40.0)
            s_lo, s_hi = room.along(side_wall, strip)
            openings = [o for o in list(self.doors) + list(self.windows) if o.wall == side_wall]
            if any(span_overlap(s_lo, s_hi, o.start, o.end) > 1.0 for o in openings):
                continue
            b_lo, b_hi = (0.0, lo) if side == "lo" else (hi, length)
            between = room.band(wall, b_lo, b_hi, basin.depth)
            if any(f is not basin and intersects(f.rect, between) for f in lay.fixtures):
                continue
            return ("beside", side)
        return ("none", "")

    def roll_holder(self, lay: Layout) -> str:
        """Rule 10: where the paper holder can be fixed - "wall", "fixture" or a floor "stand"."""
        sides = self.side_clear(lay, lay.toilet, lay.toilet.depth)
        near = [kind for gap, kind in sides.values() if gap <= self.c.reach]
        if "wall" in near:
            return "wall"
        return "fixture" if near else "stand"

    def toilet_bar(self, lay: Layout) -> Tuple[str, str]:
        """Rule 15: ("wall", side) when a side wall is near enough for a fixed bar, else ("drop_down", "")."""
        sides = self.side_clear(lay, lay.toilet, lay.toilet.depth)
        for side in sorted(sides, key=lambda s: sides[s][0]):
            gap, kind = sides[side]
            if kind == "wall" and gap <= self.a.wall_bar_reach:
                return ("wall", side)
        return ("drop_down", "")

    def transfer_space(self, lay: Layout) -> float:
        """Rule 13: the wider clear floor beside the pan, measured from its edge."""
        sides = self.side_clear(lay, lay.toilet, lay.toilet.depth)
        return max(gap for gap, _ in sides.values()) - lay.toilet.width / 2.0

    def drain_point(self, lay: Layout) -> Tuple[Point, bool]:
        """Rule 14: where the floor drain goes, and whether that is inside the shower."""
        room, inset = self.room, self.c.drain_inset
        if lay.shower is not None:
            s = lay.shower.rect
            x = s[0] + inset if "west" in lay.corner else s[2] - inset
            y = s[1] + inset if "south" in lay.corner else s[3] - inset
            return ((min(max(x, s[0]), s[2]), min(max(y, s[1]), s[3])), True)
        origin = self.door_point or (room.width / 2.0, room.length / 2.0)
        spots = [(inset if cx == 0 else room.width - inset, inset if cy == 0 else room.length - inset)
                 for cx, cy in self.corners]
        free = [p for p in spots if not any(point_gap(p, f.rect) < 1.0 for f in lay.fixtures)] or spots
        return (max(free, key=lambda p: (math.hypot(p[0] - origin[0], p[1] - origin[1]), p)), False)

    def leaves(self, lay: Layout) -> List[Tuple[str, Rect]]:
        """Rule 7: the floor each cabinet door sweeps when opened."""
        out: List[Tuple[str, Rect]] = []
        basin = lay.basin
        if BASINS[basin.model].doors:
            out.append(("the vanity doors",
                        beyond(basin.rect, basin.facing, min(basin.width / 2.0, self.c.cabinet_leaf_max))))
        if lay.cabinet is not None and lay.cabinet_leaf is not None:
            out.append(("the cabinet door", lay.cabinet_leaf))
        return out

    # ------------------------------------------------------------------ #
    # rule 1 - the basin and the entrance
    # ------------------------------------------------------------------ #
    def _basin_entrance(self, lay: Layout, explain: bool) -> RuleResult:
        if self.door_point is None:
            return self._skip("R1", "No door was detected, so there is no entrance to measure from.")
        c, door = self.c, self.door_point
        gap = point_gap(door, lay.basin_stand)
        near = clamp01((c.basin_door_far - gap) / (c.basin_door_far - c.basin_door_near))
        others = [(name, point_gap(door, stand)) for name, stand, owner in self.stands(lay) if owner is not lay.basin]
        before = [name for name, other in others if other < gap - 1.0]
        order = (1.0, 0.6, 0.3)[min(len(before), 2)]
        blocker = next(b for name, b in self.lines(lay) if name == "the basin")
        score = 0.5 * near + 0.3 * order + 0.2 * (0.0 if blocker else 1.0)
        if not explain:
            return self._result("R1", score)
        detail = "The basin is {} from the doorway, {}; {}.".format(
            metres(gap),
            "the first fixture reached" if not before else "reached after {}".format(_join(before)),
            "the {} stands in the direct line to it".format(label(blocker)) if blocker
            else "nothing stands in the direct line to it")
        return self._result("R1", score, detail)

    # ------------------------------------------------------------------ #
    # rule 2 - the toilet
    # ------------------------------------------------------------------ #
    def _toilet_space(self, lay: Layout, explain: bool) -> RuleResult:
        c, room, toilet = self.c, self.room, lay.toilet
        sides = self.side_clear(lay, toilet, room.out_from(toilet.wall, lay.toilet_zone)[1])
        side = min(gap for gap, _ in sides.values())
        front = self.front_clear(lay, toilet)
        in_view = False
        if self.main_door is not None:
            door = self.main_door
            ahead = room.band(door.wall, door.start, door.end, room.depth_from(door.wall) - door.inset, door.inset)
            in_view = intersects(ahead, toilet.rect)
        score = (0.45 * grade(side, c.toilet_side_min, c.toilet_side_preferred)
                 + 0.45 * grade(front, c.toilet_front_min, c.toilet_front_preferred)
                 + 0.10 * (0.0 if in_view else 1.0))
        if not explain:
            return self._result("R2", score)
        detail = "{} from the pan's centre line to the nearest thing beside it ({} needed) and {} clear in front " \
                 "({} needed)".format(metres(side), metres(c.toilet_side_min), metres(front),
                                      metres(c.toilet_front_min))
        if self.main_door is not None:
            detail += "; it is {} the doorway".format("straight ahead of" if in_view else "out of the direct view from")
        return self._result("R2", score, detail + ".")

    # ------------------------------------------------------------------ #
    # rule 3 - the shower
    # ------------------------------------------------------------------ #
    def exit_depth(self, lay: Layout) -> float:
        return self.reach_out(lay, self.opening(lay), lay.entry_side, (lay.shower,))

    def _shower_entry(self, lay: Layout, explain: bool) -> RuleResult:
        if lay.shower is None:
            return self._skip("R3", "There is no shower in this layout.")
        c = self.c
        depth = self.exit_depth(lay)
        width = lay.entry_span[1] - lay.entry_span[0]
        swept = any(intersects(lay.shower_exit, zone) for zone in self.door_zones)
        score = (0.60 * grade(depth, c.shower_exit_min, c.shower_exit_preferred)
                 + 0.15 * grade(width, 600.0, c.shower_opening)
                 + 0.25 * (0.0 if swept else 1.0))
        if not explain:
            return self._result("R3", score)
        spec = SHOWERS[lay.shower.model]
        detail = "A {} way in on its {} side with {} of dry floor to step out on to ({} needed), {}; {}.".format(
            metres(width), lay.entry_side, metres(depth), metres(c.shower_exit_min),
            "where the room door swings" if swept else "clear of the room door's swing",
            "the floor runs level into it, with nothing to step over" if spec.level
            else "a low-profile tray keeps the step under 40 mm")
        return self._result("R3", score, detail)

    # ------------------------------------------------------------------ #
    # rule 4 - walking paths (needs the walkability report)
    # ------------------------------------------------------------------ #
    def path_result(self, lay: Layout, report: CirculationReport) -> RuleResult:
        c = self.c
        if not report.checked:
            return self._skip("R4", "No door was detected, so there is no entrance to walk from.")
        places = "the entrance, the basin{} the toilet{}".format(
            *((",", " and the shower") if lay.shower is not None else (" and", "")))
        if not report.valid:
            return self._result("R4", 0.0, "No path {} wide reaches {}.".format(
                metres(c.path_min), _join(report.unreachable) if report.unreachable else "the rest of the room"))
        top, low = max(c.path_widths), c.path_min
        score = 1.0 if report.width >= top else 0.6 + 0.4 * max(report.width - low, 0.0) / ((top - low) or 1.0)
        detail = "One continuous path {} wide links {}".format(metres(report.width), places)
        if report.pinch and report.width < top:
            detail += "; at {} it stops short of {}".format(metres(report.pinch[0]), _join(report.pinch[1]))
        if report.reached_ratio < c.cut_off_tolerance:
            score *= report.reached_ratio / c.cut_off_tolerance
            detail += "; {:.0f}% of the open floor cannot be walked on to".format(100 * (1 - report.reached_ratio))
        return self._result("R4", score, detail + ".")

    # ------------------------------------------------------------------ #
    # rule 5 - the basin
    # ------------------------------------------------------------------ #
    def _basin_standing(self, lay: Layout, explain: bool) -> RuleResult:
        c, room, basin = self.c, self.room, lay.basin
        front = self.front_clear(lay, basin)
        sides = self.side_clear(lay, basin, room.out_from(basin.wall, lay.basin_zone)[1])
        side = min(gap for gap, _ in sides.values())
        score = (0.65 * grade(front, c.basin_front_min, c.basin_front_preferred)
                 + 0.35 * grade(side, c.basin_zone_width / 2.0, c.basin_side_preferred))
        if not explain:
            return self._result("R5", score)
        return self._result("R5", score, "{} of floor in front of the basin ({} needed) and {} of elbow room from "
                            "its centre line to the nearest side ({} needed).".format(
                                metres(front), metres(c.basin_front_min), metres(side),
                                metres(c.basin_zone_width / 2.0)))

    # ------------------------------------------------------------------ #
    # rules 6 and 7 - cabinets
    # ------------------------------------------------------------------ #
    def _cabinet_position(self, lay: Layout, explain: bool) -> RuleResult:
        vanity = BASINS[lay.basin.model].doors
        if lay.cabinet is None:
            wanted = any(u.type == "bathroom_cabinet" for u in lay.unplaced)
            mirror = self.mirror_place(lay)[0] == "above"
            if vanity:
                score, detail = 1.0, "Storage is the cupboard under the basin, which takes no floor of its own"
            elif mirror:
                score, detail = 1.0, "Storage is a mirror cabinet over the basin, off the floor"
            else:
                score, detail = 0.6, "There is no cabinet in this layout; toiletries need an open shelf"
            if wanted:
                score, detail = min(score, 0.7), detail + "; the separate storage cabinet was left out"
            return self._result("R6", score, detail + "." if explain else "")

        cabinet = lay.cabinet
        lines = self.lines(lay)
        crossed = [name for name, blocker in lines if blocker is cabinet]
        ahead = False
        for door, zone in zip(self.doors, self.door_zones):
            depth = self.room.depth_from(door.wall)
            ahead = ahead or intersects(self.room.band(door.wall, door.start, door.end, depth, door.inset), cabinet.rect)
        parts = [(0.4, 0.0 if ahead else 1.0)]
        if lines:
            parts.append((0.6, 1.0 - len(crossed) / float(len(lines))))
        if not explain:
            return self._result("R6", _mix(parts))
        detail = "The cabinet stands against the {} wall, outside the floor every fixture and the door need; ".format(
            cabinet.wall)
        detail += ("it is in the direct line from the door to {}".format(_join(crossed)) if crossed
                   else "it is clear of the direct lines from the door to the fixtures")
        detail += " and {} straight ahead of a doorway.".format("stands" if ahead else "not")
        return self._result("R6", _mix(parts), detail)

    def _cabinet_doors(self, lay: Layout, explain: bool, walk: Optional[Walk]) -> RuleResult:
        leaves = self.leaves(lay)
        if not leaves:
            return self._skip("R7", "Nothing here has a door that opens over the floor: the basin is wall-hung "
                              "and the shower is closed by a sliding screen.")
        if walk is None:
            swept = [any(intersects(leaf, zone) for zone in self.door_zones) for _, leaf in leaves]
            return self._result("R7", sum(0.75 if s else 1.0 for s in swept) / len(leaves))
        marks, notes = [], []
        for name, passable, swept in walk.leaves:
            marks.append((0.75 if passable else 0.0) + (0.0 if swept else 0.25))
            if not passable:
                notes.append("with {} open less than {} is left to reach the other fixtures".format(
                    name, metres(self.c.open_door_path)))
            elif swept:
                notes.append("{} open into the room door's swing".format(name))
        score = sum(marks) / len(marks) if marks else 1.0
        opened = _join([name for name, _, _ in walk.leaves]) or "the doors"
        detail = "Opened in turn: {}. ".format(opened) + (
            "; ".join(notes).capitalize() + "." if notes
            else "Each leaves {} to reach the other fixtures and stays clear of the room door.".format(
                metres(self.c.open_door_path)))
        return self._result("R7", score, detail)

    # ------------------------------------------------------------------ #
    # rules 8, 9 and 10 - towels, mirror, toiletries
    # ------------------------------------------------------------------ #
    def _reach_mark(self, reach: Optional[float]) -> float:
        if reach is None:
            return 0.0
        c = self.c
        return clamp01((c.towel_reach_far - reach) / (c.towel_reach_far - c.towel_reach_good))

    def _towel_reach(self, lay: Layout, explain: bool) -> RuleResult:
        fit = lay.fitout
        if fit is None:
            return self._result("R8", 1.0)
        ring = 0.7 if fit.towel_ring_reach is None else self._reach_mark(fit.towel_ring_reach)
        parts = [(0.4, ring)]
        notes = []
        if lay.shower is not None:
            parts.append((0.6, self._reach_mark(fit.towel_rail_reach)))
            notes.append("no free wall is left for a towel rail near the shower" if fit.towel_rail_reach is None
                         else "the towel rail is {} from where one steps out of the shower".format(
                             metres(fit.towel_rail_reach)))
        notes.append("the hand towel hangs on a bar on the basin itself" if fit.towel_ring_reach is None
                     else "the towel ring is {} from where one stands at the basin".format(
                         metres(fit.towel_ring_reach)))
        return self._result("R8", _mix(parts), "; ".join(notes).capitalize() + " (within {} is an easy reach).".format(
            metres(self.c.towel_reach_good)))

    def _mirror(self, lay: Layout, explain: bool) -> RuleResult:
        place, side = self.mirror_place(lay)
        score = {"above": 1.0, "beside": 0.6, "none": 0.0}[place]
        if not explain:
            return self._result("R9", score)
        bottom = self.a.mirror_bottom if self.accessible else self.c.mirror_bottom
        height = "its lower edge {} above the floor{}".format(
            metres(bottom), ", low enough to use seated" if self.accessible else ", its middle at standing eye height")
        if place == "above":
            detail = "The mirror hangs above the basin, {}.".format(height)
        elif place == "beside":
            detail = "A window is over the basin, so the mirror hangs on the {} wall beside it, {}.".format(
                WALL_ENDS[lay.basin.wall][0 if side == "lo" else 1], height)
        else:
            detail = "A window is over the basin and no side wall is near enough, so there is nowhere to hang a mirror."
        return self._result("R9", score, detail)

    def _toiletries(self, lay: Layout, explain: bool) -> RuleResult:
        c = self.c
        place = self.mirror_place(lay)[0]
        holder = self.roll_holder(lay)
        parts = [
            (1.0, {"above": 1.0, "beside": 0.6, "none": 0.2}[place]),
            (1.0, {"wall": 1.0, "fixture": 0.8, "stand": 0.5}[holder]),
        ]
        notes = [{
            "above": "soap and toothbrushes go in the mirror cabinet over the basin",
            "beside": "soap and toothbrushes go on a shelf under the mirror beside the basin",
            "none": "soap and toothbrushes have only the basin's edge",
        }[place], {
            "wall": "the paper holder is on the wall beside the pan",
            "fixture": "the paper holder is on the side of the fixture beside the pan",
            "stand": "nothing is within {} of the pan, so the paper holder is a floor stand".format(metres(c.reach)),
        }[holder]]
        if lay.shower is not None:
            parts.append((1.0, 1.0))
            notes.append("a shelf inside the shower holds soap and shampoo at 1.0 to 1.4 m")
        if lay.cabinet is not None:
            gap = distance(lay.basin_stand, lay.cabinet.rect)
            parts.append((1.0, clamp01((c.storage_far - gap) / (c.storage_far - c.storage_step))))
            notes.append("the storage cabinet is {} from the basin".format(metres(gap)))
        elif BASINS[lay.basin.model].doors:
            parts.append((1.0, 1.0))
            notes.append("spare toiletries are in the cupboard under the basin")
        return self._result("R10", _mix(parts), "; ".join(notes).capitalize() + "." if explain else "")

    # ------------------------------------------------------------------ #
    # rule 11 - splashing
    # ------------------------------------------------------------------ #
    def _splash(self, lay: Layout, explain: bool, walk: Optional[Walk]) -> RuleResult:
        if lay.shower is None:
            return self._skip("R11", "There is no shower in this layout; the basin stands against a wall, "
                              "clear of the way through the room.")
        shower = lay.shower
        parts: List[Tuple[float, float]] = []
        notes: List[str] = []
        if self.door_point is not None:
            own = point_gap(self.door_point, shower.rect)
            nearer = [n for n, stand, owner in self.stands(lay)
                      if owner is not shower and point_gap(self.door_point, stand) < own - 1.0]
            parts.append((0.35, (0.0, 0.5, 1.0)[min(len(nearer), 2)]))
            notes.append("the shower is {} from the door, {}".format(metres(own), (
                "nearer than the basin and the toilet", "with one other fixture nearer",
                "the furthest fixture from it")[min(len(nearer), 2)]))
            dry = True if walk is None or walk.dry_route is None else walk.dry_route
            parts.append((0.35, 1.0 if dry else 0.0))
            notes.append("the way to the basin and the toilet {} the {} of wet floor outside it".format(
                "stays off" if dry else "crosses", metres(self.c.splash_depth)))
        parts.append((0.20, {1: 0.4, 2: 0.8}.get(lay.shower_walls, 1.0 if lay.shower_walls >= 3 else 0.0)))
        notes.append("walls enclose it on {} side{}".format(lay.shower_walls, "" if lay.shower_walls == 1 else "s"))
        glazed = [w.id for w in self.windows
                  if span_overlap(*self.room.along(w.wall, shower.rect), w.start, w.end) > 50.0
                  and self.room.out_from(w.wall, shower.rect)[0] < 1.0]
        parts.append((0.10, 0.0 if glazed else 1.0))
        if glazed:
            notes.append("it stands against window {}".format(glazed[0]))
        return self._result("R11", _mix(parts), "; ".join(notes).capitalize() + "." if explain else "")

    # ------------------------------------------------------------------ #
    # rule 12 - open floor
    # ------------------------------------------------------------------ #
    def _clear_floor(self, lay: Layout, explain: bool, walk: Optional[Walk]) -> RuleResult:
        c, t, room = self.c, self.config.rooms, self.room
        ratio = sum(area(f.rect) for f in lay.fixtures) / (room.width * room.length)
        parts = [(0.35, clamp01((t.overcrowded_ratio - ratio) / (t.overcrowded_ratio - t.crowded_ratio)))]
        target = min(c.open_floor_side, 0.5 * min(room.width, room.length))
        low = min(c.open_floor_min, 0.7 * target)
        side = walk.open_side if walk is not None else target
        parts.append((0.35, clamp01((side - low) / ((target - low) or 1.0))))
        lines = self.lines(lay)
        blocked = [name for name, blocker in lines if blocker is not None]
        if lines:
            parts.append((0.30, 1.0 - len(blocked) / float(len(lines))))
        if not explain:
            return self._result("R12", _mix(parts))
        detail = "Every fixture stands against a wall and they cover {:.0f}% of the floor".format(100 * ratio)
        if walk is not None:
            detail += "; the largest clear square is {} across".format(metres(side))
        if lines:
            detail += ("; the straight line from the door to {} is blocked".format(_join(blocked)) if blocked
                       else "; the door has a straight line to every fixture")
        return self._result("R12", _mix(parts), detail + ".")

    # ------------------------------------------------------------------ #
    # rule 13 - wheelchair access
    # ------------------------------------------------------------------ #
    def _wheelchair(self, lay: Layout, explain: bool, walk: Optional[Walk]) -> RuleResult:
        a = self.a
        if not self.accessible:
            detail = "Not asked for."
            if explain and walk is not None:
                detail += " For reference, the largest clear square of floor is {} across; a wheelchair needs {} " \
                          "to turn.".format(metres(walk.turning), metres(a.turning_square))
            return self._skip("R13", detail)
        transfer = self.transfer_space(lay)
        parts = [(1.0, clamp01((transfer - a.transfer_width / 2.0) / (a.transfer_width / 2.0) + 1e-9))]
        notes = ["{} beside the pan to transfer from a chair ({} needed)".format(
            metres(transfer), metres(a.transfer_width))]
        if walk is not None:
            parts.append((1.5, clamp01((walk.turning - 1000.0) / ((a.turning_square - 1000.0) or 1.0))))
            notes.insert(0, "a clear square {} across to turn in ({} needed)".format(
                metres(walk.turning), metres(a.turning_square)))
            if self.main_door is not None:
                parts.append((1.0, 1.0 if walk.path_width >= a.path_width - 1.0 else
                              0.5 if walk.path_width >= 750.0 else 0.2))
                notes.append("a path {} wide ({} needed)".format(metres(walk.path_width), metres(a.path_width)))
        if self.main_door is not None:
            width = self.main_door.width
            parts.append((0.5, clamp01((width - (a.door_width - 150.0)) / 150.0)))
            notes.append("a {} doorway ({} needed)".format(metres(width), metres(a.door_width)))
        if lay.shower is not None and SHOWERS[lay.shower.model].level:
            notes.append("the shower floor is level with the room")
        return self._result("R13", _mix(parts), "; ".join(notes).capitalize() + "." if explain else "")

    # ------------------------------------------------------------------ #
    # rule 14 - floor finish and drainage
    # ------------------------------------------------------------------ #
    def drain_run(self, drain: Point) -> float:
        """The longest way water has to run across the floor to reach the drain."""
        return max(math.hypot(x - drain[0], y - drain[1]) for x, y in self.corners)

    def _drainage(self, lay: Layout, explain: bool) -> RuleResult:
        c = self.c
        drain, in_shower = self.drain_point(lay)
        run = self.drain_run(drain)
        parts = [
            (0.3, clamp01((c.drain_run_far - run) / (c.drain_run_far - c.drain_run_good))),
            (0.2, 1.0 if in_shower else 0.7),
        ]
        away = None
        if self.door_point is not None and self.door_far > 0:
            away = math.hypot(drain[0] - self.door_point[0], drain[1] - self.door_point[1])
            parts.append((0.5, clamp01(away / (0.6 * self.door_far))))
        if not explain:
            return self._result("R14", _mix(parts))
        detail = "Non-slip tiles throughout ({}), laid to a {} fall towards a drain {}".format(
            "wet-barefoot grade in the shower" if in_shower else "wet-barefoot grade",
            c.floor_fall, "in the wall corner of the shower" if in_shower else "in the corner furthest from the door")
        if away is not None:
            detail += ", {} from the door so water runs away from it".format(metres(away))
        detail += "; the longest run of water to the drain is {}.".format(metres(run))
        return self._result("R14", _mix(parts), detail)

    # ------------------------------------------------------------------ #
    # rule 15 - grab bars
    # ------------------------------------------------------------------ #
    def _grab_bars(self, lay: Layout, explain: bool) -> RuleResult:
        kind, side = self.toilet_bar(lay)
        wall = WALL_ENDS[lay.toilet.wall][0 if side == "lo" else 1] if side else ""
        if not self.accessible:
            detail = "Not asked for."
            if explain:
                detail += " If they are needed later, {}{}.".format(
                    "the {} wall beside the pan can take a fixed bar".format(wall) if kind == "wall"
                    else "the pan would need drop-down rails on its back wall",
                    " and the shower walls can take one" if lay.shower is not None else "")
            return self._skip("R15", detail)
        parts = [(1.0, 1.0 if kind == "wall" else 0.7)]
        notes = ["a fixed bar on the {} wall beside the pan, {} above the floor, with a drop-down rail on its open "
                 "side".format(wall, metres(self.a.bar_height)) if kind == "wall"
                 else "no side wall is within {} of the pan, so it has a drop-down rail on each side".format(
                     metres(self.a.wall_bar_reach))]
        if lay.shower is not None:
            parts.append((1.0, 1.0))
            notes.append("a bar inside the shower beside the way in")
        return self._result("R15", _mix(parts), "; ".join(notes).capitalize() + "." if explain else "")

    # ------------------------------------------------------------------ #
    # hard limits, re-checked on the finished layout
    # ------------------------------------------------------------------ #
    def violations(self, lay: Layout, report: Optional[CirculationReport], walk: Optional[Walk] = None) -> List[Dict]:
        """Every hard limit a finished layout breaks (empty for a valid one)."""
        room, c, a = self.room, self.c, self.a
        found: List[Dict] = []

        def add(rule_id: str, check: str, message: str, subject: str = "") -> None:
            found.append({
                "rule": RULE_BY_ID[rule_id].key, "rule_id": rule_id, "check": check,
                "message": message, "subject": subject,
            })

        fixtures = lay.fixtures
        for index, item in enumerate(fixtures):
            if not contains(room.rect, item.rect):
                add("R12", "boundary", "The {} extends outside the room.".format(label(item)), item.id)
            for other in fixtures[index + 1:]:
                if intersects(item.rect, other.rect):
                    add("R12", "overlap", "The {} overlaps the {}.".format(label(item), label(other)), item.id)
            for door, zone in zip(self.doors, self.door_zones):
                if intersects(item.rect, zone):
                    add("R12", "door",
                        "The {} stands where door {} needs to open.".format(label(item), door.id), item.id)

        owners = (("R2", "toilet_space", lay.toilet, lay.toilet_zone, "the toilet"),
                  ("R5", "basin_space", lay.basin, lay.basin_zone, "the basin"),
                  ("R3", "shower_exit", lay.shower, lay.shower_exit, "the way out of the shower"))
        for rule_id, check, owner, zone, name in owners:
            if owner is None or zone is None:
                continue
            if not contains(room.rect, zone):
                add(rule_id, check, "A wall is closer to {} than the rule allows.".format(name), owner.id)
            for other in fixtures:
                if other is not owner and intersects(other.rect, zone):
                    add(rule_id, check, "The {} stands in the floor needed at {}.".format(label(other), name), owner.id)

        if self.front_clear(lay, lay.toilet) < c.toilet_front_min - 1.0:
            add("R2", "toilet_space", "Less than {:.0f} mm is clear in front of the toilet.".format(
                c.toilet_front_min), lay.toilet.id)
        if self.front_clear(lay, lay.basin) < c.basin_front_min - 1.0:
            add("R5", "basin_space", "Less than {:.0f} mm is clear in front of the basin.".format(
                c.basin_front_min), lay.basin.id)
        if lay.shower is not None and self.exit_depth(lay) < c.shower_exit_min - 1.0:
            add("R3", "shower_exit", "Less than {:.0f} mm of floor is clear outside the shower.".format(
                c.shower_exit_min), lay.shower.id)
        if lay.shower is None and self.programme.shower_required:
            add("R3", "missing", "No position was found for the shower.")

        if lay.cabinet is not None:
            cabinet = lay.cabinet
            for window, band in self.window_bands:
                if intersects(cabinet.rect, band) and cabinet.height > window.sill_height:
                    add("R6", "window", "The cabinet stands in front of window {}.".format(window.id), cabinet.id)
            if lay.cabinet_leaf is not None and any(
                    f is not cabinet and intersects(f.rect, lay.cabinet_leaf) for f in fixtures):
                add("R7", "leaf", "The cabinet door cannot open fully.", cabinet.id)

        if report is not None and report.checked and not report.valid:
            add("R4", "path", "No path at least {:.0f} mm wide links the entrance to {}.".format(
                c.path_min, _join(report.unreachable) if report.unreachable else "the rest of the room"))

        if self.accessible:
            if walk is not None and walk.turning < a.turning_square - 1.0:
                add("R13", "turning", "The largest clear square of floor is {:.0f} mm across; a wheelchair needs "
                    "{:.0f} mm to turn.".format(walk.turning, a.turning_square))
            if self.transfer_space(lay) < a.transfer_width - 1.0:
                add("R13", "transfer", "Less than {:.0f} mm is clear beside the pan to transfer from a "
                    "wheelchair.".format(a.transfer_width), lay.toilet.id)
            if (report is not None and report.checked and report.valid and walk is not None
                    and walk.path_width < a.path_width - 1.0):
                add("R13", "path", "The path through the room is {:.0f} mm wide; a wheelchair needs {:.0f} mm.".format(
                    walk.path_width, a.path_width))
        return found
