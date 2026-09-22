"""
Door rules (specification 5.3, 5.4, 5.6).

Three separate things have to stay clear around every door:

1. the opening itself - nothing may stand in the doorway;
2. the swing area   - the quarter-disc an inward leaf sweeps;
3. the clearance zone - a 900-1200 mm deep band across the door width, so a
   person can actually step in and turn.

A door that slides or opens outward keeps rules 1 and 3 but not rule 2.
"""

from __future__ import annotations

from typing import List, Optional

from ..models.door import Door
from ..models.furniture import Furniture
from ..models.geometry import Rect, Shape
from .context import PlacementContext, Violation


def door_opening_shape(door: Door, ctx: PlacementContext) -> Shape:
    return Shape.of(door.opening_rect(ctx.room, depth=150.0))


def door_swing_shape(door: Door, ctx: PlacementContext) -> Optional[Shape]:
    return door.swing_shape(ctx.room)


def door_clearance_shape(door: Door, ctx: PlacementContext, depth: Optional[float] = None) -> Shape:
    depth = ctx.config.clearances.door_clearance_min if depth is None else depth
    return Shape.of(door.clearance_zone(ctx.room, depth))


def check_door_opening(item: Furniture, ctx: PlacementContext) -> Optional[Violation]:
    """5.3 - nothing may stand in a doorway."""
    footprint = item.footprint()
    for door in ctx.doors:
        if footprint.intersects(door_opening_shape(door, ctx)):
            return Violation(
                rule="door_opening",
                message="{} stands in the opening of door '{}' on the {} wall".format(
                    item.role or item.type, door.id, door.wall
                ),
                subject=item.id,
                related=door.id,
            )
    return None


def check_door_swing(item: Furniture, ctx: PlacementContext) -> Optional[Violation]:
    """5.4 - an inward-opening leaf must be able to sweep its full quarter circle."""
    footprint = item.footprint()
    for door in ctx.doors:
        swing = door_swing_shape(door, ctx)
        if swing is None:
            continue
        if footprint.intersects(swing):
            return Violation(
                rule="door_swing",
                message="{} intersects the {:.0f} mm inward swing arc of door '{}'".format(
                    item.role or item.type, door.width, door.id
                ),
                subject=item.id,
                related=door.id,
            )
    return None


def check_door_clearance(item: Furniture, ctx: PlacementContext) -> Optional[Violation]:
    """5.3 / 5.6 - the 900 mm entry zone in front of every door stays empty."""
    depth = ctx.config.clearances.door_clearance_min
    footprint = item.footprint()
    for door in ctx.doors:
        zone = door_clearance_shape(door, ctx, depth)
        if footprint.intersects(zone):
            return Violation(
                rule="door_clearance",
                message="{} sits inside the {:.0f} mm entry clearance of door '{}'".format(
                    item.role or item.type, depth, door.id
                ),
                subject=item.id,
                related=door.id,
            )
    return None


def distance_to_nearest_door(item: Furniture, ctx: PlacementContext) -> float:
    """Gap from the item to the closest door clearance zone (mm)."""
    if not ctx.doors:
        return float("inf")
    box = item.bbox
    best = float("inf")
    for door in ctx.doors:
        zone = door.clearance_zone(ctx.room, ctx.config.clearances.door_clearance_min)
        best = min(best, box.distance_to_rect(zone))
    return best


def preferred_clearance_satisfied(ctx: PlacementContext, items: List[Furniture]) -> bool:
    """True when every door also keeps the *preferred* 1200 mm band clear."""
    depth = ctx.config.clearances.door_clearance_preferred
    for door in ctx.doors:
        zone = Shape.of(door.clearance_zone(ctx.room, depth))
        for item in items:
            if item.spec.flat:
                continue
            if item.footprint().intersects(zone):
                return False
    return True
