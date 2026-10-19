"""
Kitchen layout generation.

The search is deterministic - no learning, no randomness - and every step can
be replayed:

    1. the appliance sizes and the dining table are fixed for the floor area
       (`programme.py`, the first half of rule 12);
    2. every kitchen shape the walls and doors allow is laid out as counter
       runs: one-wall, L-shaped, U-shaped and galley (`runs.py`);
    3. for each shape the refrigerator is tried at every end of the worktop (and
       on its own against a free wall), the sink at every position along it,
       the stove at every position that leaves a preparation worktop - and each
       combination is measured once and ranked by the six rules that depend only
       on those three (1-5 and 11);
    4. the best combinations are built out: worktops named, utensil drawers put
       beside the stove (rule 8), a dining table seated in the floor left over
       (rule 10) - then walked and scored against all twelve rules;
    5. the best kitchen of each shape is returned, best first.

A shape that cannot take the appliances the room called for is tried again with
the next size down. A table that fits nowhere clear of the working floor is left
out and reported, never squeezed in.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field, replace
from typing import Dict, Iterable, List, Optional, Tuple

from .circulation import CirculationReport, Target, analyse, can_walk, open_square
from .config import Config
from .floorplan import Shell, build_shell
from .geometry import Rect, clamp01, contains, hits_any, inflate, intersects
from .programme import SEAT_WORDS, Programme, select_programme
from .room import OPPOSITE, WALLS
from .rules import CORE_RULES, RULES, Evaluator, Facts, RuleResult, metres
from .runs import Arrangement, Piece, build_arrangements, strip_gaps
from .units import (
    APPLIANCES,
    CHAIR_HEIGHT,
    CHAIR_SIZE,
    COUNTER_HEIGHT,
    TABLE_HEIGHT,
    TABLES,
    Dining,
    Item,
    Layout,
    Spec,
    Station,
    Unplaced,
)

KIND_ORDER = ("u_shaped", "l_shaped", "galley", "one_wall")
STATION_NAMES = {"sink": "sink", "stove": "stove", "fridge": "refrigerator"}
COUNTER_ROLES = {"prep": "prep counter", "ready": "serving counter", "counter": "counter"}


def reported(score: float) -> float:
    """A total as it is given out: to one decimal."""
    return round(score, 1)


@dataclass
class Result:
    """A finished, scored kitchen."""

    layout: Layout
    facts: Facts
    rules: Dict[str, RuleResult]
    score: float
    report: CirculationReport
    violations: List[Dict] = field(default_factory=list)

    @property
    def valid(self) -> bool:
        return not self.violations


class Generator:
    """Builds, scores and ranks kitchen layouts for one room."""

    def __init__(self, shell: Shell, programme: Programme, config: Config):
        self.shell = shell
        self.room = shell.room
        self.doors = shell.doors
        self.windows = shell.windows
        self.programme = programme
        self.config = config
        self.c = config.clearances
        self.s = config.search
        self.ev = Evaluator(self.room, self.doors, self.windows, programme, config)
        door = self.ev.main_door
        self.entry_zone = door.keep_clear(self.room, self.c.door_entry_depth) if door else None
        self.entry_point = door.center(self.room) if door else None
        self.arrangements = build_arrangements(self.room, self.ev.door_zones, self.c, config.rooms)
        self.stats = {"shapes": len(self.arrangements), "combinations": 0, "kitchens_built": 0, "paths_walked": 0}
        self.elapsed = 0.0

    # ------------------------------------------------------------------ #
    def _worth(self, result: Result) -> Tuple[bool, bool, float]:
        """How results compare: valid first; a table that was asked for before one that was left out; then score."""
        asked = self.programme.dining and self.programme.dining_source == "provided"
        return (result.valid, result.layout.dining is not None or not asked, result.score)

    def run(self) -> List[Result]:
        started = time.perf_counter()
        results: List[Result] = []
        for arr in self.arrangements:
            best: Optional[Result] = None
            for size_class in self.programme.size_classes:      # the planned size first, then smaller
                found = self._best(arr, size_class)
                if found is not None and (best is None or self._worth(found) > self._worth(best)):
                    best = found
                if best is not None and best.valid:
                    break
            if best is not None:
                results.append(best)
        chosen = self._select(results)
        self.elapsed = time.perf_counter() - started
        return chosen

    def _best(self, arr: Arrangement, size_class: str) -> Optional[Result]:
        best: Optional[Result] = None
        for facts, sink, stove, fridge in self._combinations(arr, size_class):
            self.stats["kitchens_built"] += 1
            layout = self._seat(self._build(arr, size_class, sink, stove, fridge, facts))
            result = self._finish(layout, facts)
            if result is not None and (best is None or self._worth(result) > self._worth(best)):
                best = result
        return best

    # ------------------------------------------------------------------ #
    # where the three appliances can stand
    # ------------------------------------------------------------------ #
    def _station(self, kind: str, spec: Spec, chain: int, piece: Piece, s0: float) -> Station:
        ta, tb = piece.wall_span(s0, s0 + spec.width)
        return Station(
            kind, spec, self.room.band(piece.wall, ta, tb, spec.depth), piece.wall, chain, s0, s0 + spec.width,
            self.room.point(piece.wall, (ta + tb) / 2.0, spec.depth), ta, tb)

    def _aisles(self, arr: Arrangement) -> List[Rect]:
        """Rule 9: the floor in front of every run that has to stay clear."""
        depth = self.c.counter_depth
        return [self.room.band(piece.wall, piece.t0, piece.t1, self.c.aisle_min, offset=depth)
                for _, piece in arr.runs()]

    def _fridge_fits(self, arr: Arrangement, fridge: Station, own: Optional[Piece]) -> bool:
        """Rules 6 and 12: a tall unit clear of doors and windows, with floor for its door to swing."""
        room, depth = self.room, self.c.counter_depth
        if not contains(room.rect, fridge.rect) or hits_any(fridge.rect, self.ev.door_zones):
            return False
        if any(intersects(fridge.rect, band) for _, band in self.ev.window_bands):
            return False                    # nothing tall in front of a window
        swing = room.band(fridge.wall, fridge.t0, fridge.t1, fridge.spec.door, offset=fridge.spec.depth)
        if not contains(room.rect, swing):
            return False
        for piece in arr.pieces():
            strip = room.band(piece.wall, piece.t0, piece.t1, depth)
            if intersects(swing, strip) or (piece is not own and intersects(fridge.rect, strip)):
                return False
        return True

    def _fridge_spots(self, arr: Arrangement, spec: Spec) -> List[Station]:
        """The refrigerator closes off an end of the worktop, or stands alone against a free wall."""
        room = self.room
        spots: List[Station] = []
        for index, chain in enumerate(arr.chains):
            for s0, piece in ((0.0, chain.pieces[0]), (chain.length - spec.width, chain.pieces[-1])):
                if piece.length < spec.width - 1.0:
                    continue
                fridge = self._station("fridge", spec, index, piece, s0)
                if self._fridge_fits(arr, fridge, piece):
                    spots.append(fridge)

        if arr.kind in ("one_wall", "l_shaped"):
            # on its own it stands in a corner of the room or beside a door - never adrift along a wall
            depth = self.c.counter_depth
            taken = self._aisles(arr) + [room.band(piece.wall, piece.t0, piece.t1, depth) for piece in arr.pieces()]
            for wall in WALLS:
                if wall in arr.walls:
                    continue
                for lo, hi in strip_gaps(room, wall, spec.depth, self.ev.door_zones):
                    for t in sorted({round(lo, 1), round(hi - spec.width, 1)}):
                        if t < lo - 1.0 or t + spec.width > hi + 1.0:
                            continue
                        fridge = Station(
                            "fridge", spec, room.band(wall, t, t + spec.width, spec.depth), wall, -1, 0.0, 0.0,
                            room.point(wall, t + spec.width / 2.0, spec.depth), t, t + spec.width)
                        if not hits_any(fridge.rect, taken) and self._fridge_fits(arr, fridge, None):
                            spots.append(fridge)
        return spots

    def _positions(self, arr: Arrangement, width: float, snaps) -> List[Tuple[int, Piece, float]]:
        """Every position for a unit `width` wide along the runs: a regular grid plus the snap points."""
        clear, step = self.c.corner_clear, self.s.step
        found: List[Tuple[int, Piece, float]] = []
        for index, chain in enumerate(arr.chains):
            for k, piece in enumerate(chain.pieces):
                if piece.corner:
                    continue
                lo, hi = piece.s0, piece.s1 - width
                if k > 0:
                    lo += clear                 # rule 1 / 3: not jammed into an inside corner
                if k + 1 < len(chain.pieces):
                    hi -= clear
                if hi < lo - 1.0:
                    continue
                marks = {round(lo, 1), round(hi, 1)}
                s = piece.s0
                while s <= hi + 1e-6:
                    if s >= lo - 1e-6:
                        marks.add(round(s, 1))
                    s += step
                for snap in snaps(index, piece):
                    if lo - 1.0 <= snap <= hi + 1.0:
                        marks.add(round(min(max(snap, lo), hi), 1))
                found += [(index, piece, mark) for mark in sorted(marks)]
        return found

    def _sink_spots(self, arr: Arrangement, spec: Spec, fridge: Station) -> List[Station]:
        """The best sink positions for one refrigerator position, spread over the runs."""
        c, width = self.c, spec.width

        def snaps(index: int, piece: Piece) -> Iterable[float]:
            for window in self.windows:           # centred under a window
                if window.wall == piece.wall:
                    middle = window.position + window.width / 2.0
                    yield piece.s_at(middle - width / 2.0, middle + width / 2.0)
            if fridge.chain == index:             # beside the refrigerator, or a worktop away from it
                for gap in (0.0, 300.0, 450.0, 600.0):
                    yield fridge.s1 + gap
                    yield fridge.s0 - width - gap

        ranked = []
        for index, piece, s0 in self._positions(arr, width, snaps):
            chain = arr.chains[index]
            before, after = s0, chain.length - s0 - width
            if fridge.chain == index:
                if fridge.s1 <= s0 + 1.0:
                    before = s0 - fridge.s1
                elif fridge.s0 >= s0 + width - 1.0:
                    after = fridge.s0 - s0 - width
                else:
                    continue                      # it would overlap the refrigerator
            if any(1.0 < gap < c.min_counter - 1.0 for gap in (before, after)):
                continue                          # it would leave a filler nobody can work on
            sink = self._station("sink", spec, index, piece, s0)
            landing = 0.4 + 0.6 * clamp01(min(before, after) / c.sink_landing_good)
            corner = 1.0 if chain.corner_gap(sink.s0, sink.s1) >= 2 * c.corner_clear else 0.8
            on_wall = [w for w in self.windows if w.wall == sink.wall]
            under = max((min(sink.t1, w.end) - max(sink.t0, w.start) for w in on_wall), default=0.0)
            window = 1.0 if under >= 0.5 * width else 0.7 if on_wall else 0.5
            ranked.append((-(0.45 * landing + 0.35 * window + 0.20 * corner), len(ranked), piece, sink))
        ranked.sort(key=lambda entry: entry[:2])

        chosen: List[Station] = []
        per_piece: Dict[int, int] = {}
        for _, _, piece, sink in ranked:          # the two best on every run first
            if per_piece.get(id(piece), 0) < 2:
                per_piece[id(piece)] = per_piece.get(id(piece), 0) + 1
                chosen.append(sink)
        for _, _, _, sink in ranked:
            if len(chosen) >= self.s.sinks_per_fridge:
                break
            if not any(sink is c_ for c_ in chosen):
                chosen.append(sink)
        return chosen[: max(self.s.sinks_per_fridge, len(per_piece) * 2)]

    def _stove_spots(self, arr: Arrangement, spec: Spec, fridge: Station, sink: Station) -> List[Station]:
        c, width = self.c, spec.width

        def snaps(index: int, piece: Piece) -> Iterable[float]:
            chain = arr.chains[index]
            if sink.chain == index:               # a preparation worktop away from the sink
                for gap in (c.prep_min, c.prep_preferred, 1200.0):
                    yield sink.s1 + gap
                    yield sink.s0 - width - gap
            if fridge.chain == index:
                yield fridge.s1 + c.stove_tall_gap
                yield fridge.s0 - width - c.stove_tall_gap
            yield c.stove_landing_min             # a landing in from either end of the worktop
            yield chain.length - width - c.stove_landing_min

        spots = []
        for index, piece, s0 in self._positions(arr, width, snaps):
            stove = self._station("stove", spec, index, piece, s0)
            if not 600.0 <= math.dist(stove.front, sink.front) <= c.leg_max + c.leg_min:
                continue                          # rule 4: too close to work at, or too far to carry
            spots.append(stove)
        return spots

    def _combinations(self, arr: Arrangement, size_class: str) -> List[Tuple[Facts, Station, Station, Station]]:
        """The best sink / stove / refrigerator combinations for one shape, by rules 1-5 and 11."""
        specs = APPLIANCES[size_class]
        ranked = []
        for fridge in self._fridge_spots(arr, specs["fridge"]):
            for sink in self._sink_spots(arr, specs["sink"], fridge):
                for stove in self._stove_spots(arr, specs["stove"], fridge, sink):
                    self.stats["combinations"] += 1
                    facts = self.ev.measure(arr, sink, stove, fridge)
                    if facts is not None:
                        ranked.append((-round(self.ev.rank(facts), 3), len(ranked), facts, sink, stove, fridge))
        ranked.sort(key=lambda entry: entry[:2])

        chosen, seen = [], set()
        for _, _, facts, sink, stove, fridge in ranked:       # the best of every distinct arrangement of walls
            signature = (sink.wall, stove.wall, fridge.wall, fridge.chain)
            if signature not in seen:
                seen.add(signature)
                chosen.append((facts, sink, stove, fridge))
            if len(chosen) >= self.s.finalists:
                break
        return chosen

    # ------------------------------------------------------------------ #
    # building the kitchen round the three appliances
    # ------------------------------------------------------------------ #
    def _build(self, arr: Arrangement, size_class: str, sink: Station, stove: Station, fridge: Station,
               facts: Facts) -> Layout:
        room, depth = self.room, self.c.counter_depth
        items: List[Item] = []
        for station in (sink, stove, fridge):
            spec = station.spec
            items.append(Item(
                "{}_1".format(station.kind), station.kind, STATION_NAMES[station.kind], spec.model, station.rect,
                station.wall, OPPOSITE[station.wall], spec.width, spec.depth, spec.height,
                "run:{}".format(station.wall) if station.chain >= 0 else "alone:{}".format(station.wall)))

        stretches = tuple(
            replace(s, role="prep" if s is facts.prep else "ready" if s is facts.ready else "counter")
            for s in facts.stretches)

        # rule 8: utensil drawers under the worktop right beside the stove - the preparation side if it has one
        beside = [s for s in stretches if "stove" in s.touches]
        host = next((s for s in beside if s.role == "prep"), None) or max(beside, key=lambda s: s.length)
        chain = arr.chains[stove.chain]
        ends_at_stove = abs(host.s1 - stove.s0) <= 1.0
        piece, lo, hi = chain.split(host.s0, host.s1)[-1 if ends_at_stove else 0]
        # one cabinet wide, and never the whole of a worktop that has room for a cupboard as well
        size = 450.0 if hi - lo >= 750.0 else 300.0 if hi - lo >= 600.0 else hi - lo
        drawer_span = (hi - size, hi) if ends_at_stove else (lo, lo + size)
        ta, tb = piece.wall_span(*drawer_span)
        drawers = Item("utensil_drawers_1", "utensil_drawers", "utensils", "drawer unit",
                       room.band(piece.wall, ta, tb, depth), piece.wall, OPPOSITE[piece.wall],
                       tb - ta, depth, COUNTER_HEIGHT, "beside:stove")
        items.append(drawers)

        # the worktop itself, one drawn piece per straight stretch
        count = 0
        for stretch in stretches:
            for piece, lo, hi in arr.chains[stretch.chain].split(stretch.s0, stretch.s1):
                spans = [(lo, hi)]
                if stretch is host and not piece.corner:      # leave out what the drawers take
                    spans = [(a, b) for a, b in ((lo, min(hi, drawer_span[0])), (max(lo, drawer_span[1]), hi))
                             if b - a > 1.0]
                for a, b in spans:
                    ta, tb = (piece.t0, piece.t1) if piece.corner else piece.wall_span(a, b)
                    count += 1
                    items.append(Item(
                        "counter_{}".format(count), "counter",
                        "corner" if piece.corner else COUNTER_ROLES[stretch.role], stretch.role,
                        room.band(piece.wall, ta, tb, depth), piece.wall, OPPOSITE[piece.wall],
                        tb - ta, depth, COUNTER_HEIGHT, "run:{}".format(piece.wall)))

        aisles = self._aisles(arr)
        if fridge.chain < 0:
            aisles.append(room.band(fridge.wall, fridge.t0, fridge.t1, self.c.aisle_min, offset=fridge.spec.depth))
        return Layout(
            arrangement=arr, size_class=size_class, sink=sink, stove=stove, fridge=fridge,
            stretches=stretches, items=tuple(items), aisles=tuple(aisles),
            drawers=drawers, drawers_on_prep=host.role == "prep")

    # ------------------------------------------------------------------ #
    # rule 10: the dining table
    # ------------------------------------------------------------------ #
    def _dining_at(self, box: Rect, seats: int, along: str) -> Dining:
        """Table and chairs inside `box`, which also holds the floor to push the chairs back."""
        length, width = TABLES[seats]
        reach, half = self.c.chair_depth + self.c.chair_pullout, CHAIR_SIZE / 2.0
        per_side = seats // 2
        chairs = []
        if along == "x":
            table = (box[0], box[1] + reach, box[0] + length, box[1] + reach + width)
            for i in range(per_side):
                cx = table[0] + length * (i + 0.5) / per_side
                chairs.append((cx - half, table[3], cx + half, table[3] + self.c.chair_depth))
                chairs.append((cx - half, table[1] - self.c.chair_depth, cx + half, table[1]))
            seated = (table[0], table[1] - self.c.chair_depth, table[2], table[3] + self.c.chair_depth)
        else:
            table = (box[0] + reach, box[1], box[0] + reach + width, box[1] + length)
            for i in range(per_side):
                cy = table[1] + length * (i + 0.5) / per_side
                chairs.append((table[2], cy - half, table[2] + self.c.chair_depth, cy + half))
                chairs.append((table[0] - self.c.chair_depth, cy - half, table[0], cy + half))
            seated = (table[0] - self.c.chair_depth, table[1], table[2] + self.c.chair_depth, table[3])
        return Dining(seats, table, tuple(chairs), seated, box, along)

    def _table_spot(self, lay: Layout, seats: int) -> Optional[Dining]:
        """The best place for a table: clear of the working floor, then of the triangle, then roomy.

        People seated at the table must be off the floor in front of every unit.
        The last 300 mm a chair needs to be pushed right back may reach into that
        floor - it is only used for a moment - but never into a unit or a doorway.
        """
        room, c = self.room, self.c
        length, width = TABLES[seats]
        reach = c.chair_depth + c.chair_pullout
        depth = max(c.counter_depth, lay.fridge.spec.depth)
        solid = [room.band(p.wall, p.t0, p.t1, depth) for p in lay.arrangement.pieces()]
        solid += list(self.ev.door_zones) + [lay.fridge.rect, self.ev.fridge_swing(lay)]

        best, best_key = None, None
        for along in ("x", "y"):
            w, h = (length, width + 2 * reach) if along == "x" else (width + 2 * reach, length)
            if w > room.width + 1.0 or h > room.length + 1.0:
                continue
            # the working floor, pulled in by the push-back allowance on the sides the chairs stand
            give = (0.0, c.chair_pullout) if along == "x" else (c.chair_pullout, 0.0)
            soft = [(a[0] + give[0], a[1] + give[1], a[2] - give[0], a[3] - give[1]) for a in lay.aisles]
            blockers = solid + [a for a in soft if a[2] - a[0] > 1.0 and a[3] - a[1] > 1.0]
            xs = sorted({round(min(max(x, 0.0), room.width - w), 1)
                         for x in [0.0, room.width - w] + [b[2] for b in blockers] + [b[0] - w for b in blockers]
                         if -1.0 <= x <= room.width - w + 1.0})
            ys = sorted({round(min(max(y, 0.0), room.length - h), 1)
                         for y in [0.0, room.length - h] + [b[3] for b in blockers] + [b[1] - h for b in blockers]
                         if -1.0 <= y <= room.length - h + 1.0})
            for x in xs:
                for y in ys:
                    box = (x, y, x + w, y + h)
                    if hits_any(box, blockers):
                        continue
                    box = self._centred(box, blockers)
                    dining = self._dining_at(box, seats, along)
                    outside, crossed, from_stove = self.ev.dining_marks(lay, dining)
                    off_aisles = not hits_any(box, lay.aisles)
                    room_round = min(self._slack(box, blockers))
                    key = (outside, not crossed, off_aisles, min(room_round, 600.0), round(from_stove), -x, -y)
                    if best_key is None or key > best_key:
                        best, best_key = dining, key
        return best

    def _slack(self, box: Rect, blockers: List[Rect]) -> Tuple[float, float]:
        """Free floor either side of `box` along x and along y, to the nearest blocker or wall."""
        left, right, below, above = 0.0, self.room.width, 0.0, self.room.length
        for b in blockers:
            if b[1] < box[3] - 1.0 and b[3] > box[1] + 1.0:       # level with the box
                if b[2] <= box[0] + 1.0:
                    left = max(left, b[2])
                elif b[0] >= box[2] - 1.0:
                    right = min(right, b[0])
            if b[0] < box[2] - 1.0 and b[2] > box[0] + 1.0:       # in line with the box
                if b[3] <= box[1] + 1.0:
                    below = max(below, b[3])
                elif b[1] >= box[3] - 1.0:
                    above = min(above, b[1])
        return (right - left - (box[2] - box[0]), above - below - (box[3] - box[1]))

    def _centred(self, box: Rect, blockers: List[Rect]) -> Rect:
        """Slide a box to the middle of the pocket of free floor it stands in, one axis at a time."""
        for axis in (0, 1):
            lo, hi = 0.0, (self.room.width, self.room.length)[axis]
            other = 1 - axis
            for b in blockers:
                if b[other] < box[other + 2] - 1.0 and b[other + 2] > box[other] + 1.0:
                    if b[axis + 2] <= box[axis] + 1.0:
                        lo = max(lo, b[axis + 2])
                    elif b[axis] >= box[axis + 2] - 1.0:
                        hi = min(hi, b[axis])
            size = box[axis + 2] - box[axis]
            start = round((lo + hi - size) / 2.0, 1)
            moved = list(box)
            moved[axis], moved[axis + 2] = start, start + size
            box = tuple(moved)
        return box

    def _seat(self, lay: Layout) -> Layout:
        """Add the dining table - the largest that fits clear of the working floor."""
        if not self.programme.dining:
            return lay
        for seats in self.programme.table_seats:
            dining = self._table_spot(lay, seats)
            if dining is None:
                continue
            length, width = TABLES[seats]
            items = list(lay.items)
            items.append(Item(
                "dining_table_1", "dining_table", "dining table", "{}-seat".format(seats), dining.table, "",
                "north", length, width, TABLE_HEIGHT, "open floor"))
            centre = ((dining.table[0] + dining.table[2]) / 2.0, (dining.table[1] + dining.table[3]) / 2.0)
            for number, chair in enumerate(dining.chairs, 1):
                if dining.along == "x":
                    facing = "south" if chair[1] >= centre[1] else "north"
                else:
                    facing = "west" if chair[0] >= centre[0] else "east"
                items.append(Item(
                    "dining_chair_{}".format(number), "dining_chair", "chair", "", chair, "", facing,
                    CHAIR_SIZE, self.c.chair_depth, CHAIR_HEIGHT, "at:table"))
            return replace(lay, dining=dining, items=tuple(items))
        smallest = self.programme.table_seats[-1]
        return replace(lay, unplaced=lay.unplaced + (Unplaced(
            "dining_table", "dining table for {}".format(SEAT_WORDS[smallest]), False,
            ("No floor is left for it clear of the units, the working aisles and the door.",)),))

    # ------------------------------------------------------------------ #
    # finishing: walking routes (rules 7 and 9) and the final score
    # ------------------------------------------------------------------ #
    def _targets(self, lay: Layout) -> List[Target]:
        """The places a person must be able to walk to from the entrance."""
        room, c = self.room, self.c
        targets = [
            Target("the {}".format(STATION_NAMES[s.kind]),
                   room.band(s.wall, s.t0, s.t1, c.aisle_min, offset=s.spec.depth))
            for s in lay.stations
        ]
        targets += [Target("door {}".format(d.id), d.keep_clear(room, c.door_entry_depth))
                    for d in self.doors if not d.is_main]
        if lay.dining is not None:
            targets.append(Target("the dining table", inflate(lay.dining.seated, 600.0)))
        return targets

    def _walk(self, lay: Layout) -> CirculationReport:
        if self.entry_zone is None:
            return CirculationReport(valid=True, checked=False)
        self.stats["paths_walked"] += 1
        return analyse(self.room.rect, self.entry_zone, self.entry_point, [i.rect for i in lay.items],
                       self._targets(lay), self.c.path_widths)

    def _openings(self, lay: Layout) -> List[Tuple[str, Rect]]:
        """Rule 7: the floor each cupboard, drawer and appliance door takes when it stands open."""
        room, c = self.room, self.c
        found = [("refrigerator door", self.ev.fridge_swing(lay)), ("oven door", self.ev.oven_door(lay))]
        for item in lay.items:
            if item.wall == "" or item.type in ("fridge", "stove") or item.role == "corner":
                continue
            lo, hi = room.along(item.wall, item.rect)
            count = max(1, int(math.ceil((hi - lo) / c.module_width - 1e-6)))
            name = {"sink": "cupboard under the sink", "utensil_drawers": "utensil drawers"}.get(
                item.type, "cupboard under the {}".format(item.role))
            for k in range(count):
                a, b = lo + (hi - lo) * k / count, lo + (hi - lo) * (k + 1) / count
                found.append((name, room.band(item.wall, a, b, c.opened_depth, offset=c.counter_depth)))
        return found

    def _opened(self, lay: Layout) -> Tuple[int, int, str]:
        """Open each one in turn: how many still leave a way through, and the first that does not."""
        if self.entry_zone is None:
            return (0, 0, "")
        obstacles = [i.rect for i in lay.items]
        targets = self._targets(lay)
        passable, blocker = 0, ""
        openings = self._openings(lay)
        for name, rect in openings:
            self.stats["paths_walked"] += 1
            if can_walk(self.room.rect, self.entry_zone, self.entry_point, obstacles + [rect], targets,
                        self.c.opened_passage):
                passable += 1
            elif not blocker:
                blocker = name
        return (passable, len(openings), blocker)

    def _finish(self, lay: Layout, facts: Facts) -> Optional[Result]:
        report = self._walk(lay)
        if report.checked and not report.valid:
            return None                # rule 9: a kitchen nobody can walk through is no kitchen
        open_side = open_square(self.room.rect, [i.rect for i in lay.items])
        rules = self.ev.finish(lay, facts, report, self._opened(lay), open_side)
        return Result(lay, facts, rules, self.ev.total(rules), report, self.ev.violations(lay, facts, report))

    # ------------------------------------------------------------------ #
    # choosing the alternatives
    # ------------------------------------------------------------------ #
    def _select(self, results: List[Result]) -> List[Result]:
        """The best kitchen of every shape first, then the next best on other walls."""
        def order(r: Result):
            valid, table, score = self._worth(r)
            return (not valid, not table, -score, KIND_ORDER.index(r.layout.arrangement.kind),
                    r.layout.arrangement.key)

        if any(r.valid for r in results):
            results = [r for r in results if r.valid]
        primary: Dict[str, Result] = {}
        for result in sorted(results, key=order):
            primary.setdefault(result.layout.arrangement.kind, result)
        chosen = sorted(primary.values(), key=order)[: self.s.max_layouts]
        for result in sorted(results, key=order):
            if len(chosen) >= self.s.max_layouts:
                break
            if not any(result is c for c in chosen):
                chosen.append(result)
        return sorted(chosen, key=order)

    # ------------------------------------------------------------------ #
    # serialisation - the shape the plan viewer already draws
    # ------------------------------------------------------------------ #
    def summary(self, lay: Layout) -> str:
        sink, stove, fridge = lay.sink, lay.stove, lay.fridge
        under = any(w.wall == sink.wall and min(sink.t1, w.end) - max(sink.t0, w.start) >= 0.5 * sink.spec.width
                    for w in self.windows)
        parts = [
            "{} on the {} wall{}".format(
                sink.spec.label.capitalize(), sink.wall, ", under the window" if under else ""),
            "{} on the {} wall".format(stove.spec.label, stove.wall),
            "{} {} the {} wall".format(
                fridge.spec.label, "at the end of the worktop on" if fridge.chain >= 0 else "on its own against",
                fridge.wall),
        ]
        if lay.dining is not None:
            parts.append("dining table for {}".format(SEAT_WORDS[lay.dining.seats]))
        return "; ".join(parts) + "."

    def _item_reasons(self, result: Result, item: Item) -> List[str]:
        rules, lay = result.rules, result.layout
        cite = lambda *ids: [
            "Rule {}: {}".format(rule_id[1:], rules[rule_id].detail)
            for rule_id in ids if rules[rule_id].applicable and rules[rule_id].detail
        ]
        size = "{} x {}".format(metres(item.width), metres(item.depth))
        if item.type == "sink":
            return ["{} ({}) against the {} wall.".format(
                lay.sink.spec.label.capitalize(), size, item.wall)] + cite("R1", "R2", "R4")
        if item.type == "stove":
            return ["{} ({}) against the {} wall.".format(
                lay.stove.spec.label.capitalize(), size, item.wall)] + cite("R3", "R5", "R4")
        if item.type == "fridge":
            return ["{} ({}, {} tall) against the {} wall.".format(
                lay.fridge.spec.label.capitalize(), size, metres(item.height), item.wall)] + cite("R6", "R4", "R12")
        if item.type == "utensil_drawers":
            return ["Drawer unit ({}) under the worktop.".format(size)] + cite("R8", "R7")
        if item.type == "dining_table":
            return ["Dining table for {} ({}).".format(SEAT_WORDS[lay.dining.seats], size)] + cite("R10")
        if item.type == "dining_chair":
            return ["Dining chair; {} is kept free behind it to push it back.".format(
                metres(self.c.chair_pullout))] + cite("R10")
        if item.role == "prep counter":
            return ["Preparation worktop ({}), with cupboards under it.".format(size)] + cite("R2", "R3", "R11")
        if item.role == "serving counter":
            return ["Worktop for cooked and ready-to-eat food ({}).".format(size)] + cite("R11", "R5")
        if item.role == "corner":
            return ["Corner of the worktop; the cupboard under it is reached from one side."]
        return ["Worktop ({}), with cupboards under it.".format(size)] + cite("R7")

    def to_dict(self, result: Result, ranking: List[Dict]) -> Dict:
        lay, room, c, report = result.layout, self.room, self.c, result.report
        arr = lay.arrangement
        rules = list(result.rules.values())
        # every rule keeps its default share of 100, even when another rule does not apply;
        # the total is then the points earned out of the points the applicable rules could give
        scale = 100.0 / (sum(r.weight for r in rules) or 1.0)
        checks = {v["check"] for v in result.violations}
        core = [result.rules[rule_id] for rule_id in CORE_RULES]

        explanation = [
            "{}. Appliances (rule 12): {}.".format(arr.title, self.programme.describe()),
        ]
        # each rule earns up to its weight, its share of the total
        explanation += [
            "Rule {} - {}: {} [{}]".format(
                r.rule.id[1:], r.rule.title, r.detail,
                "not applicable" if not r.applicable else "{:.1f} / {:.1f} points".format(
                    r.points * scale, r.weight * scale))
            for r in rules
        ]
        explanation += ["Not placed - {}: {}".format(u.label, " ".join(u.reasons)) for u in lay.unplaced]

        reason = [self.summary(lay), result.rules["R4"].detail, result.rules["R3"].detail]
        weakest = min((r for r in rules if r.applicable and r.rule.id not in ("R3", "R4")),
                      key=lambda r: r.score, default=None)
        if weakest is not None and weakest.score < 0.7:
            reason.append("Trade-off - {}: {}".format(weakest.rule.title.lower(), weakest.detail))
        else:
            reason.append(result.rules["R9"].detail)

        furniture = []
        for item in lay.items:
            entry = item.to_dict()
            entry["reasons"] = self._item_reasons(result, item)
            furniture.append(entry)

        legs = result.facts.legs
        return {
            "room": room.to_dict(),
            "layout": {
                "type": arr.key,
                "title": arr.title,
                "kind": arr.kind,
                "score": reported(result.score),
                "suitability_score": reported(
                    100.0 * sum(r.points for r in core) / (sum(r.weight for r in core) or 1.0)),
            },
            "furniture": furniture,
            "validation": {
                "valid": result.valid,
                "inside_room_boundary": "boundary" not in checks,
                "furniture_overlap": "overlap" in checks,
                "door_blocked": "door" in checks,
                "door_swing_blocked": "door" in checks,
                "window_blocked": "window" in checks,
                "circulation_valid": report.valid,
                "circulation": report.to_dict() if report.checked else None,
                "hard_constraint_violations": result.violations,
                "notes": [v["message"] for v in result.violations],
                "unplaced_required_furniture": [u.to_dict() for u in lay.unplaced if u.required],
            },
            "explanation": explanation,
            "selected_layout": arr.key,
            "reason": reason,
            "unplaced_furniture": [u.to_dict() for u in lay.unplaced],
            "scoring": {
                "total": reported(result.score),
                "max": 100,
                "components": {r.rule.key: round(r.points * scale, 1) for r in rules if r.applicable},
                "contributions": [
                    {"rule": r.rule.key, "points": round(r.points * scale, 2), "message": r.detail}
                    for r in rules if r.applicable
                ],
            },
            "rules": [
                {
                    "id": r.rule.id,
                    "key": r.rule.key,
                    "title": r.rule.title,
                    "rule": r.rule.text,
                    "method": r.rule.method,
                    "status": r.status,
                    "score": round(r.score, 3),
                    "points": round(r.points * scale, 1),
                    "max_points": round(r.weight * scale, 1) if r.applicable else 0.0,
                    "detail": r.detail,
                }
                for r in rules
            ],
            "work_triangle": {
                "points": [[round(p[0], 1), round(p[1], 1)] for p in self.ev.triangle(lay)],
                "legs_mm": {
                    "sink_stove": round(legs[0]), "sink_fridge": round(legs[1]), "stove_fridge": round(legs[2]),
                },
                "perimeter_mm": round(sum(legs)),
            },
            "layout_selection": {"ranking": ranking},
            "openings": {
                "doors": [d.to_dict(room, c.door_entry_depth) for d in self.doors],
                "windows": [w.to_dict(room, c.window_access_depth) for w in self.windows],
            },
            "programme": dict(self.programme.to_dict(), appliance_size=lay.size_class),
        }


def rule_catalogue() -> List[Dict]:
    """The twelve rules as written, and how the engine applies each one."""
    weights = Config().weights
    return [
        {"id": rule.id, "key": rule.key, "title": rule.title, "rule": rule.text, "method": rule.method,
         "weight": getattr(weights, rule.key)}
        for rule in RULES
    ]


def generate_kitchen_layouts(
    payload: Dict,
    default_mm_per_px: float = 20.0,
    margin_ratio: float = 0.08,
    margin_min: float = 10.0,
    margin_max: float = 60.0,
) -> Dict:
    """Request (room box + plan detections, in pixels) -> every kitchen layout, best first.

    Raises `floorplan.InputError` when the request cannot be made sense of.
    """
    config = Config.from_dict(payload.get("config"))
    if payload.get("max_layouts"):
        config.search.max_layouts = max(1, int(payload["max_layouts"]))
    shell = build_shell(payload, default_mm_per_px, margin_ratio, margin_min, margin_max)
    programme = select_programme(
        shell.room, config,
        dining=payload.get("dining_table"),
        seats=payload.get("seats"),
        appliance_size=payload.get("appliance_size"),
        required=payload.get("required_furniture"),
        optional=payload.get("optional_furniture"),
        excluded=payload.get("excluded_furniture"),
    )
    generator = Generator(shell, programme, config)
    results = generator.run()

    ranking = [
        {"layout": r.layout.arrangement.key, "title": r.layout.arrangement.title, "score": reported(r.score),
         "feasible": r.valid, "reasons": [generator.summary(r.layout)]}
        for r in results
    ]
    layouts = [generator.to_dict(r, ranking) for r in results]
    if not layouts:
        layouts = [{
            "layout": {"type": "kitchen", "title": "Kitchen layout", "score": 0, "suitability_score": 0},
            "error": "The room ({} x {}) has no stretch of wall that takes a sink, a preparation worktop and a "
                     "stove with the clearances the rules require.".format(
                         metres(shell.room.width), metres(shell.room.length)),
        }]

    return {
        "roomId": (payload.get("room") or {}).get("id"),
        "roomType": "kitchen",
        "scaleSource": shell.scale_source,
        "scaleMmPerPx": round(shell.scale_mm_per_px, 3),
        "doorsUsed": shell.doors_used,
        "windowsUsed": shell.windows_used,
        "notes": shell.notes + programme.notes,
        "diningTable": programme.dining,
        "diningTableSource": programme.dining_source,
        "programme": programme.to_dict(),
        "layouts": layouts,
        "bestLayout": results[0].layout.arrangement.key if results else None,
        "search": dict(generator.stats, elapsed_seconds=round(generator.elapsed, 3)),
    }
