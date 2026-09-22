"""
Shared evaluation context and the violation/finding records the rules produce.

Every rule module takes a `PlacementContext`, so adding a new rule never means
threading new arguments through the engine.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from ..config import Config
from ..models.door import Door
from ..models.furniture import Furniture
from ..models.geometry import Point, Rect, Shape
from ..models.room import Room
from ..models.window import Window


@dataclass
class Violation:
    """A broken hard constraint."""

    rule: str            # stable machine-readable rule id
    message: str         # human-readable explanation
    subject: str = ""    # furniture id / role the rule was applied to
    related: str = ""    # the other object involved, when there is one

    def __str__(self) -> str:  # pragma: no cover - debug helper
        return "[{}] {}".format(self.rule, self.message)

    def to_dict(self) -> Dict:
        return {
            "rule": self.rule,
            "message": self.message,
            "subject": self.subject,
            "related": self.related,
        }


@dataclass
class ScoreItem:
    """One contribution to a layout's soft-constraint score."""

    rule: str
    points: float
    message: str

    def to_dict(self) -> Dict:
        return {"rule": self.rule, "points": round(self.points, 2), "message": self.message}


class PlacementContext:
    """Everything a rule needs to judge one placement or one whole layout."""

    def __init__(self, analysis, placed: Optional[List[Furniture]] = None):
        self.analysis = analysis
        self.room: Room = analysis.room
        self.config: Config = analysis.config
        self.doors: List[Door] = analysis.doors
        self.windows: List[Window] = analysis.windows
        self.placed: List[Furniture] = list(placed or [])
        self._door_zone_cache: Dict[float, Shape] = {}

    # -- placed-items bookkeeping ------------------------------------------- #
    def with_placed(self, placed: List[Furniture]) -> "PlacementContext":
        return PlacementContext(self.analysis, placed)

    def add(self, item: Furniture) -> None:
        self.placed.append(item)

    def by_role(self, role: str) -> List[Furniture]:
        return [f for f in self.placed if f.role == role]

    def by_type(self, type_name: str) -> List[Furniture]:
        return [f for f in self.placed if f.type == type_name]

    def first(self, *roles_or_types: str) -> Optional[Furniture]:
        """First placed item matching any of the given roles or types."""
        for key in roles_or_types:
            for item in self.placed:
                if item.role == key or item.type == key:
                    return item
        return None

    def seating(self) -> List[Furniture]:
        return [f for f in self.placed if f.spec.is_seating]

    def primary_sofa(self) -> Optional[Furniture]:
        sofas = [f for f in self.placed if f.type in ("sofa", "l_sofa", "loveseat")]
        return max(sofas, key=lambda f: f.spec.footprint_area) if sofas else None

    # -- cached zones ------------------------------------------------------- #
    def door_zone(self, depth: Optional[float] = None) -> Shape:
        depth = self.config.clearances.door_clearance_min if depth is None else depth
        if depth not in self._door_zone_cache:
            parts = [d.blocked_zone(self.room, depth) for d in self.doors]
            self._door_zone_cache[depth] = Shape.of(*parts) if parts else Shape(())
        return self._door_zone_cache[depth]

    def window_zone(self, window: Window, depth: Optional[float] = None) -> Rect:
        depth = self.config.clearances.window_access_depth if depth is None else depth
        return window.access_zone(self.room, depth)

    @property
    def entry_point(self) -> Optional[Point]:
        return self.analysis.entry_point
