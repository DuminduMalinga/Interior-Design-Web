"""
Furniture specifications and placed furniture instances.

`FURNITURE_DB` is the default catalogue (section 4 of the specification).  It
can be extended or overridden from the input JSON through
`furniture_overrides`, so new furniture types never require a code change.

Rotation convention
-------------------
`rotation` is counter-clockwise degrees, restricted to 0 / 90 / 180 / 270.
A piece at rotation 0 *faces north* (+y); its back is on the low-y side.

    rotation   facing      bbox extent
    --------   --------    ------------------
    0          (0, +1)     (width, depth)
    90         (-1, 0)     (depth, width)
    180        (0, -1)     (width, depth)
    270        (+1, 0)     (depth, width)

`x` / `y` are the minimum corner of the axis-aligned bounding box, which is what
the output JSON reports.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .geometry import Point, Rect, Shape

# Furniture taller than this is treated as "tall" and may not stand in front of
# a window (see rules/window_rules.py).  Mirrors Clearances.window_tall_...
TALL_THRESHOLD = 1100.0

ROTATIONS = (0, 90, 180, 270)


# --------------------------------------------------------------------------- #
# Catalogue
# --------------------------------------------------------------------------- #
FURNITURE_DB: Dict[str, Dict] = {
    "sofa": {
        "width": 2200, "depth": 900, "height": 850,
        "category": "seating", "seats": 3,
        "prefers_wall": True, "front_clearance": 400, "allow_near_window": True,
    },
    "loveseat": {
        "width": 1600, "depth": 900, "height": 850,
        "category": "seating", "seats": 2,
        "prefers_wall": True, "front_clearance": 400, "allow_near_window": True,
    },
    "l_sofa": {
        "width": 2800, "depth": 2200, "height": 850,
        "shape": "l", "leg_depth": 900,
        "category": "seating", "seats": 5,
        "prefers_wall": True, "front_clearance": 400, "allow_near_window": True,
    },
    "chair": {
        "width": 800, "depth": 800, "height": 900,
        "category": "seating", "seats": 1,
        "prefers_wall": False, "front_clearance": 300, "allow_near_window": True,
    },
    "reading_chair": {
        "width": 850, "depth": 850, "height": 1000,
        "category": "seating", "seats": 1,
        "prefers_wall": False, "front_clearance": 300, "allow_near_window": True,
    },
    "coffee_table": {
        "width": 1200, "depth": 600, "height": 450,
        "category": "table",
        "prefers_wall": False, "front_clearance": 0, "allow_near_window": True,
    },
    "side_table": {
        "width": 500, "depth": 500, "height": 550,
        "category": "table",
        "prefers_wall": False, "front_clearance": 0, "allow_near_window": True,
    },
    "tv": {
        "width": 1200, "depth": 100, "height": 700,
        "category": "media", "wall_mounted": True,
        "requires_wall": True, "front_clearance": 0, "allow_near_window": False,
    },
    "tv_console": {
        "width": 1800, "depth": 450, "height": 600,
        "category": "media",
        "prefers_wall": True, "requires_wall": True,
        "front_clearance": 0, "allow_near_window": True,
    },
    "bookshelf": {
        "width": 900, "depth": 350, "height": 2000,
        "category": "storage",
        "prefers_wall": True, "requires_wall": True,
        "front_clearance": 750, "allow_near_window": False,
    },
    "storage_cabinet": {
        "width": 1000, "depth": 450, "height": 800,
        "category": "storage",
        "prefers_wall": True, "requires_wall": True,
        "front_clearance": 600, "allow_near_window": True,
    },
    "desk": {
        "width": 1200, "depth": 600, "height": 750,
        "category": "work",
        "prefers_wall": True, "front_clearance": 750, "allow_near_window": True,
    },
    "desk_chair": {
        "width": 600, "depth": 600, "height": 900,
        "category": "seating", "seats": 1,
        "prefers_wall": False, "front_clearance": 0, "allow_near_window": True,
    },
    "lamp": {
        "width": 400, "depth": 400, "height": 1500,
        "category": "lighting", "slim": True,
        "prefers_wall": False, "front_clearance": 0, "allow_near_window": True,
    },
    "rug": {
        "width": 2400, "depth": 1700, "height": 10,
        "category": "soft", "flat": True,
        "prefers_wall": False, "front_clearance": 0, "allow_near_window": True,
    },
    # A dining table with its chairs pushed in, placed as one piece so the
    # chairs can never be separated from the table: `width` is the table
    # length, `depth` the table plus a row of chairs on each long side.  The
    # output JSON lists the table and every chair separately (`output_dicts`).
    "dining_set": {
        "width": 1200, "depth": 1700, "height": 750,
        "category": "dining", "seats": 4,
        "prefers_wall": False, "front_clearance": 0, "allow_near_window": True,
    },
}

#: floor a pushed-in dining chair takes beyond the table edge, and its width
DINING_CHAIR_DEPTH = 450.0
DINING_CHAIR_WIDTH = 450.0
DINING_CHAIR_HEIGHT = 900.0

# Pieces that are allowed to share floor space (a TV stands on its console, a
# lamp stands beside/behind a side table).  Checked in both orders.
OVERLAP_EXEMPT: Tuple[Tuple[str, str], ...] = (
    ("tv", "tv_console"),
    ("rug", "*"),
)


def _matches(pattern: str, type_name: str) -> bool:
    return pattern == "*" or pattern == type_name


def overlap_exempt(type_a: str, type_b: str) -> bool:
    """True when two furniture types are allowed to share floor space."""
    for a, b in OVERLAP_EXEMPT:
        if _matches(a, type_a) and _matches(b, type_b):
            return True
        if _matches(a, type_b) and _matches(b, type_a):
            return True
    return False


# --------------------------------------------------------------------------- #
# Specification
# --------------------------------------------------------------------------- #
@dataclass
class FurnitureSpec:
    """Static description of a furniture type."""

    type: str
    width: float
    depth: float
    height: float
    category: str = "misc"
    shape: str = "rect"
    leg_depth: float = 900.0
    seats: int = 0
    prefers_wall: bool = False
    requires_wall: bool = False
    wall_mounted: bool = False
    front_clearance: float = 0.0
    allow_near_window: bool = True
    slim: bool = False
    flat: bool = False

    @property
    def is_tall(self) -> bool:
        """Tall pieces block daylight and may not stand in front of a window."""
        return self.height >= TALL_THRESHOLD and not self.slim

    @property
    def is_seating(self) -> bool:
        return self.category == "seating"

    @property
    def footprint_area(self) -> float:
        return self.width * self.depth

    # local (unrotated) convex parts, in a [0,width] x [0,depth] frame
    def local_parts(self, variant: str = "left") -> List[Tuple[float, float, float, float]]:
        if self.shape == "l":
            leg = min(self.leg_depth, self.depth)
            parts = [(0.0, 0.0, self.width, leg)]  # main run, back on the y=0 side
            if variant == "right":
                parts.append((self.width - leg, leg, self.width, self.depth))
            else:
                parts.append((0.0, leg, leg, self.depth))
            return parts
        return [(0.0, 0.0, self.width, self.depth)]


class FurnitureCatalogue:
    """Look-up for furniture specs, with per-run JSON overrides."""

    def __init__(self, overrides: Optional[Dict[str, Dict]] = None):
        data = copy.deepcopy(FURNITURE_DB)
        for name, spec in (overrides or {}).items():
            base = data.get(name, {})
            base.update(spec)
            data[name] = base
        self._data = data

    def has(self, type_name: str) -> bool:
        return type_name in self._data

    def types(self) -> List[str]:
        return sorted(self._data)

    def spec(self, type_name: str) -> FurnitureSpec:
        if type_name not in self._data:
            raise KeyError("unknown furniture type: {}".format(type_name))
        raw = dict(self._data[type_name])
        allowed = FurnitureSpec.__dataclass_fields__.keys()
        clean = {k: v for k, v in raw.items() if k in allowed}
        return FurnitureSpec(type=type_name, **clean)

    def as_dict(self) -> Dict[str, Dict]:
        return copy.deepcopy(self._data)


# --------------------------------------------------------------------------- #
# Placed instance
# --------------------------------------------------------------------------- #
@dataclass
class Furniture:
    """A furniture item placed in the room."""

    id: str
    spec: FurnitureSpec
    x: float
    y: float
    rotation: int = 0
    variant: str = "left"           # L-shaped pieces: which side the chaise is on
    role: str = ""                  # semantic role inside the layout plan
    strategy: str = ""              # candidate-generation strategy that produced it
    reasons: List[str] = field(default_factory=list)

    # -- convenience -------------------------------------------------------- #
    @property
    def type(self) -> str:
        return self.spec.type

    @property
    def width(self) -> float:
        return self.spec.width

    @property
    def depth(self) -> float:
        return self.spec.depth

    @property
    def extent(self) -> Tuple[float, float]:
        """Axis-aligned (dx, dy) footprint size at the current rotation."""
        if self.rotation in (90, 270):
            return (self.spec.depth, self.spec.width)
        return (self.spec.width, self.spec.depth)

    @property
    def bbox(self) -> Rect:
        dx, dy = self.extent
        return Rect(self.x, self.y, dx, dy)

    @property
    def center(self) -> Point:
        return self.bbox.center

    @property
    def facing(self) -> Tuple[float, float]:
        return {0: (0.0, 1.0), 90: (-1.0, 0.0), 180: (0.0, -1.0), 270: (1.0, 0.0)}[
            self.rotation % 360
        ]

    @property
    def back_direction(self) -> Tuple[float, float]:
        f = self.facing
        return (-f[0], -f[1])

    # -- geometry ----------------------------------------------------------- #
    def _to_world(self, lx: float, ly: float) -> Tuple[float, float]:
        w, d = self.spec.width, self.spec.depth
        r = self.rotation % 360
        if r == 0:
            ox, oy = lx, ly
        elif r == 90:
            ox, oy = d - ly, lx
        elif r == 180:
            ox, oy = w - lx, d - ly
        else:  # 270
            ox, oy = ly, w - lx
        return (self.x + ox, self.y + oy)

    def footprint(self) -> Shape:
        rects = []
        for (lx0, ly0, lx1, ly1) in self.spec.local_parts(self.variant):
            corners = [
                self._to_world(lx0, ly0),
                self._to_world(lx1, ly0),
                self._to_world(lx1, ly1),
                self._to_world(lx0, ly1),
            ]
            xs = [c[0] for c in corners]
            ys = [c[1] for c in corners]
            rects.append(Rect.from_bounds(min(xs), min(ys), max(xs), max(ys)))
        return Shape.of(*rects)

    def part_rects(self) -> List[Rect]:
        return [Rect.from_bounds(*p.bounds) for p in self.footprint().parts]

    def front_zone(self, depth: float) -> Rect:
        """Rectangle of `depth` directly in front of the piece (its use space)."""
        box = self.bbox
        f = self.facing
        if f == (0.0, 1.0):
            return Rect(box.x0, box.y1, box.width, depth)
        if f == (0.0, -1.0):
            return Rect(box.x0, box.y0 - depth, box.width, depth)
        if f == (1.0, 0.0):
            return Rect(box.x1, box.y0, depth, box.height)
        return Rect(box.x0 - depth, box.y0, depth, box.height)

    def front_center(self, offset: float = 0.0) -> Point:
        """Centre of the front face, pushed `offset` further forward."""
        box = self.bbox
        f = self.facing
        # half of the extent measured *along* the facing direction
        half = (box.height if f[1] else box.width) / 2.0
        return Point(
            box.cx + f[0] * (half + offset),
            box.cy + f[1] * (half + offset),
        )

    def seat_point(self) -> Point:
        """Where a person sits / the visual centre of the useful part."""
        if self.spec.shape == "l":
            return self.footprint().centroid
        return self.center

    # -- serialisation ------------------------------------------------------ #
    def to_dict(self) -> Dict:
        data = {
            "id": self.id,
            "type": self.type,
            "role": self.role or self.type,
            "x": round(self.x, 1),
            "y": round(self.y, 1),
            "width": self.spec.width,
            "depth": self.spec.depth,
            "height": self.spec.height,
            "rotation": self.rotation,
            "facing": {0: "north", 90: "west", 180: "south", 270: "east"}[
                self.rotation % 360
            ],
            "bbox": [
                round(self.bbox.x0, 1), round(self.bbox.y0, 1),
                round(self.bbox.x1, 1), round(self.bbox.y1, 1),
            ],
            "placement_strategy": self.strategy,
            "reasons": list(self.reasons),
        }
        if self.spec.shape == "l":
            data["shape"] = "l"
            data["variant"] = self.variant
            data["parts"] = [
                [round(r.x0, 1), round(r.y0, 1), round(r.x1, 1), round(r.y1, 1)]
                for r in self.part_rects()
            ]
        return data

    def _local_rect(self, lx0: float, ly0: float, lx1: float, ly1: float) -> Rect:
        """A rectangle given in the piece's own unrotated frame, in room coordinates."""
        (ax, ay), (bx, by) = self._to_world(lx0, ly0), self._to_world(lx1, ly1)
        return Rect.from_bounds(ax, ay, bx, by)

    def table_rect(self) -> Rect:
        """The table itself: for a dining set, the footprint without its chairs."""
        if self.type != "dining_set":
            return self.bbox
        return self._local_rect(0.0, DINING_CHAIR_DEPTH, self.spec.width, self.spec.depth - DINING_CHAIR_DEPTH)

    def output_dicts(self) -> List[Dict]:
        """The piece as the output JSON lists it: a dining set becomes its table and chairs."""
        if self.type != "dining_set":
            return [self.to_dict()]
        names = {0: "north", 90: "west", 180: "south", 270: "east"}

        # the short names the plan viewer prints on the pieces, as the dining service gives them
        roles = {"dining_table": "dining table", "dining_chair": "chair"}

        def entry(ident: str, type_name: str, rect: Rect, rotation: int, height: float, reasons: List[str]) -> Dict:
            turned = rotation in (90, 270)
            return {
                "id": ident, "type": type_name, "role": roles[type_name],
                "x": round(rect.x0, 1), "y": round(rect.y0, 1),
                "width": round(rect.height if turned else rect.width, 1),
                "depth": round(rect.width if turned else rect.height, 1),
                "height": height, "rotation": rotation, "facing": names[rotation],
                "bbox": [round(rect.x0, 1), round(rect.y0, 1), round(rect.x1, 1), round(rect.y1, 1)],
                "placement_strategy": self.strategy, "reasons": reasons,
            }

        width, depth = self.spec.width, self.spec.depth
        per_side = max(1, int(self.spec.seats) // 2)
        out = [entry(self.id, "dining_table", self.table_rect(), self.rotation % 360,
                     self.spec.height, list(self.reasons))]
        seat = 0
        # the row on the piece's back edge faces the table (the piece's own facing), the far row faces back
        for y0, turn in ((0.0, 0), (depth - DINING_CHAIR_DEPTH, 180)):
            for index in range(per_side):
                seat += 1
                x0 = width * (index + 0.5) / per_side - DINING_CHAIR_WIDTH / 2.0
                out.append(entry(
                    "{}_chair_{}".format(self.id, seat), "dining_chair",
                    self._local_rect(x0, y0, x0 + DINING_CHAIR_WIDTH, y0 + DINING_CHAIR_DEPTH),
                    (self.rotation + turn) % 360, DINING_CHAIR_HEIGHT,
                    ["Dining chair, drawn pushed in under the table"]))
        return out

    def clone(self, **changes) -> "Furniture":
        item = Furniture(
            id=self.id, spec=self.spec, x=self.x, y=self.y,
            rotation=self.rotation, variant=self.variant,
            role=self.role, strategy=self.strategy, reasons=list(self.reasons),
        )
        for key, value in changes.items():
            setattr(item, key, value)
        return item
