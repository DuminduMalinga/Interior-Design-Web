"""
Living-room layout generation.

The search is deterministic - no learning, no randomness - and every step can
be replayed:

    1. rules 5, 7 and 10 fix the furniture: its size class for the floor
       area, the pieces the daily activities need and the path width the
       occupants need (`programme.py`);
    2. the seating group - sofa, coffee table and armchairs, with the TV unit
       on the wall the sofa looks at - is tried at every position across the
       floor, looking each of the four ways, in every arrangement the number
       of armchairs allows (rules 1, 2 and 6 are built into the group).
       Positions that reach into a door's swing, cover a window or put the TV
       too close are discarded, and the rest are scored against the rules
       that depend on the group alone;
    3. the best positions of every kind are furnished: side tables at the
       sofa's ends, then a zone for each further activity - dining table,
       desk, reading corner - clear of the seating (rule 3), then the rug;
       and the room is walked from the entrance to every area (rules 9, 10);
    4. the best layout for each direction the sofa can look is returned,
       best first.

If the room cannot take the first-choice furniture, the search drops an
armchair, and then a size class (rule 5).
"""

from __future__ import annotations

import math
import re
import time
from dataclasses import dataclass, field, replace
from typing import Dict, Iterator, List, Optional, Tuple

from .circulation import CirculationReport, Target, analyse, can_walk
from .config import Config
from .floorplan import InputError, Shell, build_shell
from .furniture import (
    BOOKSHELF,
    DESK,
    DESK_CHAIR,
    DINING_CHAIR,
    DINING_TABLES,
    LAMP,
    READING_CHAIR,
    SIDE_TABLE,
    TIERS,
    Item,
    Layout,
    Spec,
    Tier,
    Unplaced,
    Zone,
)
from .geometry import Point, Rect, beyond, center, distance, hits_any, intersects, contains, point_gap
from .programme import Programme, select_programme
from .room import OPPOSITE, WALL_ENDS, WALLS
from .rules import RULE_BY_ID, RULES, Evaluator, RuleResult, metres

KITCHEN = re.compile(r"kitchen", re.I)
ARRANGEMENT_NAMES = {
    "u": "U-shaped seating", "l_low": "L-shaped seating", "l_high": "L-shaped seating",
    "facing": "Face-to-face seating", "solo": "Sofa",
}


def spread(lo: float, hi: float, step: float) -> List[float]:
    """Positions from `lo` to `hi`: a regular grid, both ends and the middle."""
    if hi < lo - 1.0:
        return []
    hi = max(hi, lo)
    found = {round(lo, 1), round(hi, 1), round((lo + hi) / 2.0, 1)}
    k = 1
    while lo + k * step < hi:
        found.add(round(lo + k * step, 1))
        k += 1
    return sorted(found)


@dataclass
class Result:
    """A finished, scored layout."""

    layout: Layout
    rules: Dict[str, RuleResult]
    score: float
    report: CirculationReport
    violations: List[Dict] = field(default_factory=list)
    type: str = ""
    title: str = ""

    @property
    def valid(self) -> bool:
        return not self.violations


