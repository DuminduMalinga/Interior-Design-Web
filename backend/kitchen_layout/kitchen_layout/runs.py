"""
Counter runs and the four classic kitchen shapes.

A *run* is a straight line of base units against one wall. A *chain* is one
continuous worktop: a single run, or two or three runs joined at inside corners.
Every position along a chain has one coordinate `s`, measured from one free end,
so "what stands next to the sink" and "how much worktop lies between the sink
and the stove" are plain interval arithmetic even when the worktop turns a corner.

The shapes built here are the standard ones:

    one-wall   one run                      one chain
    L-shaped   two runs meeting at a corner  one chain
    U-shaped   three runs, two corners       one chain
    galley     two runs facing each other    two chains

A run never crosses a doorway or the floor a door needs to open, so the door
zones are cut out of each wall before any shape is tried.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

from .config import Clearances, RoomThresholds
from .geometry import Rect, intersects
from .room import OPPOSITE, WALL_ENDS, WALLS, Room

ADJACENT = (("north", "east"), ("east", "south"), ("south", "west"), ("west", "north"))
FACING = (("north", "south"), ("west", "east"))


@dataclass(frozen=True)
class Piece:
    """One straight part of a chain - a run, or the square where two runs meet."""

    wall: str
    t0: float            # the stretch of wall it covers
    t1: float
    s0: float            # chain coordinate of its first end
    forward: bool        # True when `s` grows with the wall position
    corner: bool = False

    @property
    def length(self) -> float:
        return self.t1 - self.t0

    @property
    def s1(self) -> float:
        return self.s0 + self.length

    def wall_span(self, sa: float, sb: float) -> Tuple[float, float]:
        """The stretch of wall that the chain interval [sa, sb] covers."""
        if self.forward:
            return (self.t0 + (sa - self.s0), self.t0 + (sb - self.s0))
        return (self.t1 - (sb - self.s0), self.t1 - (sa - self.s0))

    def s_at(self, ta: float, tb: float) -> float:
        """Chain coordinate at which the wall stretch [ta, tb] starts."""
        return self.s0 + (ta - self.t0 if self.forward else self.t1 - tb)


@dataclass(frozen=True)
class Chain:
    """One continuous worktop."""

    pieces: Tuple[Piece, ...]

    @property
    def length(self) -> float:
        return self.pieces[-1].s1

    def split(self, sa: float, sb: float) -> List[Tuple[Piece, float, float]]:
        """The parts of [sa, sb] that fall on each piece."""
        parts = []
        for piece in self.pieces:
            lo, hi = max(sa, piece.s0), min(sb, piece.s1)
            if hi - lo > 1.0:
                parts.append((piece, lo, hi))
        return parts

    def corner_gap(self, sa: float, sb: float) -> float:
        """Worktop between [sa, sb] and the nearest inside corner of the chain."""
        gap = float("inf")
        for piece in self.pieces:
            if piece.corner:
                gap = min(gap, max(piece.s0 - sb, sa - piece.s1, 0.0))
        return gap


@dataclass(frozen=True)
class Arrangement:
    """One kitchen shape on particular walls."""

    kind: str                      # "one_wall" | "l_shaped" | "u_shaped" | "galley"
    walls: Tuple[str, ...]
    chains: Tuple[Chain, ...]

    @property
    def key(self) -> str:
        return "{}_{}".format(self.kind, "_".join(self.walls))

    @property
    def title(self) -> str:
        if self.kind == "one_wall":
            return "One-wall kitchen on the {} wall".format(self.walls[0])
        if self.kind == "l_shaped":
            return "L-shaped kitchen on the {} and {} walls".format(*self.walls)
        if self.kind == "u_shaped":
            return "U-shaped kitchen, open to the {}".format(OPPOSITE[self.walls[1]])
        return "Galley kitchen on the {} and {} walls".format(*self.walls)

    def runs(self) -> List[Tuple[int, Piece]]:
        """Every straight run, with the index of the chain it belongs to."""
        return [(index, piece) for index, chain in enumerate(self.chains)
                for piece in chain.pieces if not piece.corner]

    def pieces(self) -> List[Piece]:
        return [piece for chain in self.chains for piece in chain.pieces]


def strip_gaps(room: Room, wall: str, depth: float, blockers: Sequence[Rect]) -> List[Tuple[float, float]]:
    """The stretches of `wall` where a strip `depth` deep is clear of every blocker."""
    length = room.wall_length(wall)
    strip = room.band(wall, 0.0, length, depth)
    cuts = sorted(room.along(wall, blocker) for blocker in blockers if intersects(strip, blocker))
    free, cursor = [], 0.0
    for lo, hi in cuts:
        if lo > cursor + 1.0:
            free.append((cursor, min(lo, length)))
        cursor = max(cursor, hi)
    if cursor < length - 1.0:
        free.append((cursor, length))
    return free


def _longest(intervals: List[Tuple[float, float]]) -> Optional[Tuple[float, float]]:
    return max(intervals, key=lambda i: (i[1] - i[0], -i[0])) if intervals else None


def _toward(wall: str, other: str) -> str:
    """Which end of `wall` ("lo" or "hi") meets the wall `other`."""
    return "lo" if WALL_ENDS[wall][0] == other else "hi"


def _touching(intervals: List[Tuple[float, float]], length: float, end: str) -> Optional[Tuple[float, float]]:
    """The free stretch that reaches the given end of the wall, if any."""
    for lo, hi in intervals:
        if (end == "lo" and lo <= 1.0) or (end == "hi" and hi >= length - 1.0):
            return (lo, hi)
    return None


def _leg(interval: Tuple[float, float], length: float, end: str, depth: float, max_leg: float,
         spare: float) -> Tuple[float, float]:
    """A run reaching the corner at `end`, less the corner square itself.

    It stops at `max_leg` - unless that would leave less than `spare` of bare
    wall beyond it, a gap too small to use, in which case it runs on to the end.
    """
    if end == "hi":
        t1 = length - depth
        t0 = t1 - max_leg
        return (interval[0] if t0 - interval[0] < spare else t0, t1)
    t0 = depth
    t1 = t0 + max_leg
    return (t0, interval[1] if interval[1] - t1 < spare else t1)


def build_arrangements(
    room: Room,
    door_zones: Sequence[Rect],
    clear: Clearances,
    limits: RoomThresholds,
) -> List[Arrangement]:
    """Every kitchen shape the room's walls and doors allow."""
    depth = clear.counter_depth
    length = {wall: room.wall_length(wall) for wall in WALLS}
    free: Dict[str, List[Tuple[float, float]]] = {
        wall: strip_gaps(room, wall, depth, door_zones) for wall in WALLS
    }
    found: List[Arrangement] = []

    def straight(wall: str) -> Optional[Tuple[float, float]]:
        best = _longest(free[wall])
        if best is None:
            return None
        lo, hi = best
        if hi - lo > limits.max_run:                    # keep the middle of a very long wall
            mid = (lo + hi) / 2.0
            lo, hi = mid - limits.max_run / 2.0, mid + limits.max_run / 2.0
        return (lo, hi)

    # one wall
    for wall in WALLS:
        span = straight(wall)
        if span and span[1] - span[0] >= 3 * clear.prep_min:
            found.append(Arrangement("one_wall", (wall,), (Chain((Piece(wall, span[0], span[1], 0.0, True),)),)))

    # L: two runs meeting at a corner
    for a, b in ADJACENT:
        end_a, end_b = _toward(a, b), _toward(b, a)
        span_a = _touching(free[a], length[a], end_a)
        span_b = _touching(free[b], length[b], end_b)
        if span_a is None or span_b is None:
            continue
        leg_a = _leg(span_a, length[a], end_a, depth, limits.max_leg, clear.aisle_min)
        leg_b = _leg(span_b, length[b], end_b, depth, limits.max_leg, clear.aisle_min)
        if min(leg_a[1] - leg_a[0], leg_b[1] - leg_b[0]) < limits.min_leg:
            continue
        first = Piece(a, leg_a[0], leg_a[1], 0.0, end_a == "hi")
        corner_t = (length[a] - depth, length[a]) if end_a == "hi" else (0.0, depth)
        corner = Piece(a, corner_t[0], corner_t[1], first.s1, True, corner=True)
        second = Piece(b, leg_b[0], leg_b[1], corner.s1, end_b == "lo")
        found.append(Arrangement("l_shaped", (a, b), (Chain((first, corner, second)),)))

    # U: a full middle run with a leg on each side
    for middle in WALLS:
        whole = _touching(free[middle], length[middle], "lo")
        if whole is None or whole[1] < length[middle] - 1.0:
            continue                                    # a door breaks the middle wall
        if length[middle] - 2 * depth < clear.aisle_min:
            continue                                    # the two legs would face each other too closely
        side_lo, side_hi = WALL_ENDS[middle]
        end_lo, end_hi = _toward(side_lo, middle), _toward(side_hi, middle)
        span_lo = _touching(free[side_lo], length[side_lo], end_lo)
        span_hi = _touching(free[side_hi], length[side_hi], end_hi)
        if span_lo is None or span_hi is None:
            continue
        leg_lo = _leg(span_lo, length[side_lo], end_lo, depth, limits.max_leg, clear.aisle_min)
        leg_hi = _leg(span_hi, length[side_hi], end_hi, depth, limits.max_leg, clear.aisle_min)
        if min(leg_lo[1] - leg_lo[0], leg_hi[1] - leg_hi[0]) < limits.min_leg:
            continue
        first = Piece(side_lo, leg_lo[0], leg_lo[1], 0.0, end_lo == "hi")
        corner_1 = Piece(middle, 0.0, depth, first.s1, True, corner=True)
        centre = Piece(middle, depth, length[middle] - depth, corner_1.s1, True)
        corner_2 = Piece(middle, length[middle] - depth, length[middle], centre.s1, True, corner=True)
        last = Piece(side_hi, leg_hi[0], leg_hi[1], corner_2.s1, end_hi == "lo")
        found.append(Arrangement(
            "u_shaped", (side_lo, middle, side_hi), (Chain((first, corner_1, centre, corner_2, last)),)))

    # galley: two runs facing each other across the aisle
    for a, b in FACING:
        if room.depth_from(a) - 2 * depth < clear.aisle_min:
            continue
        span_a, span_b = straight(a), straight(b)
        if span_a is None or span_b is None:
            continue
        if min(span_a[1] - span_a[0], span_b[1] - span_b[0]) < 2 * clear.prep_min:
            continue
        found.append(Arrangement("galley", (a, b), (
            Chain((Piece(a, span_a[0], span_a[1], 0.0, True),)),
            Chain((Piece(b, span_b[0], span_b[1], 0.0, True),)),
        )))
    return found
