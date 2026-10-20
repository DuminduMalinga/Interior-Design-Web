"""
The twelve bedroom furniture-arrangement rules.

Each rule is applied in up to three ways, and `RULES` records which:

* **built in** - the generator only ever proposes positions that obey it
  (a bedside table is created touching the bed, never searched for);
* **hard**     - a position that breaks it is discarded, and `violations()`
  re-checks every such limit on the finished layout;
* **scored**   - a 0..1 mark for how well the layout does, weighted into the
  0-100 rules score and reported with the measured numbers behind it.

The rules score is then converted to 90 points, and the extra `FURNITURE_RULE`
adds the last 10, rewarding the layout with the most furniture.

`Evaluator.static()` scores the ten rules that depend only on where things
stand; rules 8 and 9 need the walkability map and are added once a layout is
complete (see `circulation.py`).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from .circulation import CirculationReport
from .config import Config
from .furniture import BED_SLEEPS, BEDS, MATTRESS_HEIGHT, WARDROBES, Item, Layout
from .geometry import area, clamp01, contains, distance, intersects, overlap_area, segment_hits, span_overlap
from .programme import Programme
from .room import FACING_VECTOR, WALL_ENDS, Door, Room, Window

#: where a sleeper's head lies, measured out from the headboard wall
PILLOW_INSET = 350.0


@dataclass(frozen=True)
class Rule:
    id: str
    key: str       # also the name of its weight in config.Weights
    title: str
    text: str      # the rule as written
    method: str    # how the engine applies it


RULES: Tuple[Rule, ...] = (
    Rule("R1", "entrance_view", "Bed sees the entrance",
         "Position the bed so the occupant can see the bedroom entrance where practical.",
         "Scored: the angle between the sleeper's line of sight and the doorway, and whether tall "
         "furniture stands in between."),
    Rule("R2", "door_distance", "Distance from the doorway",
         "Consider the distance between the bed and the doorway.",
         "Scored: the gap between the bed and the door opening, with full marks from 1.5 m."),
    Rule("R3", "door_swing", "Door opening direction",
         "Consider the door-opening direction when positioning the bed.",
         "Hard: nothing stands in the area the door leaf sweeps or on the landing in front of it. "
         "Scored: open floor straight ahead of the doorway."),
    Rule("R4", "bed_windows", "Bed and windows",
         "Consider window positions when selecting the bed location.",
         "Hard: no bed in front of full-height glazing. Scored: how much of the headboard sits under a "
         "window and how much window access the bed takes away."),
    Rule("R5", "bed_access", "Space beside the bed",
         "Leave sufficient space beside the bed for comfortable access.",
         "Hard: 0.60 m beside the bed on every side an occupant uses. Scored: up to 0.75 m beside it "
         "and 0.90 m at the foot."),
    Rule("R6", "bedside_tables", "Bedside tables in reach",
         "Place bedside tables within convenient reach of the bed.",
         "Built in: a table always touches the bed at the pillow end. Scored: tables placed out of "
         "tables wanted."),
    Rule("R7", "storage_clearance", "Clearance at wardrobes and drawers",
         "Leave sufficient clearance in front of wardrobes and drawers.",
         "Hard: 0.75 m in front of a wardrobe and 0.70 m in front of drawers. Scored: up to 0.90 m."),
    Rule("R8", "walking_path", "Clear walking path",
         "Keep the walking path between the bedroom entrance, bed, and wardrobe clear.",
         "Hard: one continuous path at least 0.60 m wide links the entrance, the bed, the storage and the "
         "desk. Scored: whether it is 0.75 or 0.90 m wide, and how much floor is cut off."),
    Rule("R9", "desk_and_chair", "Desk and chair off the path",
         "Position study desks and chairs so they do not block essential walking paths.",
         "Hard: the desk and its chair stay out of every keep-clear zone. Scored: the path still works "
         "with the chair pulled out."),
    Rule("R10", "tall_furniture", "Tall furniture clear of windows",
         "Avoid placing tall furniture where it blocks windows or ventilation openings.",
         "Hard: nothing 1.1 m or taller, and nothing taller than the sill, stands in front of a window. "
         "Scored: a 0.30 m margin from the window edge."),
    Rule("R11", "room_fit", "Fit to room and occupants",
         "Arrange furniture according to room dimensions and the number of occupants.",
         "Decides the furniture list (bed size, wardrobe size, drawers, desk). Scored: bed fit, pieces "
         "placed, open floor left, floor covered and leftover gaps."),
    Rule("R12", "reach_and_height", "Convenient heights and reach",
         "Keep frequently used items at convenient heights and within comfortable reach.",
         "Scored: bedside surface level with the mattress and within arm's reach, and a short walk from "
         "the bed to the wardrobe."),
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


def metres(mm: float) -> str:
    return "{:.2f} m".format(mm / 1000.0)


def label(item: Item) -> str:
    return "drawers" if item.type == "dresser" else item.type.replace("_", " ")


def _view_factor(angle: float) -> float:
    """Rule 1: 1 while the door is in view without turning, fading to 0 once it is behind the pillow."""
    if angle <= 60.0:
        return 1.0
    if angle <= 90.0:
        return 1.0 - 0.4 * (angle - 60.0) / 30.0
    if angle <= 120.0:
        return 0.6 * (1.0 - (angle - 90.0) / 30.0)
    return 0.0


class Evaluator:
    """Scores a layout against the twelve rules and re-checks every hard limit."""

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

    # ------------------------------------------------------------------ #
    def _result(self, rule_id: str, score: float, detail: str = "") -> RuleResult:
        return RuleResult(RULE_BY_ID[rule_id], clamp01(score), self.weights[rule_id], detail)

    def _skip(self, rule_id: str, detail: str) -> RuleResult:
        return RuleResult(RULE_BY_ID[rule_id], 0.0, self.weights[rule_id], detail, applicable=False)

    def static(self, lay: Layout, explain: bool = False, open_side: Optional[float] = None) -> Dict[str, RuleResult]:
        """Every rule that depends only on where the furniture stands.

        `open_side` is the largest clear square of floor, measured on the raster
        once a layout is finished; while the search is still comparing
        candidates it is left out and rule 11 assumes the best.
        """
        return {
            "R1": self._entrance_view(lay, explain),
            "R2": self._door_distance(lay, explain),
            "R3": self._door_swing(lay, explain),
            "R4": self._bed_windows(lay, explain),
            "R5": self._bed_access(lay, explain),
            "R6": self._bedside_tables(lay, explain),
            "R7": self._storage_clearance(lay, explain),
            "R10": self._tall_furniture(lay, explain),
            "R11": self._room_fit(lay, explain, open_side),
            "R12": self._reach_and_height(lay, explain),
        }

    @staticmethod
    def total(results: Dict[str, RuleResult]) -> float:
        """0-100: points earned out of the points the applicable rules could give."""
        weight = sum(r.weight for r in results.values() if r.applicable)
        return 100.0 * sum(r.points for r in results.values()) / weight if weight else 0.0

    # ------------------------------------------------------------------ #
    # measurements shared by the rules and the hard-limit re-check
    # ------------------------------------------------------------------ #
    def bed_clearances(self, lay: Layout) -> Dict[str, float]:
        """Clear floor on the low side, the high side and at the foot of the bed."""
        room, bed = self.room, lay.bed
        wall = bed.wall
        lo, hi = room.along(wall, bed.rect)
        wall_length, depth = room.wall_length(wall), room.depth_from(wall)
        table_depth = {"lo": 0.0, "hi": 0.0}
        for table in lay.tables:
            table_depth["lo" if room.along(wall, table.rect)[1] <= lo + 1.0 else "hi"] = table.depth
        others = [i for i in lay.items if i is not bed and i.type != "bedside_table"]

        out: Dict[str, float] = {}
        for side in ("lo", "hi"):
            clear = lo if side == "lo" else wall_length - hi
            if clear > 1.0:
                start, end = (0.0, lo) if side == "lo" else (hi, wall_length)
                beside = room.band(wall, start, end, bed.depth - table_depth[side], offset=table_depth[side])
                for other in others:
                    if intersects(beside, other.rect):
                        o_lo, o_hi = room.along(wall, other.rect)
                        clear = min(clear, lo - o_hi if side == "lo" else o_lo - hi)
            out[side] = max(clear, 0.0)

        foot = depth - bed.depth
        beyond = room.band(wall, lo, hi, depth - bed.depth, offset=bed.depth)
        for other in others:
            if intersects(beyond, other.rect):
                foot = min(foot, room.out_from(wall, other.rect)[0] - bed.depth)
        out["foot"] = max(foot, 0.0)
        return out

    def front_clearance(self, lay: Layout, item: Item, limit: float = 1500.0) -> float:
        """Clear floor straight in front of a piece, measured up to `limit`."""
        room, wall = self.room, item.wall
        lo, hi = room.along(wall, item.rect)
        far = room.out_from(wall, item.rect)[1]
        clear = min(limit, room.depth_from(wall) - far)
        front = room.band(wall, lo, hi, clear, offset=far)
        for other in lay.items:
            if other is not item and intersects(front, other.rect):
                clear = min(clear, room.out_from(wall, other.rect)[0] - far)
        return max(clear, 0.0)

    def dead_gaps(self, lay: Layout) -> int:
        """Leftover stretches of wall beside a piece that are too narrow to use."""
        room, count = self.room, 0
        for item in (lay.wardrobe, lay.dresser, lay.desk):
            if item is None:
                continue
            wall = item.wall
            lo, hi = room.along(wall, item.rect)
            left, right = 0.0, room.wall_length(wall)
            for other in lay.items:
                if other is item or other.type == "desk_chair":
                    continue
                if room.out_from(wall, other.rect)[0] < item.depth - 1.0:   # shares this strip of wall
                    o_lo, o_hi = room.along(wall, other.rect)
                    if o_hi <= lo + 1.0:
                        left = max(left, o_hi)
                    elif o_lo >= hi - 1.0:
                        right = min(right, o_lo)
            count += sum(1 for gap in (lo - left, right - hi) if 1.0 < gap < self.c.dead_gap_max)
        return count

    # ------------------------------------------------------------------ #
    # rule 1 - the occupant can see the entrance
    # ------------------------------------------------------------------ #
    def _entrance_view(self, lay: Layout, explain: bool) -> RuleResult:
        door = self.main_door
        if door is None:
            return self._skip("R1", "No door was detected, so the view of the entrance could not be assessed.")
        room, bed = self.room, lay.bed
        fx, fy = FACING_VECTOR[bed.facing]
        target = door.center(room)
        tall = [i for i in lay.items if i.height >= self.c.tall_furniture_height]
        lo, hi = room.along(bed.wall, bed.rect)
        two = self.programme.occupants >= 2 and BED_SLEEPS[lay.bed_size] >= 2
        shares = (0.25, 0.75) if two else (0.5,)

        total, angle_sum, blocker = 0.0, 0.0, None
        for share in shares:
            pillow = room.point(bed.wall, lo + (hi - lo) * share, PILLOW_INSET)
            vx, vy = target[0] - pillow[0], target[1] - pillow[1]
            reach = math.hypot(vx, vy) or 1.0
            angle = math.degrees(math.acos(max(-1.0, min(1.0, (fx * vx + fy * vy) / reach))))
            seen = _view_factor(angle)
            hit = next((i for i in tall if segment_hits(pillow, target, i.rect)), None)
            if hit is not None:
                seen *= 0.25
                blocker = hit
            total += seen
            angle_sum += angle
        score = total / len(shares)
        if not explain:
            return self._result("R1", score)

        angle = angle_sum / len(shares)
        head = room.point(bed.wall, (lo + hi) / 2.0, PILLOW_INSET)
        away = metres(math.hypot(target[0] - head[0], target[1] - head[1]))
        if angle <= 60.0:
            text = "From the pillow the entrance is in plain view: {:.0f} degrees off the bed's line of sight, {} away."
        elif angle <= 90.0:
            text = "The entrance can be seen from the pillow by turning the head ({:.0f} degrees to the side, {} away)."
        elif angle <= 120.0:
            text = ("The entrance is beside or just behind the pillow ({:.0f} degrees round, {} away), "
                    "so it is hard to see from the bed.")
        else:
            text = "The entrance is behind the sleeper ({:.0f} degrees round, {} away) and cannot be seen from the bed."
        text = text.format(angle, away)
        if blocker is not None:
            text += " The {} stands in the line of sight.".format(label(blocker))
        return self._result("R1", score, text)

    # ------------------------------------------------------------------ #
    # rule 2 - distance between the bed and the doorway
    # ------------------------------------------------------------------ #
    def _door_distance(self, lay: Layout, explain: bool) -> RuleResult:
        door = self.main_door
        if door is None:
            return self._skip("R2", "No door was detected, so the distance to the doorway could not be measured.")
        gap = distance(lay.bed.rect, door.opening(self.room))
        score = clamp01((gap - self.c.bed_door_near) / (self.c.bed_door_far - self.c.bed_door_near))
        if not explain:
            return self._result("R2", score)
        if score >= 1.0:
            tail = ", comfortably clear of it."
        elif score >= 0.4:
            tail = ", close enough to notice the door but not crowding it."
        else:
            tail = ", which is close to the door."
        return self._result("R2", score, "The bed is {} from the doorway{}".format(metres(gap), tail))

    # ------------------------------------------------------------------ #
    # rule 3 - which way the door opens
    # ------------------------------------------------------------------ #
    def _door_swing(self, lay: Layout, explain: bool) -> RuleResult:
        door = self.main_door
        if door is None:
            return self._skip("R3", "No door was detected, so there was no door swing to keep clear.")
        room = self.room
        depth = room.depth_from(door.wall)
        line = room.band(door.wall, door.start, door.end, depth, door.inset)
        ahead, first = depth, None
        for item in lay.items:
            if intersects(line, item.rect):
                near = room.out_from(door.wall, item.rect)[0]
                if near < ahead:
                    ahead, first = near, item
        required = door.keep_clear_depth(self.c.door_entry_depth)
        good = max(self.c.door_ahead_good, required + 300.0)
        score = 0.5 + 0.5 * clamp01((ahead - required) / (good - required))
        if not explain:
            return self._result("R3", score)

        if door.swing == "inward":
            text = "The door {} inward; the {} x {} area its leaf sweeps is kept clear{}.".format(
                "opens" if door.swing_known else "is taken to open",
                metres(door.width), metres(required),
                "" if door.hinge_known else ", whichever side it is hinged on")
        else:
            text = "The door {}; the {} landing in front of it is kept clear.".format(
                "slides" if door.swing == "sliding" else "opens outward", metres(required))
        if first is None:
            text += " Nothing stands in line with the doorway."
        else:
            text += " Straight ahead the first thing is the {}, {} in.".format(label(first), metres(ahead))
        return self._result("R3", score, text)

    # ------------------------------------------------------------------ #
    # rule 4 - the bed and the windows
    # ------------------------------------------------------------------ #
    def _bed_windows(self, lay: Layout, explain: bool) -> RuleResult:
        if not self.windows:
            return self._skip("R4", "No window was detected, so there was nothing to check the bed against.")
        room, bed = self.room, lay.bed
        lo, hi = room.along(bed.wall, bed.rect)
        under, under_ids = 0.0, []
        blocked, blocked_id = 0.0, None
        for window, band in self.window_bands:
            if window.wall == bed.wall:
                cover = span_overlap(lo, hi, window.start, window.end)
                if cover > 1.0:
                    under += cover
                    under_ids.append(window.id)
            else:
                share = overlap_area(bed.rect, band) / (area(band) or 1.0)
                if share > blocked:
                    blocked, blocked_id = share, window.id
        head = min(1.0, under / (hi - lo))
        score = max(0.0, 1.0 - 0.7 * head - 0.5 * blocked)
        if not explain:
            return self._result("R4", score)

        parts = []
        if head > 0.0:
            parts.append(
                "{:.0f}% of the headboard sits under window {}, where draughts and morning light fall on "
                "the pillow".format(head * 100.0, ", ".join(under_ids)))
        else:
            parts.append("The headboard has solid wall behind it")
        if blocked > 0.0:
            parts.append("the bed takes up {:.0f}% of the floor in front of window {}".format(
                blocked * 100.0, blocked_id))
        elif head == 0.0:
            parts.append("the bed leaves every window free to reach and open")
        return self._result("R4", score, "; ".join(parts) + ".")

    # ------------------------------------------------------------------ #
    # rule 5 - space beside the bed
    # ------------------------------------------------------------------ #
    def _bed_access(self, lay: Layout, explain: bool) -> RuleResult:
        c = self.c
        clear = self.bed_clearances(lay)
        need = 2 if self.programme.occupants >= 2 else 1
        used = [clear[side] for side in lay.access_sides]
        if len(used) < need or min(used) < c.bed_side_min - 1.0:
            side_score = 0.2
        else:
            side_score = 0.6 + 0.4 * clamp01(
                (min(used) - c.bed_side_min) / (c.bed_side_preferred - c.bed_side_min))
        foot = clear["foot"]
        if foot >= c.bed_foot_min - 1.0:
            foot_score = 0.7 + 0.3 * clamp01((foot - c.bed_foot_min) / (c.bed_foot_preferred - c.bed_foot_min))
        else:
            foot_score = 0.4
        score = 0.75 * side_score + 0.25 * foot_score
        if not explain:
            return self._result("R5", score)

        ends = WALL_ENDS[lay.bed.wall]
        sides = []
        for index, side in enumerate(("lo", "hi")):
            if clear[side] <= 1.0:
                sides.append("the {} side is against the wall".format(ends[index]))
            else:
                sides.append("{} on the {} side".format(metres(clear[side]), ends[index]))
        text = ("Clear floor beside the bed: {} and {} (at least {} is needed where someone gets in); "
                "{} at the foot.").format(sides[0], sides[1], metres(c.bed_side_min), metres(foot))
        if len(used) < need:
            text += " Two people share this bed but only one side can be reached."
        return self._result("R5", score, text)

    # ------------------------------------------------------------------ #
    # rule 6 - bedside tables within reach
    # ------------------------------------------------------------------ #
    def _bedside_tables(self, lay: Layout, explain: bool) -> RuleResult:
        wanted = self.programme.bedside_tables
        if wanted == 0:
            return self._skip("R6", "No bedside table was asked for.")
        placed = len(lay.tables)
        score = min(1.0, placed / wanted)
        if not explain:
            return self._result("R6", score)
        if placed == 0:
            return self._result("R6", score, "No bedside table fits beside the bed in this position.")
        reach = lay.tables[0].width / 2.0
        text = ("{} bedside table{} against the bed at the pillow end, {} from the mattress edge - "
                "within arm's reach.").format(placed, " stands" if placed == 1 else "s stand", metres(reach))
        if placed < wanted:
            text += " A second one does not fit on the other side."
        return self._result("R6", score, text)

    # ------------------------------------------------------------------ #
    # rule 7 - clearance in front of wardrobes and drawers
    # ------------------------------------------------------------------ #
    def _storage_clearance(self, lay: Layout, explain: bool) -> RuleResult:
        c = self.c
        measured = []
        for item, minimum, preferred in (
            (lay.wardrobe, c.wardrobe_front_min, c.wardrobe_front_preferred),
            (lay.dresser, c.drawer_front_min, c.drawer_front_preferred),
        ):
            if item is not None:
                measured.append((item, self.front_clearance(lay, item), minimum, preferred))
        missing = bool(self.programme.wardrobe_sizes) and lay.wardrobe is None
        if not measured and not missing:
            return self._skip("R7", "This layout has no wardrobe or drawers.")
        scores = [
            0.6 + 0.4 * clamp01((clear - minimum) / (preferred - minimum)) if clear >= minimum - 1.0 else 0.0
            for _, clear, minimum, preferred in measured
        ]
        if missing:
            scores.append(0.0)
        score = sum(scores) / len(scores)
        if not explain:
            return self._result("R7", score)
        parts = [
            "{} of clear floor in front of the {} (minimum {})".format(metres(clear), label(item), metres(minimum))
            for item, clear, minimum, _ in measured
        ]
        if missing:
            parts.append("no wardrobe could be placed")
        text = "; ".join(parts) + "."
        return self._result("R7", score, text[0].upper() + text[1:])

    # ------------------------------------------------------------------ #
    # rule 8 and 9 - walking path, and the desk chair (from the walkability map)
    # ------------------------------------------------------------------ #
    def path_result(self, lay: Layout, report: CirculationReport) -> RuleResult:
        if not report.checked:
            return self._skip("R8", "No door was detected, so there was no entrance to walk from.")
        widths = self.c.path_widths
        if not report.valid:
            return self._result("R8", 0.0, "No path at least {} wide reaches {}.".format(
                metres(min(widths)), ", ".join(report.unreachable) or "the room"))
        span = max(widths) - min(widths)
        wide = 0.6 + 0.4 * (report.width - min(widths)) / span if span else 1.0
        # floor nobody can get to counts against the path: 5% is tolerated, half the room loses everything
        lost = max(0.0, self.c.cut_off_tolerance - report.reached_ratio)
        score = wide * clamp01(1.0 - 2.0 * lost)
        places = ["the entrance", "the bed"]
        for item in (lay.wardrobe, lay.dresser, lay.desk):
            if item is not None:
                places.append("the {}".format(label(item)))
        text = ("A path {} wide links {} and {}; {:.0f}% of the open floor can be walked to "
                "from the door.").format(metres(report.width), ", ".join(places[:-1]), places[-1], report.reached_ratio * 100.0)
        if lost > 0.0:
            text += " The rest is cut off by the furniture{}.".format(
                ", along with {}".format(", ".join(report.cut_off)) if report.cut_off else "")
        if report.pinch is not None:
            text += " A {} path would not reach {}.".format(metres(report.pinch[0]), ", ".join(report.pinch[1]))
        return self._result("R8", score, text)

    def chair_result(self, lay: Layout, report: CirculationReport) -> RuleResult:
        if lay.desk is None:
            return self._skip(
                "R9",
                "The study desk could not be placed, so there was nothing to check." if self.programme.desk
                else "This layout has no study desk.")
        if not report.checked:
            return self._result("R9", 1.0, "The desk and its chair stay out of every keep-clear zone.")
        if report.chair_clear:
            return self._result(
                "R9", 1.0,
                "The desk and chair are off the walking path: even with the chair pulled out, the route between "
                "the entrance, the bed and the storage stays at least {} wide.".format(metres(self.c.path_min)))
        return self._result(
            "R9", 0.5,
            "The desk and chair stay out of every keep-clear zone, but a pulled-out chair narrows the route below "
            "{} - it has to be tucked in for someone to pass.".format(metres(self.c.path_min)))

    # ------------------------------------------------------------------ #
    # rule 10 - tall furniture and the windows / ventilation openings
    # ------------------------------------------------------------------ #
    def _tall_furniture(self, lay: Layout, explain: bool) -> RuleResult:
        if not self.windows:
            return self._skip("R10", "No window or ventilation opening was detected, so there was nothing to block.")
        tall = [i for i in lay.items if i.height >= self.c.tall_furniture_height]
        if not tall:
            return self._result("R10", 1.0, "Nothing in this layout is tall enough to block a window.")
        margin, nearest = float("inf"), None
        for item in tall:
            for window, band in self.window_bands:
                gap = distance(item.rect, band)
                if gap < margin:
                    margin, nearest = gap, (item, window)
        preferred = self.c.window_margin_preferred
        score = 1.0 if margin >= preferred else 0.7 + 0.3 * margin / preferred
        if not explain:
            return self._result("R10", score)
        item, window = nearest
        if margin >= preferred:
            text = ("The {} ({} tall) stands {} clear of the nearest window, so no light or ventilation "
                    "is blocked.").format(label(item), metres(item.height), metres(margin))
        else:
            text = "The {} ({} tall) is clear of window {} but only {} from it, which crowds the curtains.".format(
                label(item), metres(item.height), window.id, metres(margin))
        return self._result("R10", score, text)

    # ------------------------------------------------------------------ #
    # rule 11 - fit to the room and the number of occupants
    # ------------------------------------------------------------------ #
    def _room_fit(self, lay: Layout, explain: bool, open_side: Optional[float] = None) -> RuleResult:
        programme, thresholds, room = self.programme, self.config.rooms, self.room
        sizes = programme.bed_sizes
        rank = sizes.index(lay.bed_size) if lay.bed_size in sizes else len(sizes)
        bed_fit = 0.2 if BED_SLEEPS[lay.bed_size] < programme.occupants else max(0.4, 1.0 - 0.2 * rank)
        covered = sum(area(i.rect) for i in lay.items) / (room.width * room.length)
        density = 1.0 - clamp01(
            (covered - thresholds.crowded_ratio) / (thresholds.overcrowded_ratio - thresholds.crowded_ratio))
        planned = programme.pieces()
        placed = 1 + len(lay.tables) + sum(x is not None for x in (lay.wardrobe, lay.dresser, lay.desk))
        complete = max(0.0, 1.0 - 0.5 * (planned - placed))     # every planned piece left out costs half
        gaps = self.dead_gaps(lay)
        # open floor: the furniture should leave one usable clear area, sized to the room
        wanted = min(thresholds.open_floor_side, thresholds.open_floor_share * min(room.width, room.length))
        open_floor = 1.0 if open_side is None else clamp01(open_side / wanted)
        score = (0.30 * bed_fit + 0.30 * complete + 0.20 * open_floor + 0.10 * density
                 + 0.10 * max(0.0, 1.0 - 0.5 * gaps))
        if not explain:
            return self._result("R11", score)

        text = "A {} for {} in a {:.1f} m2 room ({} x {})".format(
            BEDS[lay.bed_size].label, "two occupants" if programme.occupants >= 2 else "one occupant",
            room.area_m2, metres(room.width), metres(room.length))
        if rank > 0:
            text += " - a {} was the first choice but does not fit with every clearance".format(BEDS[sizes[0]].label)
        if lay.wardrobe is not None and lay.wardrobe.model != programme.wardrobe_sizes[0]:
            text += "; the wardrobe is a {} instead of a {}".format(
                WARDROBES[lay.wardrobe.model].label, WARDROBES[programme.wardrobe_sizes[0]].label)
        text += ". Furniture covers {:.0f}% of the floor and {} of the {} planned pieces are placed.".format(
            covered * 100.0, placed, planned)
        if open_side is not None:
            text += " The largest clear square of floor is {} across.".format(metres(open_side))
        if gaps:
            text += " {} leftover gap{} too narrow to use.".format(gaps, " is" if gaps == 1 else "s are")
        return self._result("R11", score, text)

    # ------------------------------------------------------------------ #
    # rule 12 - convenient heights and comfortable reach
    # ------------------------------------------------------------------ #
    def _reach_and_height(self, lay: Layout, explain: bool) -> RuleResult:
        c = self.c
        marks, parts = [], []
        if self.programme.bedside_tables:
            if lay.tables:
                table = lay.tables[0]
                reach = table.width / 2.0
                marks.append(1.0 - clamp01(abs(table.height - MATTRESS_HEIGHT) / 300.0))
                marks.append(1.0 - clamp01((reach - c.bedside_reach) / c.bedside_reach))
                parts.append(
                    "the bedside surface is {} high, level with the {} mattress, and {} from "
                    "the bed edge".format(metres(table.height), metres(MATTRESS_HEIGHT), metres(reach)))
            else:
                marks.append(0.0)
                parts.append("nothing is within reach of the pillow")
        storage = lay.wardrobe or lay.dresser
        if storage is not None:
            walk = distance(lay.bed.rect, storage.rect)
            marks.append(1.0 - 0.5 * clamp01(
                (walk - c.storage_reach_good) / (c.storage_reach_far - c.storage_reach_good)))
            parts.append("the {} is {} from the bed".format(label(storage), metres(walk)))
        if lay.desk is not None:
            parts.append("the desk top is at {}".format(metres(lay.desk.height)))
        if not marks:
            return self._skip("R12", "This layout has no bedside table or storage to judge.")
        score = sum(marks) / len(marks)
        if not explain:
            return self._result("R12", score)
        text = "; ".join(parts) + "."
        return self._result("R12", score, text[0].upper() + text[1:])

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

        items = lay.items
        for index, item in enumerate(items):
            if not contains(room.rect, item.rect):
                add("R11", "boundary", "The {} extends outside the room.".format(label(item)), item.id)
            for other in items[index + 1:]:
                if intersects(item.rect, other.rect):
                    add("R11", "overlap", "The {} overlaps the {}.".format(label(item), label(other)), item.id)
            for door, zone in zip(self.doors, self.door_zones):
                if intersects(item.rect, zone):
                    add("R3", "door",
                        "The {} stands where door {} needs to open.".format(label(item), door.id), item.id)
            for window, band in self.window_bands:
                if intersects(item.rect, band) and (
                    item.height >= c.tall_furniture_height or item.height > window.sill_height
                    or (item.type == "bed" and window.sill_height <= c.floor_window_sill)
                ):
                    add("R10", "window", "The {} blocks window {}.".format(label(item), window.id), item.id)

        clear = self.bed_clearances(lay)
        need = 2 if self.programme.occupants >= 2 else 1
        usable = [side for side in ("lo", "hi") if clear[side] >= c.bed_side_min - 1.0]
        if len(usable) < need:
            add("R5", "bed_access",
                "The bed has {} of clear floor on {} side{} but {} needed.".format(
                    metres(c.bed_side_min), len(usable) or "no", "" if len(usable) == 1 else "s",
                    "both are" if need == 2 else "one is"),
                lay.bed.id)

        for item, minimum in ((lay.wardrobe, c.wardrobe_front_min), (lay.dresser, c.drawer_front_min)):
            if item is not None and self.front_clearance(lay, item) < minimum - 1.0:
                add("R7", "storage",
                    "Less than {} is clear in front of the {}.".format(metres(minimum), label(item)), item.id)

        if self.programme.wardrobe_sizes and self.programme.wardrobe_required and lay.wardrobe is None:
            add("R11", "missing", "No position was found for the wardrobe.")

        if lay.chair is not None:
            for name, zone in lay.keep_clear:
                if intersects(lay.chair.rect, zone):
                    add("R9", "chair",
                        "The desk chair stands in the clear floor needed at {}.".format(name), lay.chair.id)

        if report is not None and report.checked and not report.valid:
            add("R8", "path", "No path at least {} wide links the entrance to {}.".format(
                metres(c.path_min), ", ".join(report.unreachable) or "the rest of the room"))
        return found
