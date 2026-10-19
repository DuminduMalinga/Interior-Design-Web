"""
Master-bedroom furniture catalogue, the placed-piece record and a whole arrangement.

Sizes are outer footprints in millimetres. `width` always runs along the wall a
piece stands against and `depth` out from that wall, so a bed's `depth` is its
length from headboard to foot.

Heights matter to two rules: rule 12 treats anything from 1.1 m up as tall
furniture, and rule 10 wants the bedside surface level with the mattress.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .geometry import Rect
from .room import FACING_ROTATION


@dataclass(frozen=True)
class Spec:
    type: str
    model: str
    label: str
    width: float
    depth: float
    height: float


#: mattress top - the height a bedside surface should match (rule 10)
MATTRESS_HEIGHT = 550.0

BEDS: Dict[str, Spec] = {
    "single": Spec("bed", "single", "single bed", 950.0, 2000.0, MATTRESS_HEIGHT),
    "double": Spec("bed", "double", "double bed", 1400.0, 2000.0, MATTRESS_HEIGHT),
    "queen": Spec("bed", "queen", "queen bed", 1550.0, 2100.0, MATTRESS_HEIGHT),
    "king": Spec("bed", "king", "king bed", 1850.0, 2100.0, MATTRESS_HEIGHT),
}
#: smallest to largest - a room that cannot take one size falls back to the next one down
BED_ORDER = ("single", "double", "queen", "king")
BED_SLEEPS = {"single": 1, "double": 2, "queen": 2, "king": 2}

WARDROBES: Dict[str, Spec] = {
    "2-door": Spec("wardrobe", "2-door", "2-door wardrobe", 1000.0, 600.0, 2000.0),
    "3-door": Spec("wardrobe", "3-door", "3-door wardrobe", 1500.0, 600.0, 2000.0),
    "4-door": Spec("wardrobe", "4-door", "4-door wardrobe", 2000.0, 600.0, 2000.0),
}
WARDROBE_ORDER = ("2-door", "3-door", "4-door")

BEDSIDE_TABLE = Spec("bedside_table", "standard", "bedside table", 450.0, 400.0, 550.0)
#: the height counts the mirror, so the table is "tall" and never stands in front of a window
DRESSER = Spec("dressing_table", "with mirror", "dressing table", 1100.0, 450.0, 1500.0)
STOOL = Spec("stool", "dressing stool", "dressing stool", 450.0, 400.0, 450.0)
DESK = Spec("desk", "study desk", "study desk", 1100.0, 550.0, 750.0)
DESK_CHAIR = Spec("desk_chair", "desk chair", "desk chair", 500.0, 500.0, 850.0)

#: what a piece is called on the drawn plan, where it differs from its type
ROLE_NAMES = {"dressing_table": "dressing table"}

#: names a caller may use in required / optional / excluded furniture lists
FURNITURE_ALIASES = {
    "bed": "bed",
    "bedside_table": "bedside_table",
    "bedside": "bedside_table",
    "nightstand": "bedside_table",
    "side_table": "bedside_table",
    "wardrobe": "wardrobe",
    "closet": "wardrobe",
    "dressing_table": "dresser",
    "dresser": "dresser",
    "vanity": "dresser",
    "desk": "desk",
    "study_desk": "desk",
    "desk_chair": "desk",
}


@dataclass
class Item:
    """One placed piece of furniture."""

    id: str
    type: str
    model: str
    rect: Rect
    wall: str        # the wall its back stands against
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
            "role": ROLE_NAMES.get(self.type, self.type),    # the name the plan viewer prints on the piece
            "model": self.model,
            "x": round(x0, 1),
            "y": round(y0, 1),
            "width": self.width,
            "depth": self.depth,
            "height": self.height,
            "rotation": FACING_ROTATION[self.facing],
            "facing": self.facing,
            "wall": self.wall,
            "bbox": [round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1)],
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
    """One arrangement, complete or still being built.

    `keep_clear` collects the floor no later piece may stand on: the strip
    beside the bed that an occupant gets in and out by, and the standing room
    in front of the wardrobe and the dressing table.
    """

    bed: Item
    bed_size: str
    anchor: str                         # "open" | "corner_lo" | "corner_hi"
    open_sides: Tuple[str, ...]         # sides ("lo" / "hi") with room to stand beside the bed
    access_sides: Tuple[str, ...]       # the open sides an occupant actually needs
    tables: Tuple[Item, ...] = ()
    wardrobe: Optional[Item] = None
    dresser: Optional[Item] = None
    desk: Optional[Item] = None
    chair: Optional[Item] = None
    keep_clear: Tuple[Tuple[str, Rect], ...] = ()
    pullout: Optional[Rect] = None      # floor the desk chair needs while in use
    unplaced: Tuple[Unplaced, ...] = ()
    compromises: Tuple[str, ...] = ()
    bed_score: float = 0.0              # how well the bed position alone suits the room, 0-100

    @property
    def items(self) -> List[Item]:
        out = [self.bed, *self.tables]
        for extra in (self.wardrobe, self.dresser, self.desk, self.chair):
            if extra is not None:
                out.append(extra)
        return out
