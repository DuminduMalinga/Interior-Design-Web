"""
The hard-constraint registry (specification 5).

A placement that breaks any of these is *invalid*: it is discarded, never
scored.  Every check returns either `None` or a `Violation` carrying a
human-readable reason, which is what makes the rejected-placement report in the
output possible.

Two levels exist:

* per-item checks  - run for every candidate placement while searching;
* layout checks    - run once on a finished layout (circulation is global).

New rules are added by appending a function to `ITEM_CONSTRAINTS` or
`LAYOUT_CONSTRAINTS`; nothing else in the engine changes.
"""

from __future__ import annotations

from typing import Callable, List, Optional

from ..models.furniture import Furniture, overlap_exempt
from ..models.geometry import Rect, Shape
from .context import PlacementContext, Violation
from .circulation_rules import check_layout_circulation
from .door_rules import check_door_clearance, check_door_opening, check_door_swing
from .furniture_rules import (
    check_coffee_table_clearance,
    check_minimum_gaps,
    check_paired_furniture,
    check_seating_clearance,
    check_seating_group_cohesion,
    check_use_clearance,
    check_wall_requirement,
)
from .window_rules import check_window_block


# --------------------------------------------------------------------------- #
# 5.1 room boundary
# --------------------------------------------------------------------------- #
def check_room_boundary(item: Furniture, ctx: PlacementContext) -> Optional[Violation]:
    """Furniture must lie completely inside the room; it may not cross a wall."""
    if ctx.room.contains(item.footprint(), tol=1.0):
        return None
    box = item.bbox
    return Violation(
        rule="room_boundary",
        message="{} extends outside the room (bbox {:.0f},{:.0f} to {:.0f},{:.0f} "
        "in a {:.0f} x {:.0f} mm room)".format(
            item.role or item.type, box.x0, box.y0, box.x1, box.y1,
            ctx.room.width, ctx.room.length,
        ),
        subject=item.id,
    )


# --------------------------------------------------------------------------- #
# 5.2 furniture overlap
# --------------------------------------------------------------------------- #
def check_furniture_overlap(item: Furniture, ctx: PlacementContext) -> Optional[Violation]:
    """True polygon intersection, not a centre-point test."""
    footprint = item.footprint()
    for other in ctx.placed:
        if other.id == item.id:
            continue
        if overlap_exempt(item.type, other.type):
            continue
        if footprint.intersects(other.footprint()):
            return Violation(
                rule="furniture_overlap",
                message="{} overlaps {}".format(
                    item.role or item.type, other.role or other.type
                ),
                subject=item.id,
                related=other.id,
            )
    return None


# --------------------------------------------------------------------------- #
# Registry
# --------------------------------------------------------------------------- #
ItemCheck = Callable[[Furniture, PlacementContext], Optional[Violation]]
LayoutCheck = Callable[[PlacementContext, List[Furniture]], Optional[Violation]]

# Ordered cheapest-first: the search runs thousands of these per second.
ITEM_CONSTRAINTS: List[ItemCheck] = [
    check_room_boundary,          # 5.1
    check_furniture_overlap,      # 5.2
    check_door_opening,           # 5.3
    check_door_clearance,         # 5.3 / 5.6
    check_door_swing,             # 5.4
    check_window_block,           # 5.5
    check_wall_requirement,       # 11 (TV / bookshelf need a wall)
    check_paired_furniture,       # 11 (a TV stands on its console)
    check_use_clearance,          # 5.8 (usable space in front of a piece)
    check_seating_clearance,      # 5.8
    check_seating_group_cohesion,  # 11 (no orphaned chair across the room)
    check_coffee_table_clearance,  # 5.7
    check_minimum_gaps,           # no dead slivers
]

LAYOUT_CONSTRAINTS: List[LayoutCheck] = [
    check_layout_circulation,     # 5.6
]


def check_item(item: Furniture, ctx: PlacementContext) -> Optional[Violation]:
    """Run every per-item hard constraint; returns the first violation found."""
    for rule in ITEM_CONSTRAINTS:
        violation = rule(item, ctx)
        if violation is not None:
            return violation
    return None


def check_item_all(item: Furniture, ctx: PlacementContext) -> List[Violation]:
    """Every violation for one item (used for reporting, not for the search)."""
    found = []
    for rule in ITEM_CONSTRAINTS:
        violation = rule(item, ctx)
        if violation is not None:
            found.append(violation)
    return found


