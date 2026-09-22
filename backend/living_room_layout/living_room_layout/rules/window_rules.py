"""
Window rules (specification 5.5).

The rule is height-aware rather than a blanket ban:

* tall pieces (bookshelf, cabinet, wardrobe - anything >= 1100 mm) may never
  stand in front of glass: they block daylight and the view;
* low pieces (sofa back, TV console, side table, low storage) may sit under a
  window, but only if they stay below the sill and leave the curtain track
  space to operate;
* nothing at all may block a window whose sill is near the floor
  (a full-height / French window doubles as a walkway);
* a window must stay physically reachable - the access band in front of it
  cannot be sealed off by a deep piece across its whole width.
"""

from __future__ import annotations

from typing import List, Optional

from ..models.furniture import Furniture
from ..models.geometry import Rect, Shape, segment_overlap
from ..models.window import Window
from .context import PlacementContext, Violation


def _overlap_fraction(item: Furniture, window: Window, ctx: PlacementContext) -> float:
    """How much of the window's width the item covers, 0..1."""
    box = item.bbox
    wall = ctx.room.wall(window.wall)
    if wall.is_horizontal:
        covered = segment_overlap(box.x0, box.x1, window.start, window.end)
    else:
        covered = segment_overlap(box.y0, box.y1, window.start, window.end)
    return covered / window.width if window.width else 0.0


def _in_access_band(item: Furniture, window: Window, ctx: PlacementContext, depth: float) -> bool:
    zone = window.access_zone(ctx.room, depth)
    return item.footprint().intersects(Shape.of(zone))


def _depth_at_window(item: Furniture, window: Window, ctx: PlacementContext) -> float:
    """How far into the room the piece reaches, measured under the window.

    An L-sofa whose 900 mm back runs under the glass is still leanable over;
    the same sofa turned so its 2200 mm return blocks the window is not.  Only
    the parts that actually sit under the window count.
    """
    room = ctx.room
    wall = room.wall(window.wall)
    deepest = 0.0
    for rect in item.part_rects():
        if wall.is_horizontal:
            if segment_overlap(rect.x0, rect.x1, window.start, window.end) <= 0:
                continue
            reach = rect.y1 if window.wall == "south" else room.length - rect.y0
        else:
            if segment_overlap(rect.y0, rect.y1, window.start, window.end) <= 0:
                continue
            reach = rect.x1 if window.wall == "west" else room.width - rect.x0
        deepest = max(deepest, reach)
    return deepest


def check_window_block(item: Furniture, ctx: PlacementContext) -> Optional[Violation]:
    """5.5 - daylight, view, reachability and curtain operation."""
    clear = ctx.config.clearances
    spec = item.spec
    if spec.flat:
        return None

    for window in ctx.windows:
        band = clear.window_access_depth
        if not _in_access_band(item, window, ctx, band):
            continue
        coverage = _overlap_fraction(item, window, ctx)
        if coverage <= 0.02:
            continue

        # (a) tall furniture in front of a window: never allowed
        if spec.is_tall:
            return Violation(
                rule="window_tall_furniture",
                message="{} is {:.0f} mm tall and would block window '{}' ({:.0f}% of its width)".format(
                    item.role or item.type, spec.height, window.id, coverage * 100
                ),
                subject=item.id,
                related=window.id,
            )

        # (b) full-height glazing: keep the whole opening clear
        if window.is_floor_to_ceiling() and coverage > 0.15:
            return Violation(
                rule="window_floor_to_ceiling",
                message="window '{}' has a {:.0f} mm sill (effectively floor to ceiling) "
                "so {} may not stand in front of it".format(
                    window.id, window.sill_height, item.role or item.type
                ),
                subject=item.id,
                related=window.id,
            )

        # (c) a piece whose top rises above the sill starts eating into the glass
        if spec.height > window.sill_height and coverage > 0.35:
            return Violation(
                rule="window_sill_height",
                message="{} is {:.0f} mm high, above the {:.0f} mm sill of window '{}', "
                "and would cover {:.0f}% of the glass".format(
                    item.role or item.type, spec.height, window.sill_height,
                    window.id, coverage * 100,
                ),
                subject=item.id,
                related=window.id,
            )

        # (d) some pieces simply do not belong in front of glass (a TV glares)
        if not spec.allow_near_window and coverage > 0.15:
            return Violation(
                rule="window_incompatible_furniture",
                message="{} should not be placed in front of window '{}' "
                "(daylight behind it and glare on the screen)".format(
                    item.role or item.type, window.id
                ),
                subject=item.id,
                related=window.id,
            )

        # (e) the window has to stay physically reachable
        reach = _depth_at_window(item, window, ctx)
        if coverage > 0.85 and reach >= 1200.0:
            return Violation(
                rule="window_access",
                message="{} covers {:.0f}% of window '{}' and reaches {:.0f} mm into the room "
                "under it, leaving the window unreachable".format(
                    item.role or item.type, coverage * 100, window.id, reach
                ),
                subject=item.id,
                related=window.id,
            )
    return None


def window_coverage_penalty_terms(items: List[Furniture], ctx: PlacementContext):
    """(window id, covering item, coverage fraction) for partially covered windows."""
    results = []
    for window in ctx.windows:
        for item in items:
            if item.spec.flat:
                continue
            if not _in_access_band(item, window, ctx, ctx.config.clearances.window_access_depth):
                continue
            coverage = _overlap_fraction(item, window, ctx)
            if coverage > 0.02:
                results.append((window.id, item, coverage))
    return results


def windows_fully_accessible(items: List[Furniture], ctx: PlacementContext) -> bool:
    return not window_coverage_penalty_terms(items, ctx)


def is_near_window(item: Furniture, ctx: PlacementContext, radius: float = 1200.0) -> Optional[Window]:
    """The nearest window whose access band is within `radius` of the item."""
    best = None
    best_gap = radius
    for window in ctx.windows:
        zone = window.access_zone(ctx.room, ctx.config.clearances.window_access_depth)
        gap = item.bbox.distance_to_rect(zone)
        if gap <= best_gap:
            best_gap = gap
            best = window
    return best
