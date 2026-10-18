"""
The fifteen master-bedroom furniture-arrangement rules.

Each rule is applied in up to three ways, and `RULES` records which:

* **built in** - the generator only ever proposes positions that obey it
  (a bedside table is created touching the bed, never searched for);
* **hard**     - a position that breaks it is discarded, and `violations()`
  re-checks every such limit on the finished layout;
* **scored**   - a 0..1 mark for how well the layout does, weighted into the
  0-100 total and reported with the measured numbers behind it.

Several rules look at more than one thing (rule 1 at the room, the doors and
the windows), so each is built from `Part`s - one measured aspect with its own
mark and sentence - combined by weight.

`Evaluator.static()` scores all fifteen. Rules 3, 9, 12 and 15 need the
walkability report; while the search is still comparing candidates it is left
out and those parts are assumed perfect (see `circulation.py`).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from .circulation import CirculationReport
from .config import Config
from .furniture import BED_SLEEPS, BEDS, MATTRESS_HEIGHT, WARDROBES, Item, Layout
from .geometry import (
    Point,
    area,
    center,
    clamp01,
    contains,
    distance,
    intersects,
    overlap_area,
    segment_hits,
    span_overlap,
)
from .programme import Programme
from .room import FACING_VECTOR, OPPOSITE, WALL_ENDS, Door, Room, Window

#: where a sleeper's head lies, measured out from the headboard wall
PILLOW_INSET = 350.0
#: how far a wardrobe door swings out
WARDROBE_LEAF = 500.0
#: a second door that leads here is the en-suite (rule 15)
BATHROOM = re.compile(r"bath|toilet|wc|wash|shower|ensuite|en-suite", re.I)


@dataclass(frozen=True)
class Rule:
    id: str
    key: str       # also the name of its weight in config.Weights
    title: str
    text: str      # the rule as written
    method: str    # how the engine applies it


RULES: Tuple[Rule, ...] = (
    Rule("R1", "bed_position", "Bed placed for the room, doors and windows",
         "Position the bed according to room dimensions, door locations, and window positions.",
         "Hard: the bed never stands in a door's swing or in front of full-height glazing. Scored: the bed "
         "size the room takes, distance from the doorway, the view of the entrance from the pillow, open "
         "floor ahead of the door, and solid wall behind the headboard."),
    Rule("R2", "bed_sides", "Space on both sides of the bed",
         "Provide sufficient space on both sides of the bed where practical.",
         "Hard: 600 mm beside the bed on each side an occupant uses - both sides for two. Scored: up to "
         "750 mm beside it and 900 mm at the foot."),
    Rule("R3", "entrance_path", "Clear path from the entrance to the bed",
         "Keep a clear walking path between the bedroom entrance and the bed.",
         "Hard: a continuous path at least 600 mm wide from the entrance to each side of the bed in use. "
         "Scored: whether it is 750 or 900 mm wide, and nothing standing in the direct line."),
    Rule("R4", "bedside_reach", "Bedside tables in reach",
         "Place bedside tables within convenient reach of the bed.",
         "Built in: a table always touches the bed at the pillow end. Scored: tables placed out of "
         "tables wanted."),
    Rule("R5", "wardrobe_clearance", "Clearance in front of the wardrobe",
         "Leave sufficient clearance in front of wardrobes for opening doors and accessing clothes.",
         "Hard: 750 mm in front of the wardrobe - its 500 mm doors open and leave room to stand. "
         "Scored: up to 900 mm."),
    Rule("R6", "wardrobe_position", "Wardrobe clear of doors, windows and paths",
         "Position wardrobes so they do not obstruct doors, windows, or walking paths.",
         "Hard: the wardrobe never stands in a door's swing, in front of a window or on the floor beside "
         "the bed. Scored: a 300 mm margin from windows, distance from the doorway, and out of the direct "
         "line from the entrance to the bed."),
    Rule("R7", "dressing_mirror", "Dressing table with a usable mirror",
         "Place dressing tables where occupants can use the mirror comfortably.",
         "Hard: the mirror never stands in front of a window. Scored: daylight on the face - a window to "
         "the side and near, rather than behind the person or far away."),
    Rule("R8", "standing_space", "Standing room at dressing table and wardrobe",
         "Provide sufficient space in front of dressing tables and wardrobes for standing and movement.",
         "Hard: 700 mm in front of the dressing table for its stool and the person on it. Scored: up to "
         "900 mm, and the floor in front of each piece not shared with another piece or the bedside."),
    Rule("R9", "desk_and_bed", "Desk and chair clear of the bed",
         "Position study desks and chairs so they do not interfere with access to the bed.",
         "Hard: the desk and its chair stay out of the floor beside the bed. Scored: the way to the bed "
         "still works with the chair pulled out. Not applicable without a desk."),
    Rule("R10", "personal_reach", "Personal items within reach",
         "Keep frequently used personal items within comfortable reach.",
         "Scored: bedside surface level with the mattress and within arm's reach, and a short walk from "
         "the bed to the wardrobe."),
    Rule("R11", "no_overcrowding", "Room not overcrowded",
         "Avoid overcrowding the room with unnecessary furniture.",
         "Decides which optional pieces the room gets. Scored: floor covered by furniture, the largest "
         "clear square left, and leftover gaps too narrow to use."),
    Rule("R12", "window_reach", "Windows and ventilation reachable",
         "Arrange furniture to maintain access to windows and ventilation openings.",
         "Hard: nothing tall, and nothing taller than the sill, stands in front of a window. Scored: "
         "window fronts left completely free, and every window reachable on foot."),
    Rule("R13", "bedroom_lighting", "Light for reading and other activities",
         "Position bedroom lighting to support reading and other activities.",
         "Built in: a reading lamp on each bedside table, a ceiling light over the open floor, a lamp on "
         "the desk and a light at the dressing mirror. Scored: a reading lamp for every sleeper."),
    Rule("R14", "all_occupants", "Every occupant provided for",
         "Consider the needs and preferences of all occupants when arranging furniture.",
         "Decides the bed and wardrobe sizes for the number of occupants and honours the pieces asked "
         "for. Scored: a side of the bed, a bedside table and wardrobe space for each, and every "
         "requested piece placed."),
    Rule("R15", "connecting_route", "Route between bed, wardrobe, bathroom and exit",
         "Maintain a clear route between the bed, wardrobe, bathroom entrance, and bedroom exit where applicable.",
         "Hard: one continuous path at least 600 mm wide links them all. Scored: its width, floor that is "
         "cut off, and nothing in the direct line from the bed to the bathroom door."),
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
        if self.score >= 0.75:
            return "satisfied"
        return "partly_satisfied" if self.score >= 0.5 else "not_satisfied"


@dataclass
class Part:
    """One measured aspect of a rule: a 0..1 mark and the sentence that reports it."""

    score: float
    detail: str = ""
    applicable: bool = True

    @staticmethod
    def skip(detail: str) -> "Part":
        return Part(0.0, detail, False)


def metres(mm: float) -> str:
    return "{:.2f} m".format(mm / 1000.0)


def label(item: Item) -> str:
    return item.type.replace("_", " ")


def _view_factor(angle: float) -> float:
    """1 while the door is in view without turning, fading to 0 once it is behind the pillow."""
    if angle <= 60.0:
        return 1.0
    if angle <= 90.0:
        return 1.0 - 0.4 * (angle - 60.0) / 30.0
    if angle <= 120.0:
        return 0.6 * (1.0 - (angle - 90.0) / 30.0)
    return 0.0


class Evaluator:
    """Scores a layout against the fifteen rules and re-checks every hard limit."""

    def __init__(self, room: Room, doors: List[Door], windows: List[Window], programme: Programme, config: Config):
        self.room = room
        self.doors = doors
        self.windows = windows
        self.programme = programme
        self.config = config
        self.c = config.clearances
        self.main_door: Optional[Door] = next((d for d in doors if d.is_main), None)
        self.bath_door: Optional[Door] = next(
            (d for d in doors if not d.is_main and d.leads_to and BATHROOM.search(d.leads_to)), None)
        self.door_zones = [d.keep_clear(room, self.c.door_entry_depth) for d in doors]
        self.window_bands = [(w, w.access(room, self.c.window_access_depth)) for w in windows]
        self.weights = {rule.id: float(getattr(config.weights, rule.key)) for rule in RULES}

    # ------------------------------------------------------------------ #
    def _combine(self, rule_id: str, parts: List[Tuple[float, Part]]) -> RuleResult:
        """Weighted mean of the parts that apply; not applicable when none does."""
        rule, weight = RULE_BY_ID[rule_id], self.weights[rule_id]
        text = " ".join(p.detail for _, p in parts if p.detail)
        live = [(w, p) for w, p in parts if p.applicable]
        total = sum(w for w, _ in live)
        if not total:
            return RuleResult(rule, 0.0, weight, text, applicable=False)
        return RuleResult(rule, clamp01(sum(w * p.score for w, p in live) / total), weight, text)

    def static(self, lay: Layout, explain: bool = False, open_side: Optional[float] = None,
               report: Optional[CirculationReport] = None) -> Dict[str, RuleResult]:
        """All fifteen rules.

        `open_side` is the largest clear square of floor and `report` the
        walkability analysis, both measured once a layout is finished; while
        the search is still comparing candidates they are left out and the
        parts that need them assume the best.
        """
        one = lambda rule_id, part: self._combine(rule_id, [(1.0, part)])
        return {
            "R1": self._combine("R1", [
                (0.25, self._bed_size(lay, explain)),
                (0.15, self._door_distance(lay, explain)),
                (0.25, self._bed_windows(lay, explain)),
                (0.20, self._entrance_view(lay, explain)),
                (0.15, self._door_swing(lay, explain)),
            ]),
            "R2": one("R2", self._bed_access(lay, explain)),
            "R3": one("R3", self._entrance_path(lay, explain, report)),
            "R4": one("R4", self._bedside_tables(lay, explain)),
            "R5": one("R5", self._wardrobe_clearance(lay, explain)),
            "R6": self._combine("R6", [
                (0.40, self._wardrobe_windows(lay, explain)),
                (0.30, self._wardrobe_door(lay, explain)),
                (0.30, self._wardrobe_path(lay, explain)),
            ]),
            "R7": one("R7", self._dressing_mirror(lay, explain)),
            "R8": one("R8", self._standing_space(lay, explain)),
            "R9": one("R9", self._desk(lay, report)),
            "R10": one("R10", self._reach_and_height(lay, explain)),
            "R11": one("R11", self._overcrowding(lay, explain, open_side)),
            "R12": one("R12", self._window_access(lay, explain, report)),
            "R13": one("R13", self._lighting(lay, explain)),
            "R14": one("R14", self._occupants(lay, explain)),
            "R15": one("R15", self._route(lay, explain, report)),
        }

    @staticmethod
    def total(results: Dict[str, RuleResult]) -> float:
        """0-100: points earned out of the points the applicable rules could give."""
        weight = sum(r.weight for r in results.values() if r.applicable)
        return 100.0 * sum(r.points for r in results.values()) / weight if weight else 0.0

    # ------------------------------------------------------------------ #
    # the new parts the master-bedroom rules add
    # ------------------------------------------------------------------ #
    def bed_zones(self, lay: Layout) -> List[Tuple[str, Tuple[float, float, float, float]]]:
        """The strips beside the bed an occupant gets in and out by."""
        return [(name, zone) for name, zone in lay.keep_clear if "side of the bed" in name]

    def _line_blocker(self, lay: Layout, start: Point, end: Point, skip: Tuple[str, ...]) -> Optional[Item]:
        return next((i for i in lay.items if i.type not in skip and segment_hits(start, end, i.rect)), None)

    def _bed_size(self, lay: Layout, explain: bool) -> Part:
        sizes, room = self.programme.bed_sizes, self.room
        rank = sizes.index(lay.bed_size) if lay.bed_size in sizes else len(sizes)
        score = max(0.4, 1.0 - 0.2 * rank)
        if not explain:
            return Part(score)
        text = "{} on the {} wall of a {} x {} room".format(
            BEDS[lay.bed_size].label.capitalize(), lay.bed.wall, metres(room.width), metres(room.length))
        if rank > 0:
            text += " - a {} was the first choice but does not fit with every clearance".format(BEDS[sizes[0]].label)
        return Part(score, text + ".")

    def _entrance_path(self, lay: Layout, explain: bool, report: Optional[CirculationReport]) -> Part:
        door = self.main_door
        if door is None:
            return Part.skip("No door was detected, so there was no entrance to walk from.")
        if report is None:
            return Part(1.0)
        widths = self.c.path_widths
        if not report.valid:
            return Part(0.0, "No path at least {:.0f} mm wide reaches {}.".format(
                min(widths), ", ".join(report.unreachable) or "the bed"))
        span = max(widths) - min(widths)
        wide = 0.6 + 0.4 * (report.width - min(widths)) / span if span else 1.0
        start = door.center(self.room)
        zones = self.bed_zones(lay)
        blocker = None
        if zones:
            at_door = (start[0], start[1], start[0], start[1])
            target = center(min(zones, key=lambda entry: distance(at_door, entry[1]))[1])
            blocker = self._line_blocker(lay, start, target, ("bed", "bedside_table"))
        text = "A path {:.0f} mm wide runs from the entrance to the bed; {}.".format(
            report.width, "the {} stands in the direct line".format(label(blocker)) if blocker
            else "nothing stands in the direct line")
        return Part(0.6 * wide + 0.4 * (0.0 if blocker else 1.0), text)

    def _wardrobe_clearance(self, lay: Layout, explain: bool) -> Part:
        c = self.c
        if lay.wardrobe is None:
            return Part(0.0, "No wardrobe could be placed.") if self.programme.wardrobe_sizes \
                else Part.skip("This layout has no wardrobe.")
        clear = self.front_clearance(lay, lay.wardrobe)
        if clear < c.wardrobe_front_min - 1.0:
            return Part(0.0, "Only {} is clear in front of the wardrobe.".format(metres(clear)))
        score = 0.6 + 0.4 * clamp01((clear - c.wardrobe_front_min)
                                    / (c.wardrobe_front_preferred - c.wardrobe_front_min))
        return Part(score, "{} of clear floor in front of the {}: its {} doors open fully with {} left to stand "
                    "in (minimum {}).".format(
                        metres(clear), WARDROBES[lay.wardrobe.model].label, metres(WARDROBE_LEAF),
                        metres(clear - WARDROBE_LEAF), metres(c.wardrobe_front_min)) if explain else "")

    def _wardrobe_windows(self, lay: Layout, explain: bool) -> Part:
        if lay.wardrobe is None:
            return Part.skip("")
        return self._tall_furniture(lay, explain)

    def _wardrobe_door(self, lay: Layout, explain: bool) -> Part:
        door = self.main_door
        if lay.wardrobe is None or door is None:
            return Part.skip("")
        room, c = self.room, self.c
        gap = distance(lay.wardrobe.rect, door.opening(room))
        ahead = intersects(room.band(door.wall, door.start, door.end, c.door_ahead_good), lay.wardrobe.rect)
        score = 0.5 * clamp01((gap - 300.0) / 900.0) + 0.5 * (0.0 if ahead else 1.0)
        return Part(score, "The wardrobe is {} from the doorway{}.".format(
            metres(gap), " and stands straight ahead of it" if ahead else ", out of its swing") if explain else "")

    def _wardrobe_path(self, lay: Layout, explain: bool) -> Part:
        door = self.main_door
        zones = self.bed_zones(lay)
        if lay.wardrobe is None or door is None or not zones:
            return Part.skip("")
        start = door.center(self.room)
        crossed = [name for name, zone in zones if segment_hits(start, center(zone), lay.wardrobe.rect)]
        return Part(0.0 if crossed else 1.0, ("It stands in the direct line from the entrance to {}."
                                              if crossed else "It is clear of the way from the entrance to the bed{}."
                                              ).format(crossed[0] if crossed else "") if explain else "")

    def _dressing_mirror(self, lay: Layout, explain: bool) -> Part:
        table = lay.dresser
        if table is None:
            return Part(0.0, "No wall had room for the dressing table.") if self.programme.dresser \
                else Part.skip("No dressing table was planned for this room.")
        if not self.windows:
            return Part(0.8, "The dressing table stands against the {} wall; the room has no window, so its "
                        "mirror relies on the light fitted over it.".format(table.wall))
        room = self.room
        window = min(self.windows, key=lambda w: distance(table.rect, w.access(room, 0.0)))
        gap = distance(table.rect, window.access(room, 0.0))
        if window.wall == table.wall:
            side, where = 0.9, "beside the mirror on the same wall"
        elif window.wall == OPPOSITE[table.wall]:
            side, where = 0.6, "behind the person, so it shows in the mirror"
        else:
            side, where = 1.0, "to the side, so daylight falls on the face"
        near = 1.0 - 0.4 * clamp01((gap - 2000.0) / 2500.0)
        return Part(side * near, "The dressing table stands against the {} wall with window {} {} away, {}.".format(
            table.wall, window.id, metres(gap), where) if explain else "")

    def _standing_space(self, lay: Layout, explain: bool) -> Part:
        c = self.c
        fronts = [(name, zone) for name, zone in lay.keep_clear if "side of the bed" not in name]
        if not fronts:
            return Part.skip("This layout has no wardrobe or dressing table.")
        marks, notes = [], []
        if lay.dresser is not None:
            clear = self.front_clearance(lay, lay.dresser)
            marks.append(0.6 + 0.4 * clamp01((clear - c.drawer_front_min)
                                             / (c.drawer_front_preferred - c.drawer_front_min))
                         if clear >= c.drawer_front_min - 1.0 else 0.0)
            notes.append("{} in front of the dressing table for its stool and the person on it (minimum {})".format(
                metres(clear), metres(c.drawer_front_min)))
        shared = []
        every = list(lay.keep_clear)
        for name, zone in fronts:
            for other_name, other in every:
                if other_name != name and intersects(zone, other) and (other_name, name) not in shared:
                    shared.append((name, other_name))
        marks.append(1.0 if not shared else 0.6)
        notes.append("the floor in front of {} is also the floor at {}".format(*shared[0]) if shared
                     else "the floor in front of each piece is its own, so two people can use them at once")
        text = "; ".join(notes) + "."
        return Part(sum(marks) / len(marks), text[0].upper() + text[1:] if explain else "")

    def _desk(self, lay: Layout, report: Optional[CirculationReport]) -> Part:
        if report is None:
            return Part(1.0) if lay.desk is not None else Part.skip("")
        return self.chair_result(lay, report)

    def _overcrowding(self, lay: Layout, explain: bool, open_side: Optional[float]) -> Part:
        thresholds, room = self.config.rooms, self.room
        covered = sum(area(i.rect) for i in lay.items) / (room.width * room.length)
        density = 1.0 - clamp01(
            (covered - thresholds.crowded_ratio) / (thresholds.overcrowded_ratio - thresholds.crowded_ratio))
        gaps = self.dead_gaps(lay)
        wanted = min(thresholds.open_floor_side, thresholds.open_floor_share * min(room.width, room.length))
        open_floor = 1.0 if open_side is None else clamp01(open_side / wanted)
        score = 0.40 * open_floor + 0.40 * density + 0.20 * max(0.0, 1.0 - 0.5 * gaps)
        if not explain:
            return Part(score)
        text = "{} pieces cover {:.0f}% of the {:.1f} m2 floor".format(len(lay.items), covered * 100.0, room.area_m2)
        if open_side is not None:
            text += "; the largest clear square is {} across".format(metres(open_side))
        if gaps:
            text += "; {} leftover gap{} too narrow to use".format(gaps, " is" if gaps == 1 else "s are")
        return Part(score, text + ".")

    def _window_access(self, lay: Layout, explain: bool, report: Optional[CirculationReport]) -> Part:
        if not self.windows:
            return Part.skip("No window or ventilation opening was detected on this room's walls.")
        taken = [w.id for w, band in self.window_bands if any(intersects(i.rect, band) for i in lay.items)]
        free = 1.0 - len(taken) / float(len(self.window_bands))
        cut = [name for name in (report.cut_off if report is not None else []) if name.startswith("window")]
        reach = 1.0 - len(cut) / float(len(self.window_bands))
        if not explain:
            return Part(0.5 * free + 0.5 * reach)
        text = ("Nothing stands in front of any window" if not taken
                else "Low furniture stands in front of window {}, below the sill".format(", ".join(taken)))
        if report is not None and report.checked:
            text += "; every window can be walked up to and opened" if not cut \
                else "; {} cannot be walked up to".format(", ".join(cut))
        return Part(0.5 * free + 0.5 * reach, text + ".")

    def lighting(self, lay: Layout) -> List[Tuple[str, str, Point, str, float]]:
        """Rule 13: (type, label, position, mounting, height above the floor) for every light."""
        room = self.room
        lights = [("bedside_lamp", "reading lamp", center(t.rect), "table", t.height + 450.0) for t in lay.tables]
        # the ceiling light goes over the open floor at the foot of the bed
        fx, fy = FACING_VECTOR[lay.bed.facing]
        bx, by = center(lay.bed.rect)
        reach = lay.bed.depth / 2.0
        clear = self.bed_clearances(lay)["foot"]
        lights.append(("ceiling_light", "ceiling light",
                       (min(max(bx + fx * (reach + clear / 2.0), 300.0), room.width - 300.0),
                        min(max(by + fy * (reach + clear / 2.0), 300.0), room.length - 300.0)),
                       "ceiling", room.height))
        if lay.desk is not None:
            lights.append(("desk_lamp", "desk lamp", center(lay.desk.rect), "table", lay.desk.height + 400.0))
        if lay.dresser is not None:
            lights.append(("mirror_light", "mirror light", center(lay.dresser.rect), "wall", 1700.0))
        return lights

    def _lighting(self, lay: Layout, explain: bool) -> Part:
        sleepers = self.programme.occupants
        lamps = min(len(lay.tables), sleepers)
        score = 0.4 + 0.6 * lamps / float(sleepers)
        if not explain:
            return Part(score)
        notes = ["{} reading lamp{} at the bed for {} sleeper{}".format(
            lamps or "No", "" if lamps == 1 else "s", sleepers, "" if sleepers == 1 else "s"),
            "a ceiling light over the open floor at the foot of the bed"]
        if lay.desk is not None:
            notes.append("a lamp on the desk")
        if lay.dresser is not None:
            notes.append("a light over the dressing mirror")
        return Part(score, "; ".join(notes) + ".")

    def _occupants(self, lay: Layout, explain: bool) -> Part:
        programme, c = self.programme, self.c
        people = programme.occupants
        clear = self.bed_clearances(lay)
        sides = sum(1 for side in ("lo", "hi") if clear[side] >= c.bed_side_min - 1.0)
        marks = [min(sides, people) / float(people),
                 1.0 if BED_SLEEPS[lay.bed_size] >= people else 0.2]
        notes = ["{} of {} occupant{} can get in on a side of their own".format(
            min(sides, people), people, "" if people == 1 else "s")]
        if programme.bedside_tables:
            marks.append(min(len(lay.tables), programme.bedside_tables) / float(programme.bedside_tables))
            notes.append("{} bedside table{}".format(len(lay.tables), "" if len(lay.tables) == 1 else "s"))
        if programme.wardrobe_sizes:
            if lay.wardrobe is None:
                marks.append(0.0)
                notes.append("no wardrobe")
            else:
                first = lay.wardrobe.model == programme.wardrobe_sizes[0]
                marks.append(1.0 if first else 0.7)
                notes.append("a {} ({} of hanging rail each)".format(
                    WARDROBES[lay.wardrobe.model].label, metres(lay.wardrobe.width / people)))
        planned = programme.pieces()
        placed = 1 + len(lay.tables) + sum(x is not None for x in (lay.wardrobe, lay.dresser, lay.desk))
        marks.append(max(0.0, 1.0 - 0.5 * (planned - placed)))
        notes.append("{} of the {} planned pieces placed".format(placed, planned))
        return Part(sum(marks) / len(marks), "Planned for {}: {}.".format(
            "two occupants" if people >= 2 else "one occupant", "; ".join(notes)) if explain else "")

    def _route(self, lay: Layout, explain: bool, report: Optional[CirculationReport]) -> Part:
        if self.main_door is None:
            return Part.skip("No door was detected, so there is no exit to link the bed and the wardrobe to.")
        if report is None:
            return Part(1.0)
        widths, room = self.c.path_widths, self.room
        if not report.valid:
            return Part(0.0, "No path at least {:.0f} mm wide reaches {}.".format(
                min(widths), ", ".join(report.unreachable) or "the room"))
        span = max(widths) - min(widths)
        wide = 0.6 + 0.4 * (report.width - min(widths)) / span if span else 1.0
        lost = max(0.0, self.c.cut_off_tolerance - report.reached_ratio)
        wide *= clamp01(1.0 - 2.0 * lost)
        places = ["the bed"]
        if lay.wardrobe is not None:
            places.append("the wardrobe")
        if self.bath_door is not None:
            places.append("the bathroom door")
        places.append("the bedroom exit")
        text = "One route {:.0f} mm wide links {} and {}; {:.0f}% of the open floor can be walked to".format(
            report.width, ", ".join(places[:-1]), places[-1], report.reached_ratio * 100.0)
        line = 1.0
        zones = self.bed_zones(lay)
        if self.bath_door is not None and zones:
            target = self.bath_door.center(room)
            start = center(min(zones, key=lambda entry: distance(
                (target[0], target[1], target[0], target[1]), entry[1]))[1])
            blocker = self._line_blocker(lay, start, target, ("bed", "bedside_table"))
            line = 0.0 if blocker else 1.0
            text += "; from the bed the bathroom door is {} away, {}".format(
                metres(math.hypot(target[0] - start[0], target[1] - start[1])),
                "round the {}".format(label(blocker)) if blocker else "in a straight line")
        elif self.bath_door is None:
            text += "; no bathroom opens off this room"
        if report.pinch is not None:
            text += "; a {:.0f} mm path would not reach {}".format(report.pinch[0], ", ".join(report.pinch[1]))
        return Part(0.7 * wide + 0.3 * line, text + ".")

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
    # rule 1 - parts: the view of the entrance, the doorway, the door swing, the windows
    # ------------------------------------------------------------------ #
    def _entrance_view(self, lay: Layout, explain: bool) -> Part:
        door = self.main_door
        if door is None:
            return Part.skip("No door was detected, so the view of the entrance could not be assessed.")
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
            return Part(score)

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
        return Part(score, text)

    # ------------------------------------------------------------------ #
    # rule 1 - distance between the bed and the doorway
    # ------------------------------------------------------------------ #
    def _door_distance(self, lay: Layout, explain: bool) -> Part:
        door = self.main_door
        if door is None:
            return Part.skip("No door was detected, so the distance to the doorway could not be measured.")
        gap = distance(lay.bed.rect, door.opening(self.room))
        score = clamp01((gap - self.c.bed_door_near) / (self.c.bed_door_far - self.c.bed_door_near))
        if not explain:
            return Part(score)
        if score >= 1.0:
            tail = ", comfortably clear of it."
        elif score >= 0.4:
            tail = ", close enough to notice the door but not crowding it."
        else:
            tail = ", which is close to the door."
        return Part(score, "The bed is {} from the doorway{}".format(metres(gap), tail))

    # ------------------------------------------------------------------ #
    # rule 1 - which way the door opens
    # ------------------------------------------------------------------ #
    def _door_swing(self, lay: Layout, explain: bool) -> Part:
        door = self.main_door
        if door is None:
            return Part.skip("No door was detected, so there was no door swing to keep clear.")
        room = self.room
        depth = room.depth_from(door.wall)
        line = room.band(door.wall, door.start, door.end, depth)
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
            return Part(score)

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
        return Part(score, text)

    # ------------------------------------------------------------------ #
    # rule 1 - the bed and the windows
    # ------------------------------------------------------------------ #
    def _bed_windows(self, lay: Layout, explain: bool) -> Part:
        if not self.windows:
            return Part.skip("No window was detected, so there was nothing to check the bed against.")
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
            return Part(score)

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
        return Part(score, "; ".join(parts) + ".")

    # ------------------------------------------------------------------ #
    # rule 2 - space beside the bed
    # ------------------------------------------------------------------ #
    def _bed_access(self, lay: Layout, explain: bool) -> Part:
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
            return Part(score)

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
        return Part(score, text)

    # ------------------------------------------------------------------ #
    # rule 4 - bedside tables within reach
    # ------------------------------------------------------------------ #
    def _bedside_tables(self, lay: Layout, explain: bool) -> Part:
        wanted = self.programme.bedside_tables
        if wanted == 0:
            return Part.skip("No bedside table was asked for.")
        placed = len(lay.tables)
        score = min(1.0, placed / wanted)
        if not explain:
            return Part(score)
        if placed == 0:
            return Part(score, "No bedside table fits beside the bed in this position.")
        reach = lay.tables[0].width / 2.0
        text = ("{} bedside table{} against the bed at the pillow end, {} from the mattress edge - "
                "within arm's reach.").format(placed, " stands" if placed == 1 else "s stand", metres(reach))
        if placed < wanted:
            text += " A second one does not fit on the other side."
        return Part(score, text)

    # ------------------------------------------------------------------ #
    def chair_result(self, lay: Layout, report: CirculationReport) -> Part:
        if lay.desk is None:
            return Part.skip("The study desk could not be placed, so there was nothing to check." if self.programme.desk
                else "This layout has no study desk.")
        if not report.checked:
            return Part(1.0, "The desk and its chair stay out of every keep-clear zone.")
        if report.chair_clear:
            return Part(1.0,
                "The desk and chair are off the walking path: even with the chair pulled out, the route between "
                "the entrance, the bed and the storage stays at least {:.0f} mm wide.".format(self.c.path_min))
        return Part(0.5,
            "The desk and chair stay out of every keep-clear zone, but a pulled-out chair narrows the route below "
            "{:.0f} mm - it has to be tucked in for someone to pass.".format(self.c.path_min))

    # ------------------------------------------------------------------ #
    # rule 6 - the wardrobe and the windows
    # ------------------------------------------------------------------ #
    def _tall_furniture(self, lay: Layout, explain: bool) -> Part:
        if not self.windows:
            return Part.skip("No window or ventilation opening was detected, so there was nothing to block.")
        tall = [i for i in lay.items if i.height >= self.c.tall_furniture_height]
        if not tall:
            return Part(1.0, "Nothing in this layout is tall enough to block a window.")
        margin, nearest = float("inf"), None
        for item in tall:
            for window, band in self.window_bands:
                gap = distance(item.rect, band)
                if gap < margin:
                    margin, nearest = gap, (item, window)
        preferred = self.c.window_margin_preferred
        score = 1.0 if margin >= preferred else 0.7 + 0.3 * margin / preferred
        if not explain:
            return Part(score)
        item, window = nearest
        if margin >= preferred:
            text = ("The {} ({} tall) stands {} clear of the nearest window, so no light or ventilation "
                    "is blocked.").format(label(item), metres(item.height), metres(margin))
        else:
            text = "The {} ({} tall) is clear of window {} but only {} from it, which crowds the curtains.".format(
                label(item), metres(item.height), window.id, metres(margin))
        return Part(score, text)

    # ------------------------------------------------------------------ #
    # rule 10 - convenient heights and comfortable reach
    # ------------------------------------------------------------------ #
    def _reach_and_height(self, lay: Layout, explain: bool) -> Part:
        c = self.c
        marks, parts = [], []
        if self.programme.bedside_tables:
            if lay.tables:
                table = lay.tables[0]
                reach = table.width / 2.0
                marks.append(1.0 - clamp01(abs(table.height - MATTRESS_HEIGHT) / 300.0))
                marks.append(1.0 - clamp01((reach - c.bedside_reach) / c.bedside_reach))
                parts.append(
                    "the bedside surface is {:.0f} mm high, level with the {:.0f} mm mattress, and {} from "
                    "the bed edge".format(table.height, MATTRESS_HEIGHT, metres(reach)))
            else:
                marks.append(0.0)
                parts.append("nothing is within reach of the pillow")
        storage = lay.wardrobe
        if storage is not None:
            walk = distance(lay.bed.rect, storage.rect)
            marks.append(1.0 - 0.5 * clamp01(
                (walk - c.storage_reach_good) / (c.storage_reach_far - c.storage_reach_good)))
            parts.append("the {} is {} from the bed".format(label(storage), metres(walk)))
        if lay.desk is not None:
            parts.append("the desk top is at {:.0f} mm".format(lay.desk.height))
        if not marks:
            return Part.skip("This layout has no bedside table or storage to judge.")
        score = sum(marks) / len(marks)
        if not explain:
            return Part(score)
        text = "; ".join(parts) + "."
        return Part(score, text[0].upper() + text[1:])

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
                    add("R1" if item.type in ("bed", "bedside_table") else "R6", "door",
                        "The {} stands where door {} needs to open.".format(label(item), door.id), item.id)
            for window, band in self.window_bands:
                if intersects(item.rect, band) and (
                    item.height >= c.tall_furniture_height or item.height > window.sill_height
                    or (item.type == "bed" and window.sill_height <= c.floor_window_sill)
                ):
                    add("R12", "window", "The {} blocks window {}.".format(label(item), window.id), item.id)

        clear = self.bed_clearances(lay)
        need = 2 if self.programme.occupants >= 2 else 1
        usable = [side for side in ("lo", "hi") if clear[side] >= c.bed_side_min - 1.0]
        if len(usable) < need:
            add("R2", "bed_access",
                "The bed has {:.0f} mm of clear floor on {} side{} but {} needed.".format(
                    c.bed_side_min, len(usable) or "no", "" if len(usable) == 1 else "s",
                    "both are" if need == 2 else "one is"),
                lay.bed.id)

        for item, minimum in ((lay.wardrobe, c.wardrobe_front_min), (lay.dresser, c.drawer_front_min)):
            if item is not None and self.front_clearance(lay, item) < minimum - 1.0:
                add("R5" if item is lay.wardrobe else "R8", "storage",
                    "Less than {:.0f} mm is clear in front of the {}.".format(minimum, label(item)), item.id)

        if self.programme.wardrobe_sizes and self.programme.wardrobe_required and lay.wardrobe is None:
            add("R14", "missing", "No position was found for the wardrobe.")

        if lay.chair is not None:
            for name, zone in lay.keep_clear:
                if intersects(lay.chair.rect, zone):
                    add("R9", "chair",
                        "The desk chair stands in the clear floor needed at {}.".format(name), lay.chair.id)

        if report is not None and report.checked and not report.valid:
            add("R15", "path", "No path at least {:.0f} mm wide links the entrance to {}.".format(
                c.path_min, ", ".join(report.unreachable) or "the rest of the room"))
        return found
