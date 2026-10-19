"""
Walkability - rules 8 and 9.

"Can a person get from the door to the sink, the stove and the fridge?" is answered
exactly, not on a pixel grid. A walker is a square `width` across. The places
its centre may be are the room pulled in by half the width, minus every piece of
furniture grown by half the width. Because everything stands square to the
walls, that region is made of rectangles: cutting the floor along every grown
edge gives a small irregular grid (a few hundred cells at most) in which each
cell is entirely standable or entirely blocked, and a flood fill over those
cells says what can be reached from the entrance.

Two widths matter:

* at the narrowest (600 mm) a person must be able to stand *inside* every
  essential place - in front of the sink, the stove, the refrigerator. That decides
  whether a layout is valid at all;
* at the wider ones (750, 900 mm) a walker only has to come right up to those
  places. That grades the route.
"""

from __future__ import annotations

from bisect import bisect_left, bisect_right
from dataclasses import dataclass, field
from typing import List, Optional, Sequence, Tuple

from .geometry import Point, Rect, inflate

#: a gap exactly as wide as the walker still lets them through
SLACK = 1.0
#: how close a wide walker must come to a place for it to count as reached
NEAR = 50.0


@dataclass(frozen=True)
class Target:
    """Somewhere the walking path has to arrive at."""

    name: str
    zone: Rect
    essential: bool = True


@dataclass
class CirculationReport:
    """Result of the walkability analysis of one layout."""

    valid: bool
    width: float = 0.0                 # widest path that still links every essential target
    reached_ratio: float = 0.0         # share of the standable floor reachable from the entrance
    unreachable: List[str] = field(default_factory=list)   # essential places with no way in
    cut_off: List[str] = field(default_factory=list)       # other places (windows) with no way in
    notes: List[str] = field(default_factory=list)
    chair_clear: Optional[bool] = None  # rule 9: the route survives the desk chair being pulled out
    checked: bool = True               # False when the room has no door to start from
    pinch: Optional[Tuple[float, List[str]]] = None   # (width, places) a wider path could not reach

    def to_dict(self):
        return {
            "valid": self.valid,
            "corridor_width_mm": round(self.width, 1),
            "walkable_reached_ratio": round(self.reached_ratio, 3),
            "unreachable_targets": list(self.unreachable),
            "cut_off": list(self.cut_off),
            "wider_path_stops_at": {"width_mm": self.pinch[0], "places": self.pinch[1]} if self.pinch else None,
            "chair_pulled_out_clear": self.chair_clear,
            "notes": list(self.notes),
        }


class FloorMap:
    """Every spot the centre of a walker of one width can be, as a grid of exact rectangles."""

    def __init__(self, bounds: Rect, obstacles: Sequence[Rect], width: float):
        # the parts of a non-rectangular room's box that are not floor block like furniture
        obstacles = list(obstacles) + list(getattr(bounds, "holes", ()))
        reach = max(width / 2.0 - SLACK, 0.0)
        x0, y0, x1, y1 = bounds[0] + reach, bounds[1] + reach, bounds[2] - reach, bounds[3] - reach
        self.xs: List[float] = []
        self.ys: List[float] = []
        self.nx = self.ny = 0
        self.free = bytearray()
        if x1 <= x0 or y1 <= y0:
            return                     # the room is narrower than the walker

        grown = []
        xs, ys = {x0, x1}, {y0, y1}
        for o in obstacles:
            g = (max(o[0] - reach, x0), max(o[1] - reach, y0), min(o[2] + reach, x1), min(o[3] + reach, y1))
            if g[2] > g[0] and g[3] > g[1]:
                grown.append(g)
                xs.update((g[0], g[2]))
                ys.update((g[1], g[3]))
        self.xs, self.ys = sorted(xs), sorted(ys)
        self.nx, self.ny = len(self.xs) - 1, len(self.ys) - 1
        self.free = bytearray(b"\x01") * (self.nx * self.ny)
        for g in grown:
            ix0, ix1 = bisect_left(self.xs, g[0]), bisect_left(self.xs, g[2])
            run = bytes(ix1 - ix0)
            for iy in range(bisect_left(self.ys, g[1]), bisect_left(self.ys, g[3])):
                self.free[iy * self.nx + ix0: iy * self.nx + ix1] = run

    @staticmethod
    def _span(coords: List[float], lo: float, hi: float) -> range:
        """The cells between `coords` that overlap the open interval (lo, hi)."""
        return range(max(bisect_right(coords, lo) - 1, 0), min(bisect_left(coords, hi), len(coords) - 1))

    def cells(self, r: Rect) -> List[int]:
        """Indices of the cells that share floor with `r`."""
        if not self.nx:
            return []
        columns = self._span(self.xs, r[0], r[2])
        return [iy * self.nx + ix for iy in self._span(self.ys, r[1], r[3]) for ix in columns]

    def rect(self, index: int) -> Rect:
        iy, ix = divmod(index, self.nx)
        return (self.xs[ix], self.ys[iy], self.xs[ix + 1], self.ys[iy + 1])

    def area(self, mask: bytearray) -> float:
        total = 0.0
        for iy in range(self.ny):
            height = self.ys[iy + 1] - self.ys[iy]
            row = iy * self.nx
            for ix in range(self.nx):
                if mask[row + ix]:
                    total += (self.xs[ix + 1] - self.xs[ix]) * height
        return total

    def flood(self, start: int) -> bytearray:
        """Every standable cell connected to `start` (cells joined edge to edge)."""
        nx, free = self.nx, self.free
        last_row = nx * (self.ny - 1)
        seen = bytearray(len(free))
        seen[start] = 1
        stack = [start]
        while stack:
            i = stack.pop()
            ix = i % nx
            if ix and free[i - 1] and not seen[i - 1]:
                seen[i - 1] = 1
                stack.append(i - 1)
            if ix < nx - 1 and free[i + 1] and not seen[i + 1]:
                seen[i + 1] = 1
                stack.append(i + 1)
            if i >= nx and free[i - nx] and not seen[i - nx]:
                seen[i - nx] = 1
                stack.append(i - nx)
            if i < last_row and free[i + nx] and not seen[i + nx]:
                seen[i + nx] = 1
                stack.append(i + nx)
        return seen

    def reaches(self, seen: bytearray, zone: Rect) -> bool:
        """True when the walk gets to a spot inside `zone`."""
        for i in self.cells(zone):
            if seen[i]:
                return True
        return False


