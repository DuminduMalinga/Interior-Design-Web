"""
Kitchen units: appliance sizes, the dining table, and the records the engine passes around.

Sizes are outer footprints in millimetres. `width` always runs along the wall a
unit stands against and `depth` out from it. `door` is how far the unit's door
reaches into the aisle when it is open - the refrigerator's leaf, the oven's
drop-down door - which rules 6, 7 and 12 need.

Appliances come in three size classes; rule 12 ("consider appliance dimensions
... and available floor space") picks the class from the floor area and falls
back to a smaller one when a kitchen shape cannot take it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .geometry import Point, Rect
from .room import FACING_ROTATION

#: worktop height - a base unit may stand under a window whose sill is no lower
COUNTER_HEIGHT = 900.0


@dataclass(frozen=True)
class Spec:
    type: str
    model: str
    label: str
    width: float
    depth: float
    height: float
    door: float = 0.0


#: smallest first - a shape that cannot take one class falls back to the one before it
SIZE_CLASSES = ("compact", "standard", "large")

APPLIANCES: Dict[str, Dict[str, Spec]] = {
    "compact": {
        "sink": Spec("sink", "single bowl", "single-bowl sink", 600.0, 600.0, COUNTER_HEIGHT),
        "stove": Spec("stove", "4-burner", "0.60 m cooker", 600.0, 600.0, COUNTER_HEIGHT, door=500.0),
        "fridge": Spec("fridge", "compact", "compact refrigerator", 600.0, 650.0, 1700.0, door=600.0),
    },
    "standard": {
        "sink": Spec("sink", "bowl and drainer", "sink with drainer", 900.0, 600.0, COUNTER_HEIGHT),
        "stove": Spec("stove", "4-burner", "0.60 m cooker", 600.0, 600.0, COUNTER_HEIGHT, door=500.0),
        "fridge": Spec("fridge", "single door", "refrigerator", 700.0, 700.0, 1800.0, door=700.0),
    },
    "large": {
        "sink": Spec("sink", "double bowl", "double-bowl sink", 1200.0, 600.0, COUNTER_HEIGHT),
        "stove": Spec("stove", "range", "0.90 m range cooker", 900.0, 600.0, COUNTER_HEIGHT, door=500.0),
        "fridge": Spec("fridge", "double door", "double-door refrigerator", 900.0, 750.0, 1800.0, door=450.0),
    },
}

#: seats -> (length, width) of the dining table; chairs stand along the two long sides
TABLES: Dict[int, Tuple[float, float]] = {2: (800.0, 800.0), 4: (1200.0, 800.0), 6: (1800.0, 900.0)}
TABLE_HEIGHT = 750.0
CHAIR_SIZE = 450.0
CHAIR_HEIGHT = 850.0

#: names a caller may use in required / optional / excluded furniture lists
FURNITURE_ALIASES = {
    "dining_table": "dining_table",
    "dining": "dining_table",
    "table": "dining_table",
    "table_and_chairs": "dining_table",
}


@dataclass
class Item:
    """One drawn piece: an appliance, a stretch of worktop, the table or a chair."""

    id: str
    type: str
    role: str        # the name the plan viewer prints on the piece
    model: str
    rect: Rect
    wall: str        # the wall its back stands against ("" for the table and chairs)
    facing: str      # compass direction its front faces
    width: float
    depth: float
    height: float
    strategy: str = ""
    reasons: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict:
        x0, y0, x1, y1 = self.rect
        return {
            "id": self.id,
            "type": self.type,
            "role": self.role,
            "model": self.model,
            "x": round(x0, 1),
            "y": round(y0, 1),
            "width": round(self.width, 1),
            "depth": round(self.depth, 1),
            "height": self.height,
            "rotation": FACING_ROTATION[self.facing],
            "facing": self.facing,
            "wall": self.wall,
            "bbox": [round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1)],
            "placement_strategy": self.strategy,
            "reasons": list(self.reasons),
        }


@dataclass(frozen=True)
class Station:
    """The sink, the stove or the refrigerator, placed."""

    kind: str                # "sink" | "stove" | "fridge"
    spec: Spec
    rect: Rect
    wall: str
    chain: int               # which counter run it belongs to; -1 when it stands on its own
    s0: float = 0.0          # where it sits along that run
    s1: float = 0.0
    front: Point = (0.0, 0.0)   # centre of its front edge - where someone using it stands
    t0: float = 0.0          # the stretch of wall it covers
    t1: float = 0.0


@dataclass(frozen=True)
class Stretch:
    """A continuous length of worktop between two appliances, or between one and the end of the run."""

    chain: int
    s0: float
    s1: float
    touches: Tuple[str, ...] = ()    # the stations at its two ends
    role: str = "counter"            # "prep" | "ready" | "counter"

    @property
    def length(self) -> float:
        return self.s1 - self.s0


@dataclass(frozen=True)
class Dining:
    """The dining table with its chairs, and the floor they need."""

    seats: int
    table: Rect
    chairs: Tuple[Rect, ...]
    seated: Rect             # table plus chairs with people in them
    pullout: Rect            # ... plus the floor to push a chair back
    along: str               # "x" or "y": the direction the table's long side runs


@dataclass(frozen=True)
class Unplaced:
    """A planned piece the kitchen had no legal position for."""

    type: str
    label: str
    required: bool
    reasons: Tuple[str, ...] = ()

    def to_dict(self) -> Dict:
        return {
            "type": self.type,
            "role": self.label,
            "label": self.label,
            "required": self.required,
            "reasons": list(self.reasons),
        }


@dataclass(frozen=True)
class Layout:
    """One finished kitchen."""

    arrangement: object               # runs.Arrangement
    size_class: str
    sink: Station
    stove: Station
    fridge: Station
    stretches: Tuple[Stretch, ...]
    items: Tuple[Item, ...]
    aisles: Tuple[Rect, ...] = ()     # the floor in front of the runs that must stay clear
    dining: Optional[Dining] = None
    drawers: Optional[Item] = None    # the utensil drawers (rule 8)
    drawers_on_prep: bool = False     # ... and whether they sit under the preparation worktop
    unplaced: Tuple[Unplaced, ...] = ()

    @property
    def stations(self) -> Tuple[Station, Station, Station]:
        return (self.sink, self.stove, self.fridge)
