"""
What the kitchen gets - the first half of rule 12, "Consider appliance dimensions
... and available floor space before finalizing the layout".

Before anything is placed, this module picks the size of the sink, the stove and
the refrigerator from the floor area, and decides whether the room is big enough
to be asked to take a dining table and how many it should seat. The search then
falls back to smaller appliances, or a smaller table, where a kitchen shape
cannot take the first choice.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional

from .config import Config
from .room import Room
from .units import APPLIANCES, FURNITURE_ALIASES, SIZE_CLASSES, TABLES

SEAT_WORDS = {2: "two", 4: "four", 6: "six"}


@dataclass
class Programme:
    """The appliance sizes and the table one kitchen is planned with."""

    size_classes: List[str]          # in order of preference
    dining: bool
    dining_source: str               # "provided" | "inferred"
    table_seats: List[int]           # in order of preference
    notes: List[str] = field(default_factory=list)

    def describe(self) -> str:
        specs = APPLIANCES[self.size_classes[0]]
        parts = [specs["sink"].label, specs["stove"].label, specs["fridge"].label]
        if self.dining:
            parts.append("dining table for {}".format(SEAT_WORDS[self.table_seats[0]]))
        return ", ".join(parts)

    def to_dict(self) -> Dict:
        return {
            "appliance_sizes": list(self.size_classes),
            "dining_table": self.dining,
            "dining_table_source": self.dining_source,
            "table_seats": list(self.table_seats),
            "summary": self.describe(),
        }


def _named(names: Optional[Iterable[str]]) -> List[str]:
    return [FURNITURE_ALIASES.get(str(name).strip().lower().replace(" ", "_").replace("-", "_"), "")
            for name in names or []]


def select_programme(
    room: Room,
    config: Config,
    dining: Optional[bool] = None,
    seats: Optional[int] = None,
    appliance_size: Optional[str] = None,
    required: Optional[Iterable[str]] = None,
    optional: Optional[Iterable[str]] = None,
    excluded: Optional[Iterable[str]] = None,
) -> Programme:
    """Pick appliance sizes and the dining table from the floor area."""
    thresholds = config.rooms
    notes: List[str] = []
    area = room.area_m2

    # -- appliances: the largest class the floor area justifies, smaller ones as fall-backs --
    wanted = str(appliance_size).strip().lower() if appliance_size else None
    if wanted and wanted not in SIZE_CLASSES:
        notes.append("Unknown appliance size '{}'; choose from {}.".format(appliance_size, ", ".join(SIZE_CLASSES)))
        wanted = None
    if wanted is None:
        if area >= thresholds.large_min_area:
            wanted = "large"
        elif area >= thresholds.standard_min_area:
            wanted = "standard"
        else:
            wanted = "compact"
    size_classes = [size for size in reversed(SIZE_CLASSES) if SIZE_CLASSES.index(size) <= SIZE_CLASSES.index(wanted)]

    # -- dining table: asked for, ruled out, or tried when the room is big enough --
    if "dining_table" in _named(excluded):
        dining = False
    elif "dining_table" in _named(required) + _named(optional):
        dining = True
    if dining is None:
        dining = area >= thresholds.table_min_area
        source = "inferred"
        notes.append(
            "No one said whether the kitchen has a dining table; {} for a {:.1f} m2 kitchen.".format(
                "one was tried" if dining else "none was planned", area))
    else:
        dining, source = bool(dining), "provided"

    try:
        asked = int(seats) if seats else None
    except (TypeError, ValueError):
        asked = None
    if asked is not None and asked not in TABLES:
        notes.append("A table for {} is not in the catalogue; choose from 2, 4 or 6 seats.".format(seats))
        asked = None
    if asked is None:
        asked = 6 if area >= thresholds.table_six_area else 4 if area >= thresholds.table_four_area else 2
    table_seats = [count for count in sorted(TABLES, reverse=True) if count <= asked]

    return Programme(size_classes=size_classes, dining=dining, dining_source=source,
                     table_seats=table_seats, notes=notes)