class Generator:
    """Builds, scores and ranks living-room layouts for one room."""

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
        self.path = self.ev.path_min
        door = self.ev.main_door
        self.entry_zone = door.keep_clear(self.room, self.c.door_entry_depth) if door else None
        self.entry_point = door.center(self.room) if door else None
        #: the door the food comes through, when the plan names the room behind it
        self.kitchen: Optional[Point] = next(
            (d.center(self.room) for d in self.doors if d.leads_to and KITCHEN.search(d.leads_to)), None)
        self.step = max(self.s.step, max(self.room.width, self.room.length) / self.s.max_steps)
        self._tv_blocked: Dict[Tuple[str, str], List[Tuple[float, float]]] = {}
        self.stats = {"group_positions": 0, "positions_tried": 0, "layouts_scored": 0, "paths_walked": 0}
        self.elapsed = 0.0

    # ------------------------------------------------------------------ #
    def run(self) -> List[Result]:
        started = time.perf_counter()
        chosen: List[Result] = []
        for name in self.programme.tier_options:
            tier = TIERS[name]
            valid: List[Result] = []
            for chairs in range(min(self.programme.chairs, tier.max_chairs), -1, -1):
                results = self._search(tier, chairs)
                valid = [r for r in results if r.valid]
                if valid:
                    if chairs and len(valid) < self.s.max_layouts:
                        # few ways to stand the full group: offer the ones with an armchair fewer as well
                        valid += [r for r in self._search(tier, chairs - 1) if r.valid]
                    break
                if results and not chosen:
                    chosen = results
            if valid:
                chosen = valid
                break
        selected = self._select(chosen)
        self.elapsed = time.perf_counter() - started
        return selected

    # ------------------------------------------------------------------ #
    # the seating group (rules 1, 2, 4, 6 and the TV of rule 7)
    # ------------------------------------------------------------------ #
    def _legal(self, item: Item) -> bool:
        """Inside the room, out of every door's swing, and not covering a window."""
        if not contains(self.room.rect, item.rect) or hits_any(item.rect, self.ev.door_zones):
            return False
        return not any(self.ev.tall(item, w) and intersects(item.rect, band) for w, band in self.ev.window_bands)

    def _piece(self, spec: Spec, number: int, rect: Rect, wall: str, zone: str = "living",
               strategy: str = "") -> Item:
        return Item("{}_{}".format(spec.type, number), spec.type, rect, wall, OPPOSITE[wall],
                    spec.width, spec.depth, spec.height, zone, strategy, label=spec.label, seats=spec.seats)

    def _arrangements(self, chairs: int) -> List[str]:
        tv = self.programme.tv
        if chairs >= 2:
            return ["u"] if tv else ["facing", "u"]
        if chairs == 1:
            return ["l_low", "l_high"] if tv else ["facing", "l_low", "l_high"]
        return ["solo"]

    def _console_slot(self, tier: Tier, facing: str, cu: float, view: float) -> Optional[float]:
        """Where along the wall the sofa looks at the TV unit can stand, nearest straight ahead of the sofa."""
        room, spec = self.room, tier.console
        key = (tier.name, facing)
        if key not in self._tv_blocked:
            spans = []
            for zone in self.ev.door_zones + [band for _, band in self.ev.window_bands]:
                if room.out_from(facing, zone)[0] < spec.depth - 1.0:
                    lo, hi = room.along(facing, zone)
                    spans.append((lo - spec.width, hi))
            self._tv_blocked[key] = spans
        spans = self._tv_blocked[key]
        top = room.wall_length(facing) - spec.width
        if top < -1.0:
            return None
        top = max(top, 0.0)
        ahead = cu - spec.width / 2.0
        reach = math.tan(math.radians(self.c.tv_angle_max)) * view
        best = None
        for t in [ahead] + [lo for lo, _ in spans] + [hi for _, hi in spans]:
            t = min(max(t, 0.0), top)
            if abs(t - ahead) > reach or any(lo + 1.0 < t < hi - 1.0 for lo, hi in spans):
                continue
            if best is None or abs(t - ahead) < abs(best - ahead):
                best = t
        return best

    def _build(self, tier: Tier, facing: str, arrangement: str, chairs: int, cu: float, s: float) -> Optional[Layout]:
        """The seating group with the middle of the sofa `cu` along the wall behind it and `s` off that wall."""
        room, c = self.room, self.c
        back = OPPOSITE[facing]
        low, high = WALL_ENDS[back]
        depth = room.depth_from(back)
        sofa, coffee, chair = tier.sofa, tier.coffee, tier.chair
        g = c.table_gap
        v_table = s + sofa.depth + g

        pieces = [
            self._piece(sofa, 1, room.band(back, cu - sofa.width / 2, cu + sofa.width / 2, sofa.depth, s), back,
                        strategy="wall:{}".format(back) if s < 1.0 else "floor:free"),
            self._piece(coffee, 1, room.band(back, cu - coffee.width / 2, cu + coffee.width / 2, coffee.depth,
                                             v_table), back, strategy="front:sofa"),
        ]
        seats: List[Item] = []
        ends = {"u": ("low", "high"), "l_low": ("low",), "l_high": ("high",)}.get(arrangement, ())
        mid_v = v_table + coffee.depth / 2.0
        for end in ends:                       # an armchair at the end of the coffee table, turned to it
            if end == "low":
                u0, u1, looks = cu - coffee.width / 2 - g - chair.depth, cu - coffee.width / 2 - g, high
            else:
                u0, u1, looks = cu + coffee.width / 2 + g, cu + coffee.width / 2 + g + chair.depth, low
            seats.append(self._piece(chair, len(seats) + 1,
                                     room.band(back, u0, u1, chair.width, mid_v - chair.width / 2),
                                     OPPOSITE[looks], strategy="end:coffee_table"))
        if arrangement == "facing":            # armchairs across the coffee table, looking at the sofa
            for index in range(chairs):
                mid = cu + (index - (chairs - 1) / 2.0) * (chair.width + 150.0)
                seats.append(self._piece(chair, len(seats) + 1,
                                         room.band(back, mid - chair.width / 2, mid + chair.width / 2, chair.depth,
                                                   v_table + coffee.depth + g), facing, strategy="across:sofa"))
        pieces += seats

        console, view = None, 0.0
        if arrangement == "facing":
            # the far side is taken by the armchairs: people walk in at the end of the coffee table
            lo, hi = cu - coffee.width / 2, cu + coffee.width / 2
            wall_length = room.wall_length(back)
            if lo >= wall_length - hi:
                open_gap, entry = lo, room.band(back, lo - self.path, lo, coffee.depth, v_table)
            else:
                open_gap, entry = wall_length - hi, room.band(back, hi, hi + self.path, coffee.depth, v_table)
        else:
            limit = depth
            if self.programme.tv:
                limit = depth - tier.console.depth
                view = limit - (s + sofa.depth)
                if view < c.tv_min - 1.0:
                    return None
                t = self._console_slot(tier, facing, cu, view)
                if t is None:
                    return None
                console = self._piece(tier.console, 1, room.band(facing, t, t + tier.console.width,
                                                                 tier.console.depth), facing,
                                      strategy="wall:{}".format(facing))
                pieces.append(console)
            open_gap = limit - (v_table + coffee.depth)
            entry = room.band(back, cu - coffee.width / 2, cu + coffee.width / 2, self.path, v_table + coffee.depth)
        if open_gap < self.path - 1.0 or not all(self._legal(p) for p in pieces):
            return None

        missing = self.programme.chairs - len(seats)
        return Layout(
            tier=tier, facing=facing, arrangement=arrangement, offset=s,
            sofa=pieces[0], coffee=pieces[1], chairs=tuple(seats), entry=entry, open_gap=open_gap,
            console=console, view=view,
            unplaced=tuple(Unplaced("chair", chair.label, False,
                                    ("The seating group has no room for it clear of the doors and walls.",))
                           for _ in range(max(missing, 0))),
        )

    def _groups(self, tier: Tier, chairs: int) -> List[Layout]:
        """Every legal seating group, each with its score as far as the group decides it."""
        room, c = self.room, self.c
        sofa, coffee, chair = tier.sofa, tier.coffee, tier.chair
        found: List[Layout] = []
        for facing in WALLS:
            back = OPPOSITE[facing]
            length, depth = room.wall_length(back), room.depth_from(back)
            for arrangement in self._arrangements(chairs):
                group = sofa.depth + c.table_gap + coffee.depth
                if arrangement == "facing":
                    s_max = depth - group - c.table_gap - chair.depth
                elif self.programme.tv:
                    s_max = depth - tier.console.depth - max(sofa.depth + c.tv_min, group + self.path)
                else:
                    s_max = depth - group - self.path
                if s_max < -1.0:
                    continue
                # the sofa stands against the wall, or far enough off it to walk behind
                offsets = sorted({0.0} | set(spread(self.path, s_max, self.step)))
                arm = coffee.width / 2 + c.table_gap + chair.depth
                half = sofa.width / 2
                lo = max(half, arm) if arrangement in ("u", "l_low") else half
                hi = max(half, arm) if arrangement in ("u", "l_high") else half
                for cu in spread(lo, length - hi, self.step):
                    for s in offsets:
                        self.stats["group_positions"] += 1
                        lay = self._build(tier, facing, arrangement, chairs, cu, s)
                        if lay is not None:
                            found.append(replace(lay, base_score=self._ceiling(lay, openness=False)))
        return found

    def _ceiling(self, lay: Layout, openness: bool) -> float:
        """The best total a layout could still reach if everything decided later came out perfect."""
        self.stats["layouts_scored"] += 1
        results = self.ev.static(lay, openness=openness)
        for rule_id in ("R9", "R10"):
            results[rule_id] = RuleResult(RULE_BY_ID[rule_id], 1.0, self.ev.weights[rule_id])
        return self.ev.total(results)

    # ------------------------------------------------------------------ #
    # side tables (rule 6)
    # ------------------------------------------------------------------ #
    def _with_side_tables(self, lay: Layout) -> Layout:
        room, spec = self.room, SIDE_TABLE
        back = OPPOSITE[lay.facing]
        wanted = self.ev.planned_tier.side_tables
        s0, s1 = room.along(back, lay.sofa.rect)
        ends = [room.band(back, s0 - spec.width, s0, spec.depth, lay.offset),
                room.band(back, s1, s1 + spec.width, spec.depth, lay.offset)]
        if self.entry_point is not None:       # the end away from the entrance first
            ends.sort(key=lambda rect: -round(point_gap(self.entry_point, rect)))
        placed: List[Item] = []
        for rect in ends:
            if len(placed) >= wanted:
                break
            item = self._piece(spec, len(placed) + 1, rect, back, strategy="beside:sofa")
            if self._legal(item) and not hits_any(rect, [i.rect for i in lay.solids]):
                placed.append(item)
        missing = tuple(Unplaced("side_table", spec.label, False, ("Neither end of the sofa has room for it.",))
                        for _ in range(wanted - len(placed)))
        return replace(lay, extras=lay.extras + tuple(placed), unplaced=lay.unplaced + missing)

    # ------------------------------------------------------------------ #
    # the other zones (rules 3 and 7)
    # ------------------------------------------------------------------ #
    def _taken(self, lay: Layout) -> List[Rect]:
        """Floor nothing new may stand on: the furniture, and the room each zone needs to be used."""
        return [i.rect for i in lay.solids] + [z.use for z in lay.zones]

    def _slots(self, lay: Layout, width: float, depth: float, front: float) -> Iterator[Tuple[str, float, Rect, Rect]]:
        """Free places against a wall for a piece `width` x `depth` with `front` clear floor before it."""
        room = self.room
        taken = self._taken(lay)
        box = lay.group_box
        for wall in WALLS:
            if room.depth_from(wall) < depth + front:
                continue
            for t in spread(0.0, room.wall_length(wall) - width, self.step):
                self.stats["positions_tried"] += 1
                use = room.band(wall, t, t + width, depth + front)
                if hits_any(use, self.ev.door_zones) or hits_any(use, taken) or intersects(use, box):
                    continue
                yield wall, t, room.band(wall, t, t + width, depth), use

    def _window_gap(self, rect: Rect) -> float:
        if not self.windows:
            return 0.0
        return min(distance(rect, w.access(self.room, 0.0)) for w in self.windows)

    def _zone_rank(self, box: Rect, lay: Layout) -> Optional[int]:
        """Clear floor between a zone and the seating in 100 mm steps, capped at the preferred gap."""
        gap = distance(box, lay.group_box)
        if gap < self.c.zone_gap_min - 1.0:
            return None                # rule 3
        return -int(min(gap, self.c.zone_gap_preferred) // 100)

    def _first_passable(self, options: List[Tuple], limit: int = 8) -> Optional[Layout]:
        options.sort(key=lambda entry: entry[0])
        for entry in options[:limit]:
            if self._passable(entry[1]):
                return entry[1]
        return None

    def _with_dining(self, lay: Layout) -> Layout:
        """A dining table where the chairs can be pulled out, clear of the seating."""
        room, c = self.room, self.c
        taken = self._taken(lay)
        box = lay.group_box
        middle = center(box)
        step = max(self.step, 200.0)
        pull = c.chair_pull_min
        for spec in DINING_TABLES:
            if spec.seats > lay.tier.dining.seats:
                continue
            options: List[Tuple] = []
            for axis in ("ew", "ns"):
                lx, ly = (spec.length, spec.width) if axis == "ew" else (spec.width, spec.length)
                sides = ("north", "south") if axis == "ew" else ("east", "west")
                px, py = (0.0, pull) if axis == "ew" else (pull, 0.0)
                for x0 in spread(px, room.width - lx - px, step):
                    for y0 in spread(py, room.length - ly - py, step):
                        self.stats["positions_tried"] += 1
                        rect = (x0, y0, x0 + lx, y0 + ly)
                        use = (x0 - px, y0 - py, x0 + lx + px, y0 + ly + py)
                        if hits_any(use, self.ev.door_zones) or hits_any(use, taken) or intersects(use, box):
                            continue
                        tuck = c.chair_tuck
                        zone_box = (x0 - tuck * (px > 0), y0 - tuck * (py > 0),
                                    x0 + lx + tuck * (px > 0), y0 + ly + tuck * (py > 0))
                        rank = self._zone_rank(zone_box, lay)
                        if rank is None:
                            continue
                        table = Item("dining_table_1", "dining_table", rect, sides[1], sides[0], lx, ly,
                                     spec.height, "dining", "floor:free", label=spec.label)
                        if not self._legal(table):
                            continue
                        mid = center(rect)
                        near = round(math.hypot(mid[0] - self.kitchen[0], mid[1] - self.kitchen[1]) / 300.0) \
                            if self.kitchen else 0
                        away = -round(math.hypot(mid[0] - middle[0], mid[1] - middle[1]) / 300.0)
                        chairs = self._dining_chairs(spec, rect, sides)
                        zone = Zone("dining", zone_box, use, tuple(
                            ("the {} side of the dining table".format(side), beyond(rect, side, pull))
                            for side in sides))
                        options.append(((rank, near, away, axis, x0, y0), replace(
                            lay, extras=lay.extras + (table,), loose=lay.loose + chairs, zones=lay.zones + (zone,))))
            chosen = self._first_passable(options, limit=10)
            if chosen is not None:
                if spec.seats < self.ev.planned_tier.dining.seats:
                    chosen = replace(chosen, compromises=chosen.compromises + (
                        "The {} did not fit clear of the seating; a {} was used.".format(
                            self.ev.planned_tier.dining.label, spec.label),))
                return chosen
        return replace(lay, unplaced=lay.unplaced + (Unplaced(
            "dining_table", lay.tier.dining.label, False,
            ("No part of the floor takes a table with {} behind its chairs and {} to the seating.".format(
                metres(pull), metres(c.zone_gap_min)),)),))

    def _dining_chairs(self, spec, rect: Rect, sides: Tuple[str, str]) -> Tuple[Item, ...]:
        """One pushed-in chair per seat along both long sides of the table."""
        chairs: List[Item] = []
        for side in sides:
            along_x = side in ("north", "south")
            lo, hi = (rect[0], rect[2]) if along_x else (rect[1], rect[3])
            for index in range(spec.per_side):
                mid = lo + (hi - lo) * (index + 0.5) / spec.per_side
                half = DINING_CHAIR.width / 2.0
                seat = (mid - half, rect[1], mid + half, rect[3]) if along_x else (rect[0], mid - half, rect[2], mid + half)
                chairs.append(Item(
                    "dining_chair_{}".format(len(chairs) + 1), "dining_chair", beyond(seat, side, self.c.chair_tuck),
                    side, OPPOSITE[side], DINING_CHAIR.width, DINING_CHAIR.depth, DINING_CHAIR.height,
                    "dining", "at:dining_table", label=DINING_CHAIR.label, seats=1))
        return tuple(chairs)

    def _with_work(self, lay: Layout) -> Layout:
        """A desk against a wall, by a window when one is free, with room to push the chair back."""
        room, c = self.room, self.c
        options: List[Tuple] = []
        for wall, t, rect, use in self._slots(lay, DESK.width, DESK.depth, c.desk_chair_space):
            desk = self._piece(DESK, 1, rect, wall, "work", "wall:{}".format(wall))
            zone_box = room.band(wall, t, t + DESK.width, DESK.depth + c.chair_tuck)
            rank = self._zone_rank(zone_box, lay)
            if rank is None or not self._legal(desk):
                continue
            mid = t + DESK.width / 2.0
            chair = Item("desk_chair_1", "desk_chair",
                         room.band(wall, mid - DESK_CHAIR.width / 2, mid + DESK_CHAIR.width / 2, c.chair_tuck,
                                   DESK.depth),
                         OPPOSITE[wall], wall, DESK_CHAIR.width, DESK_CHAIR.depth, DESK_CHAIR.height,
                         "work", "at:desk", label=DESK_CHAIR.label, seats=1)
            zone = Zone("work", zone_box, use,
                        (("the desk", room.band(wall, t, t + DESK.width, c.desk_chair_space, DESK.depth)),))
            options.append(((round(self._window_gap(rect) / 300.0), rank, WALLS.index(wall), t), replace(
                lay, extras=lay.extras + (desk,), loose=lay.loose + (chair,), zones=lay.zones + (zone,))))
        chosen = self._first_passable(options)
        if chosen is not None:
            return chosen
        return replace(lay, unplaced=lay.unplaced + (Unplaced(
            "desk", DESK.label, False,
            ("No wall has {} free for it with {} to push the chair back, clear of the seating.".format(
                metres(DESK.width), metres(c.desk_chair_space)),)),))

    def _with_reading(self, lay: Layout) -> Layout:
        """A reading chair with its lamp, by a window when one is free; a bookshelf near it in a larger room."""
        room, c = self.room, self.c
        chair, lamp = READING_CHAIR, LAMP
        options: List[Tuple] = []
        for wall, t, rect, use in self._slots(lay, chair.width + lamp.width, chair.depth, c.armchair_front):
            rank = self._zone_rank(rect, lay)
            if rank is None:
                continue
            for lamp_first in (False, True):
                c0 = t + (lamp.width if lamp_first else 0.0)
                l0 = t if lamp_first else t + chair.width
                seat = self._piece(chair, 1, room.band(wall, c0, c0 + chair.width, chair.depth), wall,
                                   "reading", "wall:{}".format(wall))
                light = self._piece(lamp, 1, room.band(wall, l0, l0 + lamp.width, lamp.depth), wall,
                                    "reading", "beside:reading_chair")
                if not (self._legal(seat) and self._legal(light)):
                    continue
                zone = Zone("reading", rect, use, (
                    ("the reading chair", room.band(wall, c0, c0 + chair.width, c.armchair_front, chair.depth)),))
                options.append((
                    (round(self._window_gap(seat.rect) / 300.0), rank, WALLS.index(wall), t, lamp_first),
                    replace(lay, extras=lay.extras + (seat, light), zones=lay.zones + (zone,))))
        chosen = self._first_passable(options)
        if chosen is None:
            return replace(lay, unplaced=lay.unplaced + (Unplaced(
                "reading_chair", chair.label, False,
                ("No wall has {} free for the chair and its lamp, clear of the seating.".format(
                    metres(chair.width + lamp.width)),)),))
        if lay.tier.name == "compact":
            return chosen
        seat = chosen.find("reading_chair")[0]
        shelves: List[Tuple] = []
        for wall, t, rect, _ in self._slots(chosen, BOOKSHELF.width, BOOKSHELF.depth, c.armchair_front):
            shelf = self._piece(BOOKSHELF, 1, rect, wall, "reading", "wall:{}".format(wall))
            if self._legal(shelf):
                shelves.append(((round(distance(rect, seat.rect) / 100.0), WALLS.index(wall), t),
                                replace(chosen, extras=chosen.extras + (shelf,))))
        return self._first_passable(shelves, limit=4) or chosen

    # ------------------------------------------------------------------ #
    # the rug and the screen
    # ------------------------------------------------------------------ #
    def _with_rug(self, lay: Layout) -> Layout:
        """Rule 3: a rug under the front of the sofa and the coffee table marks the living zone."""
        if self.programme.accessible:
            return lay                 # rule 10: no loose rug to catch a foot, a frame or a wheel
        room, c = self.room, self.c
        back = OPPOSITE[lay.facing]
        s0, s1 = room.along(back, lay.sofa.rect)
        start = room.out_from(back, lay.sofa.rect)[1] - 250.0
        end = room.out_from(back, lay.coffee.rect)[1] + (c.table_gap + 250.0 if lay.arrangement == "facing" else 350.0)
        raw = room.band(back, s0, s1, end - start, start)
        rect = (max(raw[0], 0.0), max(raw[1], 0.0), min(raw[2], room.width), min(raw[3], room.length))
        others = [i.rect for i in lay.extras if i.zone != "living"] + [z.use for z in lay.zones]
        if hits_any(rect, self.ev.door_zones) or hits_any(rect, others):
            return lay
        rug = Item("rug_1", "rug", rect, back, lay.facing, s1 - s0, end - start, 10.0, "living", "under:seating",
                   label="rug")
        return replace(lay, loose=(rug,) + lay.loose)

    def _with_tv(self, lay: Layout) -> Layout:
        if lay.console is None:
            return lay
        room, wall = self.room, lay.console.wall
        c0, c1 = room.along(wall, lay.console.rect)
        width = lay.tier.tv_width
        mid = (c0 + c1) / 2.0
        screen = Item("tv_1", "tv", room.band(wall, mid - width / 2, mid + width / 2, 80.0), wall, OPPOSITE[wall],
                      width, 80.0, round(width * 0.56), "living", "above:tv_console", mounted="wall",
                      mount_height=self.c.tv_centre_height, label="television")
        return replace(lay, loose=lay.loose + (screen,))

    # ------------------------------------------------------------------ #
    # walking the room (rules 9 and 10)
    # ------------------------------------------------------------------ #
    def _targets(self, lay: Layout) -> List[Target]:
        """The seating, every other zone and every other door must be reachable from the entrance."""
        out = [Target("the seating", lay.entry)]
        out += [Target(name, rect) for zone in lay.zones for name, rect in zone.targets]
        out += [Target("door {}".format(d.id), d.keep_clear(self.room, self.c.door_entry_depth))
                for d in self.doors if not d.is_main]
        return out

    def _passable(self, lay: Layout) -> bool:
        if self.entry_zone is None:
            return True
        self.stats["paths_walked"] += 1
        return can_walk(self.room.rect, self.entry_zone, self.entry_point, [i.rect for i in lay.solids],
                        self._targets(lay), self.path)

    def _walk(self, lay: Layout) -> CirculationReport:
        if self.entry_zone is None:
            return CirculationReport(valid=True, checked=False)
        self.stats["paths_walked"] += 1
        targets = self._targets(lay)
        targets += [Target("window {}".format(w.id), band, essential=False) for w, band in self.ev.window_bands]
        return analyse(self.room.rect, self.entry_zone, self.entry_point, [i.rect for i in lay.solids], targets,
                       self.ev.path_widths)

    def _finish(self, lay: Layout) -> Result:
        ev = self.ev
        lay = self._with_side_tables(lay)
        for kind in self.programme.zones:
            lay = getattr(self, "_with_" + kind)(lay)
        lay = self._with_tv(self._with_rug(lay))
        report = self._walk(lay)
        rules = ev.static(lay, explain=True, final=True)
        rules["R9"] = ev.movement_result(lay, report)
        rules["R10"] = ev.access_result(lay, report)
        ordered = {rule.id: rules[rule.id] for rule in RULES}
        return Result(lay, ordered, ev.total(ordered), report, ev.violations(lay, report))

    def _search(self, tier: Tier, chairs: int) -> List[Result]:
        """The best finished layout for every (direction, arrangement, sofa on the wall or off it)."""
        variants: Dict[Tuple[str, str, str], List[Layout]] = {}
        for lay in self._groups(tier, chairs):
            variants.setdefault((lay.facing, lay.arrangement, lay.anchor), []).append(lay)

        rank = lambda entry: (-entry[1].base_score, entry[0])
        results: List[Result] = []
        for key in sorted(variants):
            short = sorted(enumerate(variants[key]), key=rank)[: self.s.shortlist]
            scored = [replace(lay, base_score=self._ceiling(lay, openness=True)) for _, lay in short]
            best: Optional[Result] = None
            for _, lay in sorted(enumerate(scored), key=rank)[: self.s.finalists]:
                if best is not None and best.valid and lay.base_score <= best.score + 1e-9:
                    break              # nothing left in this variant can beat what is already scored
                result = self._finish(lay)
                if best is None or (result.valid, result.score) > (best.valid, best.score):
                    best = result
            if best is not None:
                results.append(best)
        return results

    # ------------------------------------------------------------------ #
    # choosing and naming the alternatives
    # ------------------------------------------------------------------ #
    def _select(self, results: List[Result]) -> List[Result]:
        # equal marks: the sofa against the wall comes first
        order = lambda r: (not r.valid, -round(r.score, 1), r.layout.offset, r.layout.facing, r.layout.arrangement)
        primary: Dict[str, Result] = {}
        for result in sorted(results, key=order):
            primary.setdefault(result.layout.facing, result)
        chosen = sorted(primary.values(), key=order)[: self.s.max_layouts]
        for result in sorted(results, key=order):     # other arrangements fill the slots left over
            if len(chosen) >= self.s.max_layouts:
                break
            if not any(result is c for c in chosen):
                chosen.append(result)
        chosen.sort(key=order)

        for result in chosen:
            lay = result.layout
            result.type = "{}_{}_{}".format(lay.arrangement, lay.facing, lay.anchor)
            title = ARRANGEMENT_NAMES[lay.arrangement]
            title += " facing the TV on the {} wall".format(lay.facing) if lay.console is not None \
                else ", sofa looking {}".format(lay.facing)
            if lay.arrangement in ("l_low", "l_high"):
                title += ", armchair on the {} side".format(lay.chairs[0].wall)
            twins = [r for r in chosen if (r.layout.facing, r.layout.arrangement) == (lay.facing, lay.arrangement)]
            if len(twins) > 1:
                title += ", sofa against the wall" if lay.anchor == "wall" else ", sofa out in the room"
            result.title = title
        return chosen

    # ------------------------------------------------------------------ #
    # serialisation - the shape the plan viewer already draws
    # ------------------------------------------------------------------ #
    def summary(self, lay: Layout) -> str:
        text = "{} {}".format(
            lay.sofa.label, "against the {} wall".format(OPPOSITE[lay.facing]) if lay.anchor == "wall"
            else "{} off the {} wall".format(metres(lay.offset), OPPOSITE[lay.facing]))
        if lay.chairs:
            text += " with {} armchair{} {}".format(
                len(lay.chairs), "" if len(lay.chairs) == 1 else "s",
                "across the coffee table" if lay.arrangement == "facing" else "at the end of the coffee table"
                if len(lay.chairs) == 1 else "at the ends of the coffee table")
        if lay.console is not None:
            text += ", looking at the TV on the {} wall".format(lay.facing)
        extra = [name for kind, name in (("dining", "a dining table"), ("work", "a desk"), ("reading", "a reading corner"))
                 if lay.zone(kind) is not None]
        if extra:
            text += "; " + " and ".join(extra) + " in {} own zone{}".format(
                "its" if len(extra) == 1 else "their", "" if len(extra) == 1 else "s")
        return text[0].upper() + text[1:] + "."

    def _item_reasons(self, result: Result, item: Item) -> List[str]:
        rules = result.rules
        cite = lambda *ids: [
            "Rule {}: {}".format(rule_id[1:], rules[rule_id].detail)
            for rule_id in ids if rules[rule_id].applicable and rules[rule_id].detail
        ]
        name = (item.label or item.type.replace("_", " "))
        name = name[0].upper() + name[1:]
        size = "{} x {}".format(metres(item.width), metres(item.depth))
        kind = item.type
        if kind in ("sofa", "loveseat"):
            return ["{} ({}), looking {}.".format(name, size, item.facing)] + cite("R1", "R2", "R5")
        if kind == "chair":
            return ["{} ({}) turned to the coffee table.".format(name, size)] + cite("R1", "R2")
        if kind == "coffee_table":
            return ["{} ({}) in front of the sofa.".format(name, size)] + cite("R6")
        if kind == "side_table":
            return ["{} at the end of the sofa.".format(name)] + cite("R6")
        if kind == "tv_console":
            return ["{} ({}) against the {} wall.".format(name, size, item.wall)] + cite("R7", "R4")
        if kind == "tv":
            return ["Television on the {} wall, centred {} above the floor.".format(
                item.wall, metres(item.mount_height))] + cite("R7")
        if kind == "rug":
            return ["Rug under the front of the sofa and the coffee table: it marks the living zone."] + cite("R3")
        if kind == "dining_chair":
            return ["Dining chair on the {} side of the table, drawn pushed in.".format(item.wall)] + cite("R7")
        if kind == "desk_chair":
            return ["Desk chair, drawn pushed in."] + cite("R7")
        return ["{} ({}).".format(name, size)] + cite("R3", "R7")

    def to_dict(self, result: Result, ranking: List[Dict]) -> Dict:
        lay, room, c, report = result.layout, self.room, self.c, result.report
        rules = list(result.rules.values())
        applicable = sum(r.weight for r in rules if r.applicable) or 1.0
        scale = 100.0 / applicable           # so the per-rule points add up to the 0-100 total
        checks = {v["check"] for v in result.violations}

        explanation = ["Furniture (rules 5 and 7): {}.".format(self.summary(lay)[:-1])]
        explanation += [
            "Rule {} - {}: {} [{}]".format(
                r.rule.id[1:], r.rule.title, r.detail,
                "not applicable" if not r.applicable else "{:.1f} of {:.1f} points".format(
                    r.points * scale, r.weight * scale))
            for r in rules
        ]
        explanation += list(lay.compromises)
        explanation += ["Not placed - {}: {}".format(u.label, " ".join(u.reasons)) for u in lay.unplaced]

        lead = ("R1", "R9")
        reason = [self.summary(lay)]
        reason += [result.rules[rule_id].detail for rule_id in lead if result.rules[rule_id].applicable]
        weakest = min((r for r in rules if r.applicable and r.rule.id not in lead),
                      key=lambda r: r.score, default=None)
        if weakest is not None and weakest.score < 0.7:
            reason.append("Trade-off - {}: {}".format(weakest.rule.title.lower(), weakest.detail))

        furniture = []
        for item in lay.items:
            entry = item.to_dict()
            entry["reasons"] = self._item_reasons(result, item)
            furniture.append(entry)

        return {
            "room": room.to_dict(),
            "layout": {
                "type": result.type,
                "title": result.title,
                "score": round(result.score, 1),
                "suitability_score": round(lay.base_score, 1),
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
                "notes": [v["message"] for v in result.violations] + list(lay.compromises),
                "unplaced_required_furniture": [u.to_dict() for u in lay.unplaced if u.required],
            },
            "explanation": explanation,
            "selected_layout": result.type,
            "reason": reason,
            "unplaced_furniture": [u.to_dict() for u in lay.unplaced],
            "scoring": {
                "total": round(result.score, 1),
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
                    "status": r.status,
                    "score": round(r.score, 3),
                    "points": round(r.points * scale, 1),
                    "max_points": round(r.weight * scale, 1) if r.applicable else 0.0,
                    "detail": r.detail,
                }
                for r in rules
            ],
            "layout_selection": {"ranking": ranking},
            "openings": {
                "doors": [d.to_dict(room, c.door_entry_depth) for d in self.doors],
                "windows": [w.to_dict(room, c.window_access_depth) for w in self.windows],
            },
            "seating": {
                "arrangement": lay.arrangement,
                "sofa_faces": lay.facing,
                "sofa_off_wall_mm": round(lay.offset, 1),
                "seats": sum(s.seats for s in lay.seats),
                "size_tier": lay.tier.name,
                "open_side_mm": round(lay.open_gap, 1),
                "tv_wall": lay.console.wall if lay.console is not None else None,
                "viewing_distance_mm": round(lay.view, 1) if lay.console is not None else None,
                "viewing_angle_deg": round(self.ev.tv_angle(lay), 1) if lay.console is not None else None,
            },
            "zones": [{"kind": "living", "bbox": [round(v, 1) for v in lay.group_box]}]
            + [{"kind": z.kind, "bbox": [round(v, 1) for v in z.box]} for z in lay.zones],
            "programme": self.programme.to_dict(),
        }


