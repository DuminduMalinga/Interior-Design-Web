"""
Door model: opening, swing area and clearance zone.

The three zones a door creates are all geometry the constraint checker consumes
directly:

* `opening_rect`   - the physical hole in the wall (nothing may sit in it)
* `swing_shape`    - the quarter-circle an inward leaf sweeps (5.4)
* `clearance_zone` - the keep-clear band in front of the door (5.3 / 5.6)
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, Optional

from .geometry import Point, Rect, Shape, sector_polygon
from .room import Room, Wall

# Angle of the inward normal of each wall, in degrees.
_INWARD_ANGLE = {"south": 90.0, "north": 270.0, "west": 0.0, "east": 180.0}
# Angle of the "increasing position" direction along each wall.
_ALONG_ANGLE = {"south": 0.0, "north": 0.0, "west": 90.0, "east": 90.0}


@dataclass
class Door:
    """A door in one of the room walls."""

    id: str
    wall: str
    position: float          # distance along the wall to the door's near edge
    width: float = 900.0
    swing: str = "inward"    # inward | outward | sliding | none
    hinge: str = "left"      # left = hinged at the lower wall parameter
    is_main: bool = False    # main entrance (drives the circulation check)

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

    def center_point(self, room: Room) -> Point:
        return room.wall(self.wall).point_at(self.middle)

    def inward(self, room: Room):
        return room.wall(self.wall).inward

    def entry_point(self, room: Room, offset: float = 600.0) -> Point:
        """A point just inside the room, in front of the door centre."""
        c = self.center_point(room)
        n = self.inward(room)
        return Point(
            min(max(c[0] + n[0] * offset, 1.0), room.width - 1.0),
            min(max(c[1] + n[1] * offset, 1.0), room.length - 1.0),
        )

    # -- zones -------------------------------------------------------------- #
    def opening_rect(self, room: Room, depth: float = 150.0) -> Rect:
        """The door opening itself, projected a little way into the room."""
        return room.wall(self.wall).band(self.start, self.end, depth)

    def swing_shape(self, room: Room) -> Optional[Shape]:
        """Quarter-disc swept by an inward-opening leaf (None if not inward)."""
        if self.swing != "inward":
            return None
        wall: Wall = room.wall(self.wall)
        hinge_pos = self.start if self.hinge == "left" else self.end
        hinge = wall.point_at(hinge_pos)
        inward_angle = _INWARD_ANGLE[self.wall]
        along = _ALONG_ANGLE[self.wall]
        # the leaf starts flat against the wall, pointing at the other jamb
        leaf_angle = along if self.hinge == "left" else along + 180.0
        start, end = leaf_angle, inward_angle
        # normalise so the sweep is the 90 deg one, not the 270 deg one
        while end - start > 180.0:
            end -= 360.0
        while start - end > 180.0:
            end += 360.0
        return Shape.of(sector_polygon(hinge, self.width, start, end, segments=8))

    def clearance_zone(self, room: Room, depth: float) -> Rect:
        """Keep-clear band across the full door width, `depth` into the room."""
        return room.wall(self.wall).band(self.start, self.end, depth)

    def blocked_zone(self, room: Room, depth: float) -> Shape:
        """Everything that must stay empty for this door: opening + swing + clearance."""
        parts = [self.clearance_zone(room, depth)]
        swing = self.swing_shape(room)
        if swing is not None:
            parts.append(swing)
        return Shape.of(*parts)

    def is_near_corner(self, room: Room, threshold: float = 600.0) -> bool:
        wall_length = room.wall(self.wall).length
        return self.start <= threshold or (wall_length - self.end) <= threshold

    def to_dict(self, room: Room = None, clearance: float = 1000.0) -> Dict:
        data = {
            "id": self.id,
            "wall": self.wall,
            "position": self.position,
            "width": self.width,
            "swing": self.swing,
            "hinge": self.hinge,
            "is_main": self.is_main,
        }
        if room is not None:
            c = self.center_point(room)
            data["center"] = [round(c[0], 1), round(c[1], 1)]
            zone = self.clearance_zone(room, clearance)
            data["clearance_zone"] = [
                round(zone.x0, 1), round(zone.y0, 1),
                round(zone.x1, 1), round(zone.y1, 1),
            ]
            swing = self.swing_shape(room)
            data["swing_area_m2"] = round(swing.area / 1e6, 2) if swing else 0.0
        return data
