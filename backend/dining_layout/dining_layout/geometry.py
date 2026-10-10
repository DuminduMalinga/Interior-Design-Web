"""
Axis-aligned rectangle geometry.

Every piece of dining furniture stands square to the walls, so the whole engine
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


def beyond(r: Rect, direction: str, depth: float) -> Rect:
    """The strip `depth` deep lying against the `direction` face of `r`, outside it."""
    if direction == "east":
        return (r[2], r[1], r[2] + depth, r[3])
    if direction == "west":
        return (r[0] - depth, r[1], r[0], r[3])
    if direction == "north":
        return (r[0], r[3], r[2], r[3] + depth)
    return (r[0], r[1] - depth, r[2], r[1])


def point_gap(p: Point, r: Rect) -> float:
    """Distance from a point to a rectangle (0 when the point is inside it)."""
    return math.hypot(max(r[0] - p[0], p[0] - r[2], 0.0), max(r[1] - p[1], p[1] - r[3], 0.0))