def check_layout(ctx: PlacementContext, items: List[Furniture]) -> List[Violation]:
    """Hard constraints that only make sense for a complete layout."""
    violations: List[Violation] = []
    full_ctx = ctx.with_placed(items)
    for item in items:
        others = [f for f in items if f.id != item.id]
        item_ctx = ctx.with_placed(others)
        violation = check_item(item, item_ctx)
        if violation is not None:
            violations.append(violation)
    for rule in LAYOUT_CONSTRAINTS:
        violation = rule(full_ctx, items)
        if violation is not None:
            violations.append(violation)
    return violations


def rule_catalogue() -> List[dict]:
    """The active hard constraints, each traced back to the rules document.

    `source` quotes the line of "Rules for Designing a Living Room" that the
    check implements, so a reviewer can audit the engine against the brief.
    """
    return [
        {"id": "room_boundary", "spec": "5.1", "source": "Geometry: furniture is inside the room",
         "description": "Furniture stays completely inside the room."},
        {"id": "furniture_overlap", "spec": "5.2", "source": "Geometry: two pieces cannot share floor",
         "description": "Footprints may not intersect (true polygon test, not centre points)."},
        {"id": "door_opening", "spec": "5.3", "source": "Door rules: 'Door opening area - keep completely clear'",
         "description": "The door opening itself stays empty."},
        {"id": "door_clearance", "spec": "5.3/5.6",
         "source": "Door rules: 'Keep approximately 900-1200 mm clear around the main entrance'",
         "description": "900 mm entry band in front of every door stays empty."},
        {"id": "door_swing", "spec": "5.4", "source": "Door rules: 'Avoid ... the door-opening/swing area'",
         "description": "The quarter-circle swept by an inward-opening leaf stays empty."},
        {"id": "window_tall_furniture", "spec": "5.5",
         "source": "Window rules: 'Don't place tall bookshelves directly in front of windows'",
         "description": "Furniture 1100 mm or taller may not stand in front of a window."},
        {"id": "window_sill_height", "spec": "5.5",
         "source": "Window rules: 'Blocking natural light with large furniture' / 'Can place: low sofa, low TV console, small side table, low storage cabinet'",
         "description": "Only furniture below sill height may stand in front of the glass."},
        {"id": "window_floor_to_ceiling", "spec": "5.5",
         "source": "Window rules: 'Keep windows visually and physically accessible'",
         "description": "Full-height glazing (low sill) stays completely clear."},
        {"id": "window_access", "spec": "5.5",
         "source": "Window rules: 'Keep windows visually and physically accessible' / 'Don't block curtains/blinds from operating'",
         "description": "Windows stay reachable and curtains keep room to operate."},
        {"id": "requires_wall", "spec": "11",
         "source": "Layout 2: 'TV should be on a solid wall' / Layout 4: 'Bookshelf against a solid wall'",
         "description": "TV, console and bookshelf need a wall (or a solid piece) behind them."},
        {"id": "media_pairing", "spec": "11", "source": "Layout 2: TV and TV console are one unit",
         "description": "A TV stands on or above its own console."},
        {"id": "use_clearance", "spec": "5.8",
         "source": "Layout 4: 'Reading chair beside the bookshelf, not blocking it'",
         "description": "The space a piece needs in order to be used stays free."},
        {"id": "seating_clearance", "spec": "5.8",
         "source": "Circulation rules: 'Behind frequently used seating 600-900 mm'",
         "description": "600 mm behind seating, or the seat is backed against a wall."},
        {"id": "seating_group_cohesion", "spec": "11",
         "source": "Relationship rules: seating should form one conversation group",
         "description": "A chair must stay within reach of at least one other seat - no orphans across the room."},
        {"id": "coffee_table_min_clearance", "spec": "5.7",
         "source": "Circulation rules: 'Between sofa and coffee table 400-500 mm'",
         "description": "At least 400 mm between any seat and the coffee table."},
        {"id": "coffee_table_surround", "spec": "5.7",
         "source": "Circulation rules: 'Around coffee table 400-500 mm'",
         "description": "400 mm of movement space all round the coffee table."},
        {"id": "coffee_table_reach", "spec": "5.7",
         "source": "Circulation rules: 'Between sofa and coffee table 400-500 mm'",
         "description": "The coffee table stays within reach of the main sofa."},
        {"id": "dead_gap", "spec": "5.7/5.8", "source": "Circulation rules: usable clearances only",
         "description": "No unusable slivers narrower than 300 mm between pieces."},
        {"id": "circulation", "spec": "5.6",
         "source": "Circulation rules: 'Main walking path 900-1200 mm' / Layout 6: 'Keep at least one major path completely clear from the entrance'",
         "description": "A 900 mm wide path links the entrance to every seat, door and window."},
    ]
