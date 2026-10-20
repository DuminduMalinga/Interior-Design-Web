"""
Dining furniture catalogue, the placed-piece record and a whole arrangement.

Sizes are outer footprints in millimetres. A table's `length` is its long side;
which way that runs in the room is the layout's `axis`.

Three kinds of piece come out of the engine:

* the **table** and the **sideboard** stand on the floor and are searched for;
* the **chairs** follow from the table - one every seat-width along each side
  that has them, drawn pushed in;
* the **pendant lights** hang over the table (rule 10) and take up no floor.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .geometry import Rect
from .room import FACING_ROTATION


@dataclass(frozen=True)
class TableSpec:
    seats: int
    label: str
    length: float
    width: float
    per_side: int            # chairs along each long side
    ends: int                # chairs at each end (0 or 1)
    height: float = 750.0


TABLES: Dict[int, TableSpec] = {
    2: TableSpec(2, "0.80 m square table for two", 800.0, 800.0, 1, 0),
    4: TableSpec(4, "1.2 m table for four", 1200.0, 800.0, 2, 0),
    6: TableSpec(6, "1.8 m table for six", 1800.0, 900.0, 3, 0),
    8: TableSpec(8, "2.2 m table for eight", 2200.0, 1000.0, 3, 1),
}
SEAT_COUNTS = (2, 4, 6, 8)


@dataclass(frozen=True)
class Spec:
    type: str
    model: str
    label: str
    width: float
    depth: float
    height: float


CHAIR = Spec("dining_chair", "side chair", "dining chair", 450.0, 500.0, 900.0)
SIDEBOARDS: Tuple[Spec, ...] = (
    Spec("sideboard", "1400", "1.4 m sideboard", 1400.0, 450.0, 850.0),
    Spec("sideboard", "1000", "1.0 m sideboard", 1000.0, 400.0, 850.0),
)
PENDANT_SIZE = 300.0

#: what a piece is called on the drawn plan, where it differs from its type
ROLE_NAMES = {"dining_table": "table", "dining_chair": "chair"}


@dataclass
class Item:
    """One placed piece."""

    id: str
    type: str
    model: str
    rect: Rect
    wall: str        # the wall its back is towards
    facing: str      # compass direction its front faces
    width: float
    depth: float
    height: float
    strategy: str = ""
    mounted: str = "floor"                 # "floor" | "ceiling"
    mount_height: Optional[float] = None
    label: str = ""
    reasons: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict:
        x0, y0, x1, y1 = self.rect
        return {
            "id": self.id,
            "type": self.type,
            "role": ROLE_NAMES.get(self.type, self.type),    # the name the plan viewer prints on the piece
            "model": self.model,
            "label": self.label or self.type.replace("_", " "),
            "x": round(x0, 1),
            "y": round(y0, 1),
            "width": round(self.width, 1),
            "depth": round(self.depth, 1),
            "height": self.height,
            "rotation": FACING_ROTATION[self.facing],
            "facing": self.facing,
            "wall": self.wall,
            "bbox": [round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1)],
            "mounted": self.mounted,
            "mount_height": self.mount_height,
            "placement_strategy": self.strategy,
            "reasons": list(self.reasons),
        }


@dataclass(frozen=True)
class Unplaced:
    """A planned piece the room had no legal position for."""

    type: str
    label: str
    required: bool
    reasons: Tuple[str, ...] = ()

    def to_dict(self) -> Dict:
        return {
            "type": self.type,
            "role": ROLE_NAMES.get(self.type, self.type),
            "label": self.label,
            "required": self.required,
            "reasons": list(self.reasons),
        }


@dataclass(frozen=True)
class Layout:
    """One arrangement, complete or still being built."""

    spec: TableSpec
    table: Item
    axis: str                              # "ew" | "ns": the way the table's long side runs
    chair_sides: Tuple[str, ...]           # compass sides of the table that have chairs
    chairs: Tuple[Item, ...]               # drawn pushed in
    region: str                            # "centre", "north", "south-west", ...
    sideboard: Optional[Item] = None
    sideboard_front: Optional[Rect] = None
    lights: Tuple[Item, ...] = ()
    unplaced: Tuple[Unplaced, ...] = ()
    compromises: Tuple[str, ...] = ()
    base_score: float = 0.0                # how the table position alone does, before the sideboard and the walk

    @property
    def solids(self) -> List[Item]:
        """The pieces nobody can walk through or move out of the way."""
        return [self.table] + ([self.sideboard] if self.sideboard is not None else [])

    @property
    def items(self) -> List[Item]:
        return self.solids + list(self.chairs) + list(self.lights)
