"""
Fitting out - rules 8, 9, 10, 14 and 15.

Once the shower, the toilet and the basin stand, everything else follows from
them and is fixed rather than searched for:

* the mirror above the basin (rule 9);
* a towel rail on the free wall nearest the way out of the shower, and a towel
  ring nearest the basin (rule 8);
* the floor drain in the wall corner of the shower (rule 14);
* grab bars at the pan and in the shower, when the user needs them (rule 15).

None of these takes up floor. They are returned as thin strips against their
wall so the plan can show where they go.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from .fixtures import Fitout, Item, Layout
from .geometry import Rect, distance, hits_any
from .room import OPPOSITE, WALL_ENDS, WALLS
from .rules import Evaluator

#: how far the drawn strip of a wall fitting stands off its wall
MIRROR_DEPTH = 40.0
RAIL_DEPTH = 80.0
BAR_DEPTH = 60.0
DRAIN_SIZE = 150.0
#: floor that must be open in front of a towel for a hand to get to it
REACH_IN = 300.0

Spans = Dict[str, List[Tuple[float, float]]]


def free_wall(ev: Evaluator, lay: Layout, taken: Spans) -> Spans:
    """The stretches of each wall with nothing on them: no opening, no fixture, no fitting."""
    room = ev.room
    out: Spans = {}
    for wall in WALLS:
        length = room.wall_length(wall)
        blocked = [(o.start, o.end) for o in list(ev.doors) + list(ev.windows) if o.wall == wall]
        blocked += [room.along(wall, zone) for zone in ev.door_zones if room.out_from(wall, zone)[0] < 1.0]
        blocked += [room.along(wall, f.rect) for f in lay.fixtures if room.out_from(wall, f.rect)[0] < 1.0]
        blocked += taken.get(wall, [])
        spans, cursor = [], 0.0
        for lo, hi in sorted(blocked):
            if lo > cursor + 1.0:
                spans.append((cursor, lo))
            cursor = max(cursor, hi)
        if cursor < length - 1.0:
            spans.append((cursor, length))
        out[wall] = spans
    return out


def nearest_spot(ev: Evaluator, lay: Layout, free: Spans, length: float, target: Rect, depth: float,
                 ) -> Optional[Tuple[float, str, float, Rect]]:
    """The free piece of wall `length` long that is nearest `target`: (reach, wall, start, strip)."""
    room = ev.room
    footprints = [f.rect for f in lay.fixtures]
    best = None
    for wall in WALLS:
        t_lo, t_hi = room.along(wall, target)
        for lo, hi in free[wall]:
            if hi - lo < length - 1.0:
                continue
            ideal = min(max((t_lo + t_hi) / 2.0 - length / 2.0, lo), hi - length)
            for start in (ideal, lo, hi - length):
                if hits_any(room.band(wall, start, start + length, REACH_IN), footprints):
                    continue       # a fixture stands in front of it
                strip = room.band(wall, start, start + length, depth)
                rank = (round(distance(strip, target), 1), wall, round(start, 1))
                if best is None or rank < best[0]:
                    best = (rank, strip)
                break
    if best is None:
        return None
    (reach, wall, start), strip = best
    return (reach, wall, start, strip)


def fit_out(ev: Evaluator, lay: Layout) -> Fitout:
    """Fix the mirror, the towels, the drain and any grab bars to a finished arrangement."""
    room, c, a = ev.room, ev.c, ev.a
    items: List[Item] = []
    taken: Spans = {}

    def fitting(kind: str, name: str, rect: Rect, wall: str, length: float, depth: float, height: float,
                mount: float, strategy: str, mounted: str = "wall") -> None:
        count = sum(1 for i in items if i.type == kind) + 1
        items.append(Item("{}_{}".format(kind, count), kind, name, rect, wall, OPPOSITE[wall], length, depth,
                          height, strategy, mounted=mounted, mount_height=mount, label=name))

    # rule 9 - the mirror
    basin = lay.basin
    place, side = ev.mirror_place(lay)
    bottom = a.mirror_bottom if ev.accessible else c.mirror_bottom
    if place == "above":
        lo, hi = room.along(basin.wall, basin.rect)
        fitting("mirror", "mirror cabinet", room.band(basin.wall, lo, hi, MIRROR_DEPTH), basin.wall,
                hi - lo, MIRROR_DEPTH, c.mirror_top - bottom, bottom, "above:basin")
        taken.setdefault(basin.wall, []).append((lo, hi))
    elif place == "beside":
        side_wall = WALL_ENDS[basin.wall][0 if side == "lo" else 1]
        strip = ev.side_strip(basin.wall, side, 0.0, basin.depth, MIRROR_DEPTH)
        fitting("mirror", "mirror", strip, side_wall, basin.depth, MIRROR_DEPTH, c.mirror_top - bottom, bottom,
                "beside:basin")
        taken.setdefault(side_wall, []).append(room.along(side_wall, strip))

    # rule 8 - towels
    towel_height = a.towel_height if ev.accessible else c.towel_height
    rail_reach = None
    if lay.shower is not None:
        for length in (c.towel_rail, c.towel_rail_min):
            spot = nearest_spot(ev, lay, free_wall(ev, lay, taken), length, lay.shower_exit, RAIL_DEPTH)
            if spot is not None:
                rail_reach, wall, start, strip = spot
                fitting("towel_rail", "towel rail", strip, wall, length, RAIL_DEPTH, 60.0, towel_height,
                        "nearest:shower")
                taken.setdefault(wall, []).append((start, start + length))
                break
    ring_reach = None
    spot = nearest_spot(ev, lay, free_wall(ev, lay, taken), c.towel_ring, lay.basin_stand, RAIL_DEPTH)
    if spot is not None and spot[0] <= c.towel_reach_far:
        ring_reach, wall, start, strip = spot
        fitting("towel_ring", "towel ring", strip, wall, c.towel_ring, RAIL_DEPTH, 250.0, towel_height,
                "nearest:basin")
        taken.setdefault(wall, []).append((start, start + c.towel_ring))

    # rule 15 - grab bars
    bar_kind, shower_bar = "", False
    if ev.accessible:
        toilet = lay.toilet
        t_lo, t_hi = room.along(toilet.wall, toilet.rect)
        mid = (t_lo + t_hi) / 2.0
        bar_kind, bar_side = ev.toilet_bar(lay)
        drop_sides = ["lo", "hi"]
        if bar_kind == "wall":
            side_wall = WALL_ENDS[toilet.wall][0 if bar_side == "lo" else 1]
            strip = ev.side_strip(toilet.wall, bar_side, 200.0, 200.0 + a.bar_length, BAR_DEPTH)
            fitting("grab_bar", "grab bar", strip, side_wall, a.bar_length, BAR_DEPTH, 40.0, a.bar_height,
                    "beside:toilet")
            drop_sides = ["hi" if bar_side == "lo" else "lo"]
        for drop in drop_sides:
            at = mid + (-1.0 if drop == "lo" else 1.0) * (toilet.width / 2.0 + 120.0)
            fitting("grab_bar", "drop-down rail", room.band(toilet.wall, at - BAR_DEPTH / 2.0, at + BAR_DEPTH / 2.0,
                                                           toilet.depth),
                    toilet.wall, BAR_DEPTH, toilet.depth, 40.0, a.bar_height, "beside:toilet")
        if lay.shower is not None:
            walls = [w for w in lay.corner.split("-") if w != OPPOSITE[lay.entry_side]] or [OPPOSITE[lay.entry_side]]
            wall = walls[0]
            s_lo, s_hi = room.along(wall, lay.shower.rect)
            length = min(a.bar_length, s_hi - s_lo - 200.0)
            start = (s_lo + s_hi - length) / 2.0
            fitting("grab_bar", "grab bar", room.band(wall, start, start + length, BAR_DEPTH), wall,
                    length, BAR_DEPTH, 40.0, a.bar_height, "inside:shower")
            shower_bar = True

    # rule 14 - the drain
    drain, in_shower = ev.drain_point(lay)
    half = DRAIN_SIZE / 2.0
    wall = lay.shower.wall if lay.shower is not None else "south"
    fitting("floor_drain", "floor drain", (drain[0] - half, drain[1] - half, drain[0] + half, drain[1] + half),
            wall, DRAIN_SIZE, DRAIN_SIZE, 0.0, 0.0, "corner:shower" if in_shower else "corner:far", mounted="drain")

    return Fitout(
        mirror=place,
        towel_rail_reach=rail_reach,
        towel_ring_reach=ring_reach,
        roll_holder=ev.roll_holder(lay),
        toilet_bar=bar_kind,
        shower_bar=shower_bar,
        drain=drain,
        drain_in_shower=in_shower,
        items=tuple(items),
    )
