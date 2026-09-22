"""
Window model.

A window contributes three things to the rule engine:

* the wall stretch it occupies (so that stretch is not a "solid wall")
* an access band in front of it that must stay reachable and lets curtains work
* a sill height, which decides whether a *low* piece may stand under it
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict

from .geometry import Point, Rect, Shape
from .room import Room


@dataclass
class Window:
    """A window in one of the room walls."""

    id: str
    wall: str
    position: float           # distance along the wall to the window's near edge
    width: float = 1200.0
    height: float = 1200.0
    sill_height: float = 900.0

    # -- wall parameters ---------------------------------------------------- #
    @property
    def start(self) -> float:
        return self.position

    @property
    def end(self) -> float:
        return self.position + self.width

    @property
    def middle(self) -> float:
        return self.position + self.width / 2.0

    @property
    def top_height(self) -> float:
        return self.sill_height + self.height

    def center_point(self, room: Room) -> Point:
        return room.wall(self.wall).point_at(self.middle)

    # -- zones -------------------------------------------------------------- #
    def access_zone(self, room: Room, depth: float) -> Rect:
        """Band in front of the window that must stay usable."""
        return room.wall(self.wall).band(self.start, self.end, depth)

    def blocked_shape(self, room: Room, depth: float) -> Shape:
        return Shape.of(self.access_zone(room, depth))

    # -- rules helpers ------------------------------------------------------ #
    def is_floor_to_ceiling(self, threshold: float = 500.0) -> bool:
        """A low sill means nothing may stand in front of the glass at all."""
        return self.sill_height <= threshold

    def allows_under_furniture(self, furniture_height: float, margin: float = 100.0) -> bool:
        """True when a piece is low enough to sit under the glass."""
        return furniture_height + margin <= self.sill_height

    def wall_coverage(self, room: Room) -> float:
        """Fraction of its wall that this window occupies."""
        wall_length = room.wall(self.wall).length
        return self.width / wall_length if wall_length else 0.0

    def to_dict(self, room: Room = None, access_depth: float = 600.0) -> Dict:
        data = {
            "id": self.id,
            "wall": self.wall,
            "position": self.position,
            "width": self.width,
            "height": self.height,
            "sill_height": self.sill_height,
        }
        if room is not None:
            c = self.center_point(room)
            data["center"] = [round(c[0], 1), round(c[1], 1)]
            zone = self.access_zone(room, access_depth)
            data["access_zone"] = [
                round(zone.x0, 1), round(zone.y0, 1),
                round(zone.x1, 1), round(zone.y1, 1),
            ]
            data["wall_coverage"] = round(self.wall_coverage(room), 2)
        return data
