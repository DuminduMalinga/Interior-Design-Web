"""
Bathroom fixture catalogue, the placed-piece record and a whole arrangement.

Sizes are outer footprints in millimetres. `width` always runs along the wall a
piece stands against and `depth` out from that wall.

Two kinds of piece come out of the engine:

* **floor** fixtures - shower, toilet, washbasin, storage cabinet. They take up
  floor, so the search places them and every clearance is measured from them;
* **wall** fittings - mirror, towel rail, grab bars - and the floor **drain**.
  They take up no floor: they are fixed where the floor fixtures put them, and
  are drawn on the plan as thin strips against their wall.
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
    doors: bool = False      # a cupboard under it whose doors open over the floor
    level: bool = False      # shower only: no tray or kerb to step over


SHOWERS: Dict[str, Spec] = {
    "walk_in": Spec("shower", "walk_in", "1200 x 900 walk-in shower", 1200.0, 900.0, 2000.0),
    "standard": Spec("shower", "standard", "900 x 900 shower", 900.0, 900.0, 2000.0),
    "compact": Spec("shower", "compact", "800 x 800 shower", 800.0, 800.0, 2000.0),
    "minimum": Spec("shower", "minimum", "760 x 760 shower", 760.0, 760.0, 2000.0),
    "level_access": Spec("shower", "level_access", "1200 x 1200 level-access shower", 1200.0, 1200.0, 2000.0,
                         level=True),
    "level_access_small": Spec("shower", "level_access_small", "1000 x 1000 level-access shower",
                               1000.0, 1000.0, 2000.0, level=True),
    "level_access_tight": Spec("shower", "level_access_tight", "900 x 900 level-access shower",
                               900.0, 900.0, 2000.0, level=True),
}

TOILETS: Dict[str, Spec] = {
    "standard": Spec("toilet", "standard", "close-coupled toilet", 400.0, 700.0, 800.0),
    "compact": Spec("toilet", "compact", "short-projection toilet", 380.0, 620.0, 800.0),
    "comfort_height": Spec("toilet", "comfort_height", "comfort-height toilet", 400.0, 700.0, 850.0),
}

BASINS: Dict[str, Spec] = {
    "vanity_900": Spec("washbasin", "vanity_900", "0.90 m vanity basin", 900.0, 500.0, 850.0, doors=True),
    "vanity_600": Spec("washbasin", "vanity_600", "0.60 m vanity basin", 600.0, 460.0, 850.0, doors=True),
    "wall_hung": Spec("washbasin", "wall_hung", "0.45 m wall-hung basin", 450.0, 350.0, 850.0),
    "accessible": Spec("washbasin", "accessible", "0.60 m wall-hung basin with knee space", 600.0, 450.0, 800.0),
}

CABINET = Spec("bathroom_cabinet", "tall", "tall storage cabinet", 400.0, 350.0, 1800.0, doors=True)

#: what a piece is called on the drawn plan, where it differs from its type
ROLE_NAMES = {"washbasin": "basin", "bathroom_cabinet": "cabinet"}


@dataclass(frozen=True)
class Level:
    """One choice of fixtures; a room that cannot take it falls back to the next."""

    name: str
    shower: Optional[str]
    toilet: str
    basin: str

    def describe(self, cabinet: bool) -> str:
        parts = [SHOWERS[self.shower].label] if self.shower else []
        parts += [TOILETS[self.toilet].label, BASINS[self.basin].label]
        if cabinet:
            parts.append(CABINET.label)
        return ", ".join(parts)


LEVELS: Dict[str, Level] = {
    "large": Level("large", "walk_in", "standard", "vanity_900"),
    "standard": Level("standard", "standard", "standard", "vanity_600"),
    "compact": Level("compact", "compact", "compact", "wall_hung"),
    "minimum": Level("minimum", "minimum", "compact", "wall_hung"),
    "accessible": Level("accessible", "level_access", "comfort_height", "accessible"),
    "accessible_compact": Level("accessible_compact", "level_access_small", "comfort_height", "accessible"),
    "accessible_tight": Level("accessible_tight", "level_access_tight", "comfort_height", "accessible"),
}


@dataclass
class Item:
    """One placed fixture or fitting."""

    id: str
    type: str
    model: str
    rect: Rect
    wall: str        # the wall its back is against
    facing: str      # compass direction its front faces
    width: float
    depth: float
    height: float
    strategy: str = ""
    mounted: str = "floor"                 # "floor" | "wall" | "drain"
    mount_height: Optional[float] = None   # wall fittings: height of the fixing above the floor
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
class Fitout:
    """Everything fixed to the walls and the floor once the fixtures stand (rules 8-10, 14, 15)."""

    mirror: str = "none"                       # "above" | "beside" | "none"
    towel_rail_reach: Optional[float] = None   # from where one steps out of the shower; None = no rail
    towel_ring_reach: Optional[float] = None   # from where one stands at the basin; None = on the basin itself
    roll_holder: str = "stand"                 # "wall" | "fixture" | "stand"
    toilet_bar: str = ""                       # "wall" | "drop_down" | "" (no bars asked for)
    shower_bar: bool = False
    drain: Tuple[float, float] = (0.0, 0.0)
    drain_in_shower: bool = False
    items: Tuple[Item, ...] = ()


@dataclass(frozen=True)
class Layout:
    """One arrangement, complete or still being built.

    Each fixture carries a `zone`: the floor that must stay free of every other
    fixture for it to be usable - elbow room at its sides and standing room in
    front. Zones may overlap each other (one person uses the room at a time) but
    no fixture may stand in one.
    """

    level: Level
    toilet: Item
    toilet_zone: Rect
    toilet_stand: Rect                  # the floor in front of the pan
    basin: Optional[Item] = None        # None only while the search is still placing the toilet
    basin_zone: Optional[Rect] = None
    basin_stand: Optional[Rect] = None  # where one stands to wash
    shower: Optional[Item] = None
    corner: str = ""                    # compass name of the corner the shower stands in
    shower_walls: int = 0               # how many of its four sides are room walls
    entry_side: str = ""                # compass direction one steps out of the shower in
    entry_span: Tuple[float, float] = (0.0, 0.0)   # the way in, along the shower's open side
    shower_exit: Optional[Rect] = None  # dry floor outside the way in
    transfer: str = ""                  # "lo" | "hi": the side of the pan kept clear for a wheelchair
    cabinet: Optional[Item] = None
    cabinet_leaf: Optional[Rect] = None
    fitout: Optional[Fitout] = None
    unplaced: Tuple[Unplaced, ...] = ()
    compromises: Tuple[str, ...] = ()
    base_score: float = 0.0             # how the fixtures alone do, before fitting out and walking

    @property
    def fixtures(self) -> List[Item]:
        """The pieces that stand on the floor."""
        return [f for f in (self.shower, self.toilet, self.basin, self.cabinet) if f is not None]

    @property
    def items(self) -> List[Item]:
        return self.fixtures + (list(self.fitout.items) if self.fitout else [])

    @property
    def zones(self) -> List[Tuple[str, Rect]]:
        out = [("the toilet", self.toilet_zone), ("the basin", self.basin_zone),
               ("the way out of the shower", self.shower_exit)]
        return [(name, zone) for name, zone in out if zone is not None]