def _walk(bounds: Rect, entry_zone: Rect, entry_point: Point, obstacles: Sequence[Rect], width: float):
    """Flood the room at one path width; None when a walker cannot even stand at the door."""
    floor = FloorMap(bounds, obstacles, width)
    starts = [i for i in floor.cells(entry_zone) if floor.free[i]]
    if not starts:
        return None
    ex, ey = entry_point

    def gap(i: int) -> float:              # distance from the door to the cell
        x0, y0, x1, y1 = floor.rect(i)
        return max(x0 - ex, ex - x1, 0.0) ** 2 + max(y0 - ey, ey - y1, 0.0) ** 2

    return floor, floor.flood(min(starts, key=gap))


def can_walk(
    bounds: Rect,
    entry_zone: Rect,
    entry_point: Point,
    obstacles: Sequence[Rect],
    targets: Sequence[Target],
    width: float,
) -> bool:
    """Can a walker `width` wide stand inside every essential target, starting from the door?"""
    walked = _walk(bounds, entry_zone, entry_point, obstacles, width)
    if walked is None:
        return False
    floor, seen = walked
    return all(floor.reaches(seen, t.zone) for t in targets if t.essential)


def analyse(
    bounds: Rect,
    entry_zone: Rect,
    entry_point: Point,
    obstacles: Sequence[Rect],
    targets: Sequence[Target],
    widths: Sequence[float],
) -> CirculationReport:
    """Can every essential target be walked to from the entrance, and how wide is the way there?"""
    report = CirculationReport(valid=False)
    narrowest = float(min(widths))
    base = _walk(bounds, entry_zone, entry_point, obstacles, narrowest)
    if base is None:
        report.unreachable = ["the landing inside the door"]
        return report
    floor, seen = base
    standable = floor.area(floor.free)
    report.reached_ratio = floor.area(seen) / standable if standable else 0.0
    report.unreachable = [t.name for t in targets if t.essential and not floor.reaches(seen, t.zone)]
    if report.unreachable:
        return report

    report.valid = True
    report.width = narrowest
    report.cut_off = [t.name for t in targets if not t.essential and not floor.reaches(seen, t.zone)]
    if report.cut_off:
        report.notes.append("Cannot be walked up to: {}.".format(", ".join(report.cut_off)))

    for width in sorted((float(w) for w in widths if w > narrowest), reverse=True):
        walked = _walk(bounds, entry_zone, entry_point, obstacles, width)
        if walked is None:
            short = ["the landing inside the door"]
        else:
            wide, wide_seen = walked
            short = [t.name for t in targets
                     if t.essential and not wide.reaches(wide_seen, inflate(t.zone, width / 2.0 + NEAR))]
        if not short:
            report.width = width
            break
        report.pinch = (width, short)      # the narrowest width that still fails says where it pinches
    return report


def open_square(bounds: Rect, obstacles: Sequence[Rect]) -> float:
    """Side of the largest square of floor with nothing standing on it.

    The largest empty square can always be slid down and to the left until it
    rests against a wall or a piece of furniture on both of those sides, so only
    those corner positions need trying.
    """
    obstacles = list(obstacles) + list(getattr(bounds, "holes", ()))
    lefts = [bounds[0]] + [o[2] for o in obstacles]
    bottoms = [bounds[1]] + [o[3] for o in obstacles]
    best = 0.0
    for x in lefts:
        for y in bottoms:
            side = min(bounds[2] - x, bounds[3] - y)
            for o in obstacles:
                if side <= best:
                    break
                if o[2] > x and o[3] > y:              # this piece is not behind or below the corner
                    side = min(side, max(o[0] - x, o[1] - y))
            if side > best:
                best = side
    return max(best, 0.0)