def rule_catalogue() -> List[Dict]:
    """The ten rules as written, and how the engine applies each one."""
    weights = Config().weights
    return [
        {"id": rule.id, "key": rule.key, "title": rule.title, "rule": rule.text, "method": rule.method,
         "weight": getattr(weights, rule.key)}
        for rule in RULES
    ]


def generate_living_room_layouts(
    payload: Dict,
    default_mm_per_px: float = 20.0,
    margin_ratio: float = 0.08,
    margin_min: float = 10.0,
    margin_max: float = 60.0,
) -> Dict:
    """Request (room box + plan detections, in pixels) -> every living-room layout, best first.

    Raises `floorplan.InputError` when the request cannot be made sense of.
    """
    if not isinstance(payload, dict):
        raise InputError("the request must be a JSON object")
    config = Config.from_dict(payload.get("config"))
    if payload.get("max_layouts"):
        config.search.max_layouts = max(1, int(payload["max_layouts"]))
    shell = build_shell(payload, default_mm_per_px, margin_ratio, margin_min, margin_max)
    programme = select_programme(
        shell.room, config,
        activities=payload.get("activities"),
        occupants=payload.get("occupants"),
        accessible=payload.get("accessible"),
    )
    generator = Generator(shell, programme, config)
    results = generator.run()

    notes = shell.notes + programme.notes
    if results:
        best = results[0].layout
        if best.tier.name != programme.tier:
            notes.append("The {} furniture does not fit this room with the doors clear and a {} way in; the {} "
                         "furniture was used instead.".format(programme.tier, metres(generator.path), best.tier.name))
        if len(best.chairs) < programme.chairs:
            full = any(len(r.layout.chairs) >= programme.chairs for r in results)
            notes.append("The best arrangement uses {} of the {} armchairs planned{}.".format(
                len(best.chairs), programme.chairs,
                "; the ones with every armchair are listed after it" if full else ", which is all the room takes"))
        if not results[0].valid:
            notes.append("No arrangement keeps every hard limit in this room; the nearest ones are shown, each "
                         "with what it breaks.")

    ranking = [
        {"layout": r.type, "title": r.title, "score": round(r.score, 1), "feasible": r.valid,
         "reasons": [generator.summary(r.layout)]}
        for r in results
    ]
    layouts = [generator.to_dict(r, ranking) for r in results]
    if not layouts:
        smallest = TIERS[programme.tier_options[-1]]
        layouts = [{
            "layout": {"type": "living_room", "title": "Living room layout", "score": 0, "suitability_score": 0},
            "error": "The room ({} x {}) is too small for a {} and a coffee table with the doors left clear and "
                     "a {} way in to sit down.".format(metres(shell.room.width), metres(shell.room.length),
                                                      smallest.sofa.label, metres(generator.path)),
        }]

    return {
        "roomId": (payload.get("room") or {}).get("id"),
        "roomType": "living_room",
        "scaleSource": shell.scale_source,
        "scaleMmPerPx": round(shell.scale_mm_per_px, 3),
        "doorsUsed": shell.doors_used,
        "windowsUsed": shell.windows_used,
        "notes": notes,
        "activities": list(programme.activities),
        "activitiesSource": programme.activities_source,
        "accessible": programme.accessible,
        "accessibleSource": programme.accessible_source,
        "programme": programme.to_dict(),
        "layouts": layouts,
        "bestLayout": results[0].type if results and results[0].valid else None,
        "search": dict(generator.stats, elapsed_seconds=round(generator.elapsed, 3)),
    }
