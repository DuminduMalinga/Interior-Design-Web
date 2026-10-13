"""
Axis-aligned rectangle geometry.

Every kitchen unit stands square to the walls, so the whole engine
works on plain ``(x0, y0, x1, y1)`` tuples in millimetres - no polygon objects.
That keeps a hard-constraint check down to a handful of comparisons, which is
what lets the search try every sensible position instead of sampling a few.

Coordinates follow the living-room engine, so one plan renderer draws both:
``x`` runs west -> east, ``y`` runs south -> north, origin in the south-west corner.
"""

from __future__ import annotations

import math
from typing import Iterable, Tuple

Rect = Tuple[float, float, float, float]
Point = Tuple[float, float]


def area(r: Rect) -> float:
    return max(0.0, r[2] - r[0]) * max(0.0, r[3] - r[1])


def center(r: Rect) -> Point:
    return ((r[0] + r[2]) / 2.0, (r[1] + r[3]) / 2.0)


def intersects(a: Rect, b: Rect, tol: float = 1.0) -> bool:
    """True when two rectangles share floor area; edges that merely touch do not count."""
    return a[0] < b[2] - tol and b[0] < a[2] - tol and a[1] < b[3] - tol and b[1] < a[3] - tol


def hits_any(r: Rect, others: Iterable[Rect], tol: float = 1.0) -> bool:
    for other in others:
        if intersects(r, other, tol):
            return True
    return False


def overlap_area(a: Rect, b: Rect) -> float:
    return max(0.0, min(a[2], b[2]) - max(a[0], b[0])) * max(0.0, min(a[3], b[3]) - max(a[1], b[1]))


def span_overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    """Length two intervals have in common."""
    return max(0.0, min(a1, b1) - max(a0, b0))


def inflate(r: Rect, d: float) -> Rect:
    return (r[0] - d, r[1] - d, r[2] + d, r[3] + d)


def contains(outer: Rect, inner: Rect, tol: float = 1.0) -> bool:
    return (
        inner[0] >= outer[0] - tol and inner[1] >= outer[1] - tol
        and inner[2] <= outer[2] + tol and inner[3] <= outer[3] + tol
    )


def distance(a: Rect, b: Rect) -> float:
    """Shortest gap between two rectangles (0 when they touch or overlap)."""
    dx = max(b[0] - a[2], a[0] - b[2], 0.0)
    dy = max(b[1] - a[3], a[1] - b[3], 0.0)
    return math.hypot(dx, dy)


def segment_hits(p: Point, q: Point, r: Rect, tol: float = 1.0) -> bool:
    """True when the straight line from ``p`` to ``q`` passes through ``r`` (Liang-Barsky)."""
    t0, t1 = 0.0, 1.0
    for start, delta, lo, hi in (
        (p[0], q[0] - p[0], r[0] + tol, r[2] - tol),
        (p[1], q[1] - p[1], r[1] + tol, r[3] - tol),
    ):
        if abs(delta) < 1e-9:
            if start < lo or start > hi:
                return False
            continue
        a, b = (lo - start) / delta, (hi - start) / delta
        if a > b:
            a, b = b, a
        t0, t1 = max(t0, a), min(t1, b)
        if t0 > t1:
            return False
    return True


def clamp01(value: float) -> float:
    return 0.0 if value < 0.0 else 1.0 if value > 1.0 else value


def _side(a: Point, b: Point, p: Point) -> float:
    """Which side of the line a -> b the point p lies on (sign of the cross product)."""
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])


def segments_cross(p: Point, q: Point, a: Point, b: Point) -> bool:
    """True when the segments p-q and a-b properly cross each other."""
    d1, d2 = _side(a, b, p), _side(a, b, q)
    d3, d4 = _side(p, q, a), _side(p, q, b)
    return ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0)) and 0 not in (d1, d2, d3, d4)


def in_triangle(p: Point, triangle: Tuple[Point, Point, Point], margin: float = 1.0) -> bool:
    """True when p lies strictly inside the triangle (a degenerate triangle has no inside)."""
    a, b, c = triangle
    if abs(_side(a, b, c)) < margin * margin:
        return False
    s1, s2, s3 = _side(a, b, p), _side(b, c, p), _side(c, a, p)
    return (s1 > 0 and s2 > 0 and s3 > 0) or (s1 < 0 and s2 < 0 and s3 < 0)


def segment_meets_triangle(p: Point, q: Point, triangle: Tuple[Point, Point, Point]) -> bool:
    """True when the segment p-q passes through the triangle."""
    a, b, c = triangle
    if in_triangle(p, triangle) or in_triangle(q, triangle):
        return True
    return any(segments_cross(p, q, u, v) for u, v in ((a, b), (b, c), (c, a)))


def rect_meets_triangle(r: Rect, triangle: Tuple[Point, Point, Point]) -> bool:
    """True when the rectangle and the triangle share floor."""
    a, b, c = triangle
    if any(segment_hits(u, v, r) for u, v in ((a, b), (b, c), (c, a))):
        return True
    return in_triangle(center(r), triangle)
