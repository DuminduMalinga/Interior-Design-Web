"""
Room and wall models.

Coordinate system (section 3 of the specification)::

    (0, length)                      (width, length)
        +--------- NORTH ---------+
        |                         |
      WEST        LIVING         EAST
        |          ROOM           |
        +--------- SOUTH ---------+
    (0, 0)                          (width, 0)

`x` runs west -> east, `y` runs south -> north.

A wall opening (door or window) is described by `position`, the distance from
the wall's start measured along the wall:

    south / north : from the west end (x = 0)
    west  / east  : from the south end (y = 0)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .geometry import Point, Rect, Shape

WALL_NAMES = ("north", "south", "east", "west")

# inward-pointing unit normal for each wall
WALL_INWARD = {
    "north": (0.0, -1.0),
    "south": (0.0, 1.0),
    "east": (-1.0, 0.0),
    "west": (1.0, 0.0),
}

# rotation (degrees) that makes a piece stand against the wall facing the room
WALL_FACING_ROTATION = {"north": 180, "south": 0, "east": 90, "west": 270}

OPPOSITE_WALL = {"north": "south", "south": "north", "east": "west", "west": "east"}


@dataclass
class WallSegment:
    """A stretch of wall between openings, in wall-parameter space."""

    wall: str
    start: float
    end: float

    @property
    def length(self) -> float:
        return self.end - self.start

    @property
    def middle(self) -> float:
        return (self.start + self.end) / 2.0

    def to_dict(self) -> Dict:
        return {
            "wall": self.wall,
            "start": round(self.start, 1),
            "end": round(self.end, 1),
            "length": round(self.length, 1),
        }


@dataclass
class Wall:
    """One of the four room walls."""

    name: str
    room_width: float
    room_length: float

    @property
    def length(self) -> float:
        return self.room_width if self.name in ("north", "south") else self.room_length

    @property
    def inward(self) -> Tuple[float, float]:
        return WALL_INWARD[self.name]

    @property
    def facing_rotation(self) -> int:
        """Rotation for a piece standing against this wall, facing the room."""
        return WALL_FACING_ROTATION[self.name]

    @property
    def is_horizontal(self) -> bool:
        return self.name in ("north", "south")

    def point_at(self, position: float) -> Point:
        """World point at `position` along the wall."""
        if self.name == "south":
            return Point(position, 0.0)
        if self.name == "north":
            return Point(position, self.room_length)
        if self.name == "west":
            return Point(0.0, position)
        return Point(self.room_width, position)

    def position_of(self, point) -> float:
        """Inverse of `point_at`: the wall parameter nearest to `point`."""
        return point[0] if self.is_horizontal else point[1]

    def band(self, start: float, end: float, depth: float) -> Rect:
        """Rectangle covering [start,end] along the wall, `depth` into the room."""
        if self.name == "south":
            return Rect(start, 0.0, end - start, depth)
        if self.name == "north":
            return Rect(start, self.room_length - depth, end - start, depth)
        if self.name == "west":
            return Rect(0.0, start, depth, end - start)
        return Rect(self.room_width - depth, start, depth, end - start)

    def to_dict(self) -> Dict:
        return {"name": self.name, "length": round(self.length, 1)}


@dataclass
class Room:
    """The living room shell."""

    width: float
    length: float
    height: float = 2800.0
    name: str = "living_room"

    def __post_init__(self):
        self.walls: Dict[str, Wall] = {
            n: Wall(n, self.width, self.length) for n in WALL_NAMES
        }

    # -- geometry ----------------------------------------------------------- #
    @property
    def rect(self) -> Rect:
        return Rect(0.0, 0.0, self.width, self.length)

    @property
    def shape(self) -> Shape:
        return Shape.of(self.rect)

    @property
    def area(self) -> float:
        """Floor area in mm^2."""
        return self.width * self.length

    @property
    def area_m2(self) -> float:
        return self.area / 1_000_000.0

    @property
    def center(self) -> Point:
        return Point(self.width / 2.0, self.length / 2.0)

    @property
    def perimeter(self) -> float:
        return 2 * (self.width + self.length)

    @property
    def aspect_ratio(self) -> float:
        short, long_ = sorted((self.width, self.length))
        return long_ / short if short else 1.0

    def wall(self, name: str) -> Wall:
        return self.walls[name]

    def contains(self, item_shape: Shape, tol: float = 1.0) -> bool:
        room = self.rect
        for part in item_shape.parts:
            x0, y0, x1, y1 = part.bounds
            if not room.contains_rect(Rect.from_bounds(x0, y0, x1, y1), tol):
                return False
        return True

    def corners(self) -> List[Point]:
        return list(self.rect.corners)

    def to_dict(self) -> Dict:
        return {
            "width": self.width,
            "length": self.length,
            "height": self.height,
            "area_m2": round(self.area_m2, 2),
        }
