"""
Living-room furniture catalogue, the placed-piece record and a whole arrangement.

Sizes are outer footprints in millimetres: `width` runs across the front of a
piece, `depth` from its front to its back.

Rule 5 chooses between three size classes (`TIERS`); everything in the seating
group comes from one class, so the pieces suit each other as well as the room.

Three kinds of piece come out of the engine:

* the **solid** ones stand on the floor and nobody can walk through them - the
  sofa, the armchairs, the tables, the TV unit, a desk, a bookshelf;
* the **loose** ones are drawn but do not block the way - the rug, chairs
  pushed in under a table or a desk;
* the **television** hangs on the wall above its unit and takes up no floor.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .geometry import Rect
from .room import FACING_ROTATION


@dataclass(frozen=True)
class Spec:
    type: str
    label: str
    width: float
    depth: float
    height: float
    seats: int = 0


@dataclass(frozen=True)
class DiningSpec:
    seats: int
    label: str
    length: float
    width: float
    per_side: int            # chairs along each long side
    height: float = 750.0


@dataclass(frozen=True)
class Tier:
    """One size class of living-room furniture (rule 5)."""

    name: str
    sofa: Spec
    chair: Spec
    coffee: Spec
    console: Spec
    tv_width: float
    max_chairs: int
    side_tables: int
    dining: DiningSpec


SIDE_TABLE = Spec("side_table", "side table", 450.0, 450.0, 550.0)
DINING_TABLES: Tuple[DiningSpec, ...] = (
    DiningSpec(6, "1.8 m dining table for six", 1800.0, 900.0, 3),
    DiningSpec(4, "1.2 m dining table for four", 1200.0, 800.0, 2),
    DiningSpec(2, "0.80 m dining table for two", 800.0, 800.0, 1),
)
DINING_CHAIR = Spec("dining_chair", "dining chair", 450.0, 500.0, 900.0, 1)
DESK = Spec("desk", "1.2 m desk", 1200.0, 600.0, 750.0)
DESK_CHAIR = Spec("desk_chair", "desk chair", 500.0, 500.0, 900.0, 1)
READING_CHAIR = Spec("reading_chair", "reading chair", 800.0, 850.0, 900.0, 1)
LAMP = Spec("lamp", "floor lamp", 350.0, 350.0, 1600.0)
BOOKSHELF = Spec("bookshelf", "bookshelf", 900.0, 350.0, 1800.0)

TIERS: Dict[str, Tier] = {
    "compact": Tier(
        "compact",
        Spec("loveseat", "1.5 m two-seat sofa", 1500.0, 850.0, 850.0, 2),
        Spec("chair", "armchair", 750.0, 800.0, 850.0, 1),
        Spec("coffee_table", "0.90 m coffee table", 900.0, 500.0, 420.0),
        Spec("tv_console", "1.2 m TV unit", 1200.0, 400.0, 500.0),
        1000.0, 1, 1, DINING_TABLES[2]),
    "standard": Tier(
        "standard",
        Spec("sofa", "2.1 m three-seat sofa", 2100.0, 900.0, 850.0, 3),
        Spec("chair", "armchair", 800.0, 850.0, 850.0, 1),
        Spec("coffee_table", "1.1 m coffee table", 1100.0, 600.0, 420.0),
        Spec("tv_console", "1.6 m TV unit", 1600.0, 450.0, 500.0),
        1300.0, 2, 1, DINING_TABLES[1]),
    "generous": Tier(
        "generous",
        Spec("sofa", "2.4 m three-seat sofa", 2400.0, 950.0, 850.0, 3),
        Spec("chair", "armchair", 850.0, 900.0, 850.0, 1),
        Spec("coffee_table", "1.3 m coffee table", 1300.0, 700.0, 420.0),
        Spec("tv_console", "2.0 m TV unit", 2000.0, 450.0, 500.0),
        1500.0, 2, 2, DINING_TABLES[0]),
}
#: largest first - the order the search falls back in
TIER_ORDER: Tuple[str, ...] = ("generous", "standard", "compact")

#: what a piece is called on the drawn plan, where it differs from its type
ROLE_NAMES = {
    "loveseat": "sofa", "chair": "armchair", "tv_console": "tv unit", "tv": "television",
    "dining_table": "dining table", "dining_chair": "chair", "lamp": "floor lamp",
}


@dataclass
class Item:
    """One placed piece."""

    id: str
    type: str
    rect: Rect
    wall: str        # the wall its back is towards
    facing: str      # compass direction its front faces
    width: float
    depth: float
    height: float
    zone: str = "living"                   # "living" | "dining" | "work" | "reading"
    strategy: str = ""
    mounted: str = "floor"                 # "floor" | "wall"
    mount_height: Optional[float] = None
    label: str = ""
    seats: int = 0
    reasons: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict:
        x0, y0, x1, y1 = self.rect
        return {
            "id": self.id,
            "type": self.type,
            "role": ROLE_NAMES.get(self.type, self.type),    # the name the plan viewer prints on the piece
            "label": self.label or self.type.replace("_", " "),
            "zone": self.zone,
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
class Zone:
    """A second activity area in the room (rule 3): dining, work or reading."""

    kind: str                                  # "dining" | "work" | "reading"
    box: Rect                                  # the floor its furniture stands on, chairs pushed in
    use: Rect                                  # ... and with the chairs pulled out: nothing else may stand here
    targets: Tuple[Tuple[str, Rect], ...]      # where someone stands to use it - these must be walkable to


@dataclass(frozen=True)
class Layout:
    """One arrangement, complete or still being built."""

    tier: Tier
    facing: str                            # the way the sofa looks
    arrangement: str                       # "u" | "l_low" | "l_high" | "facing" | "solo"
    offset: float                          # sofa back to the wall behind it
    sofa: Item
    coffee: Item
    chairs: Tuple[Item, ...]
    entry: Rect                            # the open side of the group: where people walk in to sit down
    open_gap: float                        # clear floor on that side, to the TV unit or the wall
    console: Optional[Item] = None
    view: float = 0.0                      # sofa front to the TV
    extras: Tuple[Item, ...] = ()          # solid pieces added once the group stands
    loose: Tuple[Item, ...] = ()           # drawn, but no obstacle: rug, TV, pushed-in chairs
    zones: Tuple[Zone, ...] = ()
    unplaced: Tuple[Unplaced, ...] = ()
    compromises: Tuple[str, ...] = ()
    base_score: float = 0.0                # how the seating group alone does, before the rest and the walk

    @property
    def anchor(self) -> str:
        return "wall" if self.offset < 1.0 else "floating"

    @property
    def group(self) -> List[Item]:
        """The seating group: the pieces rules 1, 2 and 6 are about, and the TV they look at."""
        return [self.sofa, self.coffee] + list(self.chairs) + ([self.console] if self.console is not None else [])

    @property
    def seats(self) -> List[Item]:
        return [self.sofa] + list(self.chairs)

    @property
    def group_box(self) -> Rect:
        """The living zone: the group and the floor it encloses, up to the TV."""
        rects = [item.rect for item in self.group]
        return (min(r[0] for r in rects), min(r[1] for r in rects), max(r[2] for r in rects), max(r[3] for r in rects))

    @property
    def solids(self) -> List[Item]:
        """The pieces nobody can walk through or move out of the way."""
        return self.group + list(self.extras)

    @property
    def items(self) -> List[Item]:
        return self.solids + list(self.loose)

    def find(self, kind: str) -> List[Item]:
        return [item for item in self.items if item.type == kind]

    def zone(self, kind: str) -> Optional[Zone]:
        return next((z for z in self.zones if z.kind == kind), None)
