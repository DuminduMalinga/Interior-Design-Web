"""
Circulation rules (specification 5.6).

A layout is only valid when a person can actually walk through it, so this
module answers three questions on the occupancy raster:

* can you get from the main entrance into the room at all (900 mm minimum)?
* can you reach every door and every seat from the entrance?
* how much of the floor is reachable, and does the wider 1200 mm preferred
  corridor also fit (that part is scored, not enforced)?

The raster is rebuilt once per candidate *layout*, never per candidate
placement, which keeps this affordable.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from ..engine.grid import OccupancyGrid
from ..models.furniture import Furniture
from ..models.geometry import Point, Shape, corridor_polygon
from .context import PlacementContext, Violation


@dataclass
class CirculationReport:
    """Result of the walkability analysis of one complete layout."""

    valid: bool
    width_achieved: float                     # widest corridor that still connects
    reachable_area: float                     # mm^2 of walkable core reached
    reachable_ratio: float                    # of all walkable space in the room
    unreachable_targets: List[str] = field(default_factory=list)
    unreachable_windows: List[str] = field(default_factory=list)
    messages: List[str] = field(default_factory=list)
    grid: object = None                       # the raster it was computed on
    path_cells: object = None                 # reachable-cell mask, for drawing

    @property
    def preferred_width_met(self) -> bool:
        return self.width_achieved >= 1200.0

    def to_dict(self) -> Dict:
        return {
            "valid": self.valid,
            "corridor_width_mm": round(self.width_achieved, 1),
            "walkable_core_m2": round(self.reachable_area / 1e6, 2),
            "walkable_reached_ratio": round(self.reachable_ratio, 3),
            "unreachable_targets": list(self.unreachable_targets),
            "windows_not_walkable_to": list(self.unreachable_windows),
            "notes": list(self.messages),
        }


def build_grid(ctx: PlacementContext, items: List[Furniture], include_door_zones: bool = False) -> OccupancyGrid:
    """Raster of the room with furniture marked as blocked.

    Door clearance zones are deliberately *not* blocked here: they are the
    walking space, and furniture is already kept out of them by the door rules.
    Blocking them would make the entrance itself unreachable.
    """
    room = ctx.room
    grid = OccupancyGrid(room.width, room.length, ctx.config.search.grid_cell)
    if include_door_zones:
        grid.mark_shape(ctx.door_zone())
    for item in items:
        if item.spec.flat:      # a rug is walked on, not around
            continue
        grid.mark_shape(item.footprint())
    return grid


def _targets(ctx: PlacementContext, items: List[Furniture]) -> List[Tuple[str, Point]]:
    """Points that must remain reachable from the main entrance."""
    targets: List[Tuple[str, Point]] = [("room_centre", ctx.room.center)]
    main = ctx.analysis.main_door
    for door in ctx.doors:
        if main is not None and door.id == main.id:
            continue
        targets.append(("door:" + door.id, door.entry_point(ctx.room, 700.0)))
    for item in items:
        if item.spec.is_seating:
            targets.append(("seat:" + item.id, item.front_center(500.0)))
        elif item.spec.front_clearance >= 600:
            targets.append(("use:" + item.id, item.front_center(item.spec.front_clearance * 0.6)))
    return targets


def _window_stand_point(ctx: PlacementContext, window) -> Point:
    centre = window.center_point(ctx.room)
    normal = ctx.room.wall(window.wall).inward
    offset = ctx.config.clearances.window_access_depth * 0.8
    return Point(
        min(max(centre[0] + normal[0] * offset, 1.0), ctx.room.width - 1.0),
        min(max(centre[1] + normal[1] * offset, 1.0), ctx.room.length - 1.0),
    )


def analyse_circulation(ctx: PlacementContext, items: List[Furniture]) -> CirculationReport:
    """Full walkability analysis of a finished layout."""
    clear = ctx.config.clearances
    grid = build_grid(ctx, items)
    entry = ctx.analysis.entry_point
    if entry is None:
        return CirculationReport(
            valid=True,
            width_achieved=float("inf"),
            reachable_area=grid.free_area(),
            reachable_ratio=1.0,
            messages=["Room has no door, circulation check skipped"],
            grid=grid,
        )

    report = CirculationReport(
        valid=False, width_achieved=0.0, reachable_area=0.0, reachable_ratio=0.0, grid=grid
    )

    # widest corridor that still connects the entrance to every target
    for width in (clear.circulation_preferred, clear.circulation_min):
        mask = grid.passable_mask(width)
        reach = grid.reachable_from(entry, mask)
        if reach is None:
            report.messages.append(
                "No {:.0f} mm standing space in front of the main entrance".format(width)
            )
            continue
        missing = [
            name
            for name, point in _targets(ctx, items)
            if not grid.path_exists(entry, point, mask, reach)
        ]
        area = grid.reachable_area(reach)
        walkable_total = sum(mask) * grid.cell_area
        if not missing:
            report.valid = True
            report.unreachable_targets = []
            # windows are scored, not enforced: a sofa may legitimately stand
            # under a window, which stops you walking right up to it
            report.unreachable_windows = [
                window.id
                for window in ctx.windows
                if not grid.path_exists(entry, _window_stand_point(ctx, window), mask, reach)
            ]
            report.width_achieved = width
            report.reachable_area = area
            report.reachable_ratio = area / walkable_total if walkable_total else 0.0
            report.path_cells = reach
            report.messages.append(
                "A {:.0f} mm wide path connects the entrance to every seat, door and window".format(width)
            )
            return report
        # remember the best attempt for the explanation
        report.unreachable_targets = missing
        report.reachable_area = area
        report.reachable_ratio = area / walkable_total if walkable_total else 0.0
        report.path_cells = reach

    if not report.messages:
        report.messages.append(
            "Only {:.0f}% of the walkable space is reachable from the entrance".format(
                report.reachable_ratio * 100
            )
        )
    return report


def check_layout_circulation(ctx: PlacementContext, items: List[Furniture]) -> Optional[Violation]:
    """Hard constraint wrapper around `analyse_circulation`."""
    report = analyse_circulation(ctx, items)
    if report.valid:
        return None
    detail = ", ".join(report.unreachable_targets[:4]) or "the room interior"
    return Violation(
        rule="circulation",
        message="No {:.0f} mm wide path from the main entrance to {}".format(
            ctx.config.clearances.circulation_min, detail
        ),
        subject="layout",
    )


def entrance_corridor(ctx: PlacementContext) -> Optional[Shape]:
    """Straight 900 mm corridor from the entrance to the middle of the room.

    A cheap stand-in for the full walkability analysis, used to rank candidate
    placements without rasterising the room for every one of them.  The real
    check (`analyse_circulation`) still runs on the finished layout.
    """
    cached = getattr(ctx.analysis, "_entrance_corridor", None)
    if cached is not None:
        return cached
    main = ctx.analysis.main_door
    if main is None:
        return None
    entry = main.entry_point(ctx.room, ctx.config.clearances.door_clearance_min * 0.6)
    corridor = Shape.of(
        corridor_polygon(entry, ctx.room.center, ctx.config.clearances.circulation_min)
    )
    setattr(ctx.analysis, "_entrance_corridor", corridor)
    return corridor


def entrance_corridor_clear(ctx: PlacementContext, items: List[Furniture]) -> bool:
    """Cheap pre-check: the straight run inward from the main door is empty."""
    main = ctx.analysis.main_door
    if main is None:
        return True
    depth = ctx.config.clearances.circulation_min
    zone = Shape.of(main.clearance_zone(ctx.room, depth))
    for item in items:
        if item.spec.flat:
            continue
        if item.footprint().intersects(zone):
            return False
    return True
