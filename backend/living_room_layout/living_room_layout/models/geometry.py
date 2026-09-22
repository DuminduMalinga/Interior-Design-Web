"""
Pure-python 2D geometry engine.

The rest of the system only talks to this module through the small public API
below (`Point`, `Rect`, `Polygon`, `Shape` and the free functions).  That keeps
the geometry backend swappable: a shapely-based implementation only has to
provide the same names and behaviour.

All units are millimetres.  Angles are degrees, counter-clockwise.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Tuple

EPS = 1e-6

# Touching is allowed: two shapes only "overlap" when they interpenetrate by
# more than this amount.  Prevents float noise from rejecting a sofa that sits
# exactly against a wall.
TOUCH_TOLERANCE = 1.0  # mm


# --------------------------------------------------------------------------- #
# Point
# --------------------------------------------------------------------------- #
class Point(Tuple[float, float]):
    """Immutable 2D point.  Behaves like a plain (x, y) tuple."""

    __slots__ = ()

    def __new__(cls, x, y=None):
        if y is None:  # Point((x, y))
            x, y = x
        return super().__new__(cls, (float(x), float(y)))

    @property
    def x(self) -> float:
        return self[0]

    @property
    def y(self) -> float:
        return self[1]

    def distance_to(self, other) -> float:
        return math.hypot(self[0] - other[0], self[1] - other[1])

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return "Point({:.1f}, {:.1f})".format(self[0], self[1])


def distance(a, b) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


# --------------------------------------------------------------------------- #
# Polygon (convex)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Polygon:
    """A convex polygon given by its points.

    Only convex polygons are used for intersection tests (SAT).  Concave
    footprints (an L-shaped sofa, for instance) are modelled as a `Shape`
    holding several convex parts.
    """

    points: Tuple[Tuple[float, float], ...]

    def __post_init__(self):
        object.__setattr__(
            self, "points", tuple((float(p[0]), float(p[1])) for p in self.points)
        )

    # -- basic properties --------------------------------------------------- #
    @property
    def bounds(self) -> Tuple[float, float, float, float]:
        xs = [p[0] for p in self.points]
        ys = [p[1] for p in self.points]
        return min(xs), min(ys), max(xs), max(ys)

    @property
    def area(self) -> float:
        pts = self.points
        n = len(pts)
        s = 0.0
        for i in range(n):
            x1, y1 = pts[i]
            x2, y2 = pts[(i + 1) % n]
            s += x1 * y2 - x2 * y1
        return abs(s) * 0.5

    @property
    def centroid(self) -> Point:
        pts = self.points
        n = len(pts)
        a = 0.0
        cx = cy = 0.0
        for i in range(n):
            x1, y1 = pts[i]
            x2, y2 = pts[(i + 1) % n]
            cross = x1 * y2 - x2 * y1
            a += cross
            cx += (x1 + x2) * cross
            cy += (y1 + y2) * cross
        if abs(a) < EPS:
            return Point(sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n)
        a *= 0.5
        return Point(cx / (6 * a), cy / (6 * a))

    # -- predicates --------------------------------------------------------- #
    def contains_point(self, pt, tol: float = EPS) -> bool:
        """Convex point-in-polygon: point on the same side of every edge."""
        pts = self.points
        n = len(pts)
        sign = 0
        for i in range(n):
            x1, y1 = pts[i]
            x2, y2 = pts[(i + 1) % n]
            cross = (x2 - x1) * (pt[1] - y1) - (y2 - y1) * (pt[0] - x1)
            if cross > tol:
                if sign < 0:
                    return False
                sign = 1
            elif cross < -tol:
                if sign > 0:
                    return False
                sign = -1
        return True

    def _axes(self) -> List[Tuple[float, float]]:
        pts = self.points
        n = len(pts)
        axes = []
        for i in range(n):
            x1, y1 = pts[i]
            x2, y2 = pts[(i + 1) % n]
            ex, ey = x2 - x1, y2 - y1
            length = math.hypot(ex, ey)
            if length < EPS:
                continue
            axes.append((-ey / length, ex / length))  # edge normal
        return axes

    def _project(self, axis) -> Tuple[float, float]:
        dots = [p[0] * axis[0] + p[1] * axis[1] for p in self.points]
        return min(dots), max(dots)

    def intersects(self, other: "Polygon", tolerance: float = TOUCH_TOLERANCE) -> bool:
        """Separating Axis Theorem overlap test (convex polygons only).

        Shapes that merely touch (penetration <= `tolerance`) are *not*
        considered intersecting.
        """
        ax, ay, bx, by = self.bounds
        cx, cy, dx, dy = other.bounds
        if ax >= dx - tolerance or cx >= bx - tolerance:
            return False
        if ay >= dy - tolerance or cy >= by - tolerance:
            return False
        for axis in self._axes() + other._axes():
            amin, amax = self._project(axis)
            bmin, bmax = other._project(axis)
            overlap = min(amax, bmax) - max(amin, bmin)
            if overlap <= tolerance:
                return False
        return True

    def translated(self, dx: float, dy: float) -> "Polygon":
        return Polygon(tuple((p[0] + dx, p[1] + dy) for p in self.points))


# --------------------------------------------------------------------------- #
# Rect (axis aligned)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Rect:
    """Axis-aligned rectangle anchored at its minimum corner."""

    x: float
    y: float
    width: float
    height: float

    # -- constructors ------------------------------------------------------- #
    @staticmethod
    def from_bounds(x0: float, y0: float, x1: float, y1: float) -> "Rect":
        return Rect(min(x0, x1), min(y0, y1), abs(x1 - x0), abs(y1 - y0))

    @staticmethod
    def from_center(cx: float, cy: float, width: float, height: float) -> "Rect":
        return Rect(cx - width / 2.0, cy - height / 2.0, width, height)

    # -- properties --------------------------------------------------------- #
    @property
    def x0(self) -> float:
        return self.x

    @property
    def y0(self) -> float:
        return self.y

    @property
    def x1(self) -> float:
        return self.x + self.width

    @property
    def y1(self) -> float:
        return self.y + self.height

    @property
    def cx(self) -> float:
        return self.x + self.width / 2.0

    @property
    def cy(self) -> float:
        return self.y + self.height / 2.0

    @property
    def center(self) -> Point:
        return Point(self.cx, self.cy)

    @property
    def area(self) -> float:
        return max(0.0, self.width) * max(0.0, self.height)

    @property
    def bounds(self):
        return self.x0, self.y0, self.x1, self.y1

    @property
    def corners(self) -> Tuple[Point, ...]:
        return (
            Point(self.x0, self.y0),
            Point(self.x1, self.y0),
            Point(self.x1, self.y1),
            Point(self.x0, self.y1),
        )

    # -- operations --------------------------------------------------------- #
    def to_polygon(self) -> Polygon:
        return Polygon(tuple((p[0], p[1]) for p in self.corners))

    def inflate(self, dx: float, dy: float = None) -> "Rect":
        if dy is None:
            dy = dx
        return Rect(self.x - dx, self.y - dy, self.width + 2 * dx, self.height + 2 * dy)

    def translated(self, dx: float, dy: float) -> "Rect":
        return Rect(self.x + dx, self.y + dy, self.width, self.height)

    def contains_point(self, pt, tol: float = EPS) -> bool:
        return (self.x0 - tol <= pt[0] <= self.x1 + tol) and (
            self.y0 - tol <= pt[1] <= self.y1 + tol
        )

    def contains_rect(self, other: "Rect", tol: float = TOUCH_TOLERANCE) -> bool:
        return (
            other.x0 >= self.x0 - tol
            and other.y0 >= self.y0 - tol
            and other.x1 <= self.x1 + tol
            and other.y1 <= self.y1 + tol
        )

    def intersects(self, other: "Rect", tolerance: float = TOUCH_TOLERANCE) -> bool:
        return not (
            other.x0 >= self.x1 - tolerance
            or other.x1 <= self.x0 + tolerance
            or other.y0 >= self.y1 - tolerance
            or other.y1 <= self.y0 + tolerance
        )

    def intersection_area(self, other: "Rect") -> float:
        w = min(self.x1, other.x1) - max(self.x0, other.x0)
        h = min(self.y1, other.y1) - max(self.y0, other.y0)
        if w <= 0 or h <= 0:
            return 0.0
        return w * h

    def distance_to_rect(self, other: "Rect") -> float:
        """Gap between two rectangles (0 when they touch or overlap)."""
        dx = max(other.x0 - self.x1, self.x0 - other.x1, 0.0)
        dy = max(other.y0 - self.y1, self.y0 - other.y1, 0.0)
        return math.hypot(dx, dy)


# --------------------------------------------------------------------------- #
# Shape: a set of convex parts, the universal footprint type
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Shape:
    """A footprint made of one or more convex polygons.

    Every collidable object in the system (furniture, door swing, clearance
    zone, circulation corridor) exposes its geometry as a `Shape`, so a single
    pair of routines handles all overlap questions.
    """

    parts: Tuple[Polygon, ...] = field(default_factory=tuple)

    @staticmethod
    def of(*items) -> "Shape":
        parts: List[Polygon] = []
        for item in items:
            if item is None:
                continue
            if isinstance(item, Shape):
                parts.extend(item.parts)
            elif isinstance(item, Rect):
                parts.append(item.to_polygon())
            elif isinstance(item, Polygon):
                parts.append(item)
            elif isinstance(item, (list, tuple)):
                parts.extend(Shape.of(*item).parts)
            else:  # pragma: no cover - programming error
                raise TypeError("cannot build Shape from {!r}".format(type(item)))
        return Shape(tuple(parts))

    @property
    def bounds(self):
        if not self.parts:
            return (0.0, 0.0, 0.0, 0.0)
        b = [p.bounds for p in self.parts]
        return (
            min(v[0] for v in b),
            min(v[1] for v in b),
            max(v[2] for v in b),
            max(v[3] for v in b),
        )

    @property
    def bounding_rect(self) -> Rect:
        x0, y0, x1, y1 = self.bounds
        return Rect.from_bounds(x0, y0, x1, y1)

    @property
    def area(self) -> float:
        return sum(p.area for p in self.parts)

    @property
    def centroid(self) -> Point:
        total = self.area
        if total < EPS:
            return self.bounding_rect.center
        cx = sum(p.centroid.x * p.area for p in self.parts) / total
        cy = sum(p.centroid.y * p.area for p in self.parts) / total
        return Point(cx, cy)

    def intersects(self, other: "Shape", tolerance: float = TOUCH_TOLERANCE) -> bool:
        for a in self.parts:
            for b in other.parts:
                if a.intersects(b, tolerance):
                    return True
        return False

    def contains_point(self, pt, tol: float = EPS) -> bool:
        return any(p.contains_point(pt, tol) for p in self.parts)

    def translated(self, dx: float, dy: float) -> "Shape":
        return Shape(tuple(p.translated(dx, dy) for p in self.parts))


# --------------------------------------------------------------------------- #
# Helpers used by the rule modules
# --------------------------------------------------------------------------- #
def sector_polygon(center, radius, start_deg, end_deg, segments=10) -> Polygon:
    """Convex circular sector (<= 180 deg) as a polygon fan from `center`."""
    start = math.radians(start_deg)
    end = math.radians(end_deg)
    pts = [(center[0], center[1])]
    for i in range(segments + 1):
        t = start + (end - start) * i / segments
        pts.append((center[0] + radius * math.cos(t), center[1] + radius * math.sin(t)))
    return Polygon(tuple(pts))


def corridor_polygon(start, end, width) -> Polygon:
    """Rectangular corridor of `width` centred on the segment start->end."""
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = math.hypot(dx, dy)
    if length < EPS:
        return Rect.from_center(start[0], start[1], width, width).to_polygon()
    ux, uy = dx / length, dy / length
    nx, ny = -uy * width / 2.0, ux * width / 2.0
    return Polygon(
        (
            (start[0] + nx, start[1] + ny),
            (start[0] - nx, start[1] - ny),
            (end[0] - nx, end[1] - ny),
            (end[0] + nx, end[1] + ny),
        )
    )


def rotate_vector(vec, degrees):
    rad = math.radians(degrees)
    c, s = math.cos(rad), math.sin(rad)
    return (vec[0] * c - vec[1] * s, vec[0] * s + vec[1] * c)


def angle_between(v1, v2) -> float:
    """Absolute angle between two vectors, in degrees (0..180)."""
    n1 = math.hypot(*v1)
    n2 = math.hypot(*v2)
    if n1 < EPS or n2 < EPS:
        return 180.0
    dot = clamp((v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2), -1.0, 1.0)
    return math.degrees(math.acos(dot))


def segment_overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    """Length of the 1-D overlap of [a0,a1] and [b0,b1] (0 if disjoint)."""
    return max(0.0, min(a1, b1) - max(a0, b0))
