"""
Room shell: the four walls, the doors and the windows.

Coordinate system (identical to the living-room engine)::

    (0, length)                      (width, length)
        +--------- NORTH ---------+
        |                         |
      WEST         KITCHEN       EAST
        |                         |
        +--------- SOUTH ---------+
    (0, 0)                          (width, 0)

A wall opening is described by `position`, the distance from the wall's low end
measured along the wall: south / north walls run from the west end, west / east
walls from the south end.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

from .geometry import Point, Rect

WALLS = ("north", "east", "south", "west")
OPPOSITE = {"north": "south", "south": "north", "east": "west", "west": "east"}

#: compass name of the (low, high) end of each wall's parameter
WALL_ENDS = {
    "north": ("west", "east"),
    "south": ("west", "east"),
    "west": ("south", "north"),
    "east": ("south", "north"),
}

#: unit vector for each compass direction a piece can face
FACING_VECTOR = {"north": (0.0, 1.0), "south": (0.0, -1.0), "east": (1.0, 0.0), "west": (-1.0, 0.0)}

#: rotation the plan renderer expects for each facing direction
FACING_ROTATION = {"north": 0, "west": 90, "south": 180, "east": 270}


@dataclass(frozen=True)
class Room:
    """The kitchen shell, in millimetres."""

    width: float     # west -> east
    length: float    # south -> north
    height: float = 2800.0
    name: str = "kitchen"

    @property
    def rect(self) -> Rect:
        return (0.0, 0.0, self.width, self.length)

    @property
    def area_m2(self) -> float:
        return self.width * self.length / 1_000_000.0

    def wall_length(self, wall: str) -> float:
        return self.width if wall in ("north", "south") else self.length

    def depth_from(self, wall: str) -> float:
        """How far the room runs straight out from `wall`."""
        return self.length if wall in ("north", "south") else self.width

    def band(self, wall: str, start: float, end: float, depth: float, offset: float = 0.0) -> Rect:
        """Rectangle covering [start, end] along `wall`, from `offset` to `offset + depth` into the room."""
        if wall == "south":
            return (start, offset, end, offset + depth)
        if wall == "north":
            return (start, self.length - offset - depth, end, self.length - offset)
        if wall == "west":
            return (offset, start, offset + depth, end)
        return (self.width - offset - depth, start, self.width - offset, end)

    def point(self, wall: str, position: float, inset: float = 0.0) -> Point:
        """World point at `position` along `wall`, `inset` millimetres into the room."""
        if wall == "south":
            return (position, inset)
        if wall == "north":
            return (position, self.length - inset)
        if wall == "west":
            return (inset, position)
        return (self.width - inset, position)

    def along(self, wall: str, r: Rect) -> Tuple[float, float]:
        """The stretch of `wall` that `r` lines up with."""
        return (r[0], r[2]) if wall in ("north", "south") else (r[1], r[3])

    def out_from(self, wall: str, r: Rect) -> Tuple[float, float]:
        """Distance of the near and far face of `r` from `wall`."""
        if wall == "south":
            return (r[1], r[3])
        if wall == "north":
            return (self.length - r[3], self.length - r[1])
        if wall == "west":
            return (r[0], r[2])
        return (self.width - r[2], self.width - r[0])

    def to_dict(self) -> Dict:
        return {
            "width": round(self.width, 1),
            "length": round(self.length, 1),
            "height": self.height,
            "area_m2": round(self.area_m2, 2),
        }


@dataclass
class Door:
    """A door in one of the room walls."""

    id: str
    wall: str
    position: float
    width: float = 900.0
    swing: str = "inward"        # inward | outward | sliding
    hinge: str = "left"          # left = hinged at the low end of the wall parameter
    swing_known: bool = False    # False when the plan did not say and inward was assumed
    hinge_known: bool = False
    is_main: bool = False        # the kitchen entrance
    leads_to: Optional[str] = None

    @property
    def start(self) -> float:
        return self.position

    @property
    def end(self) -> float:
        return self.position + self.width

    @property
    def middle(self) -> float:
        return self.position + self.width / 2.0

    def center(self, room: Room) -> Point:
        return room.point(self.wall, self.middle)

    def opening(self, room: Room) -> Rect:
        """The doorway itself: a zero-depth strip on the wall line."""
        return room.band(self.wall, self.start, self.end, 0.0)

    def keep_clear_depth(self, entry_depth: float) -> float:
        """Rule 3: an inward leaf sweeps a full door-width into the room."""
        return max(entry_depth, self.width) if self.swing == "inward" else entry_depth

    def keep_clear(self, room: Room, entry_depth: float) -> Rect:
        """Everything that must stay empty for this door: the landing plus the leaf's sweep.

        The sweep is taken as the whole door-width square rather than a quarter
        circle, which covers the leaf whichever jamb it is hinged on - a plan
        rarely says, and a unit must not turn out to be behind the door.
        """
        return room.band(self.wall, self.start, self.end, self.keep_clear_depth(entry_depth))

    def to_dict(self, room: Room, entry_depth: float) -> Dict:
        c = self.center(room)
        zone = self.keep_clear(room, entry_depth)
        return {
            "id": self.id,
            "wall": self.wall,
            "position": round(self.position, 1),
            "width": round(self.width, 1),
            "swing": self.swing,
            "hinge": self.hinge,
            "is_main": self.is_main,
            "swing_known": self.swing_known,
            "hinge_known": self.hinge_known,
            "leads_to": self.leads_to,
            "center": [round(c[0], 1), round(c[1], 1)],
            "clearance_zone": [round(v, 1) for v in zone],
            "swing_area_m2": round(math.pi * self.width ** 2 / 4e6, 2) if self.swing == "inward" else 0.0,
        }


@dataclass
class Window:
    """A window in one of the room walls. Windows also stand in for ventilation openings."""

    id: str
    wall: str
    position: float
    width: float = 1200.0
    height: float = 1200.0
    sill_height: float = 900.0

    @property
    def start(self) -> float:
        return self.position

    @property
    def end(self) -> float:
        return self.position + self.width

    def access(self, room: Room, depth: float) -> Rect:
        """Band in front of the window that light, air and a hand on the latch need."""
        return room.band(self.wall, self.start, self.end, depth)

    def to_dict(self, room: Room, depth: float) -> Dict:
        c = room.point(self.wall, self.position + self.width / 2.0)
        zone = self.access(room, depth)
        wall_length = room.wall_length(self.wall)
        return {
            "id": self.id,
            "wall": self.wall,
            "position": round(self.position, 1),
            "width": round(self.width, 1),
            "height": self.height,
            "sill_height": self.sill_height,
            "center": [round(c[0], 1), round(c[1], 1)],
            "access_zone": [round(v, 1) for v in zone],
            "wall_coverage": round(self.width / wall_length, 2) if wall_length else 0.0,
        }
