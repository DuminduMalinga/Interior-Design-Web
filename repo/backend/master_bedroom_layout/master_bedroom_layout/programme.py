"""
Rules 11 and 14 - no unnecessary furniture, and every occupant provided for.

Before anything is placed, this module decides *what* the room gets: how many
people it sleeps, which bed sizes to try (largest first), how many bedside
tables, how big a wardrobe, and whether there is floor for a dressing table and a study
desk. The search then falls back down the bed and wardrobe lists when the room
cannot take the first choice with every clearance intact.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional

from .config import Config
from .furniture import BED_ORDER, BED_SLEEPS, BEDS, FURNITURE_ALIASES, WARDROBE_ORDER, WARDROBES
from .room import Room


@dataclass
class Programme:
    """The furniture list for one master bedroom."""

    occupants: int
    occupants_source: str               # "provided" | "inferred"
    bed_sizes: List[str]                # in order of preference
    bedside_tables: int
    wardrobe_sizes: List[str]           # in order of preference; empty when excluded
    wardrobe_required: bool
    dresser: bool
    desk: bool
    notes: List[str] = field(default_factory=list)

    def pieces(self) -> int:
        """How many pieces a complete layout holds (a desk counts with its chair as one)."""
        return 1 + self.bedside_tables + bool(self.wardrobe_sizes) + self.dresser + self.desk

    def describe(self) -> str:
        parts = [BEDS[self.bed_sizes[0]].label]
        if self.bedside_tables:
            parts.append("{} bedside table{}".format(self.bedside_tables, "" if self.bedside_tables == 1 else "s"))
        if self.wardrobe_sizes:
            parts.append(WARDROBES[self.wardrobe_sizes[0]].label)
        if self.dresser:
            parts.append("dressing table and stool")
        if self.desk:
            parts.append("study desk and chair")
        return ", ".join(parts)

    def to_dict(self) -> Dict:
        return {
            "occupants": self.occupants,
            "occupants_source": self.occupants_source,
            "bed_sizes": list(self.bed_sizes),
            "bedside_tables": self.bedside_tables,
            "wardrobe_sizes": list(self.wardrobe_sizes),
            "dresser": self.dresser,
            "desk": self.desk,
            "summary": self.describe(),
        }


def _normalise(names: Optional[Iterable[str]], notes: List[str]) -> List[str]:
    out = []
    for name in names or []:
        key = FURNITURE_ALIASES.get(str(name).strip().lower().replace(" ", "_").replace("-", "_"))
        if key is None:
            notes.append("'{}' is not master-bedroom furniture this engine places; ignored.".format(name))
        elif key not in out:
            out.append(key)
    return out


def select_programme(
    room: Room,
    config: Config,
    occupants: Optional[int] = None,
    bed_size: Optional[str] = None,
    required: Optional[Iterable[str]] = None,
    optional: Optional[Iterable[str]] = None,
    excluded: Optional[Iterable[str]] = None,
) -> Programme:
    """Pick the furniture list from the floor area, the shorter side and the head count."""
    thresholds = config.rooms
    notes: List[str] = []
    area = room.area_m2

    if occupants is None:
        occupants = 2                      # a master bedroom is planned for a couple unless told otherwise
        source = "inferred"
        notes.append("No occupant count was given; a master bedroom is planned for two.")
    else:
        source = "provided"
        try:
            count = int(occupants)
        except (TypeError, ValueError):
            count = 1
        occupants = min(max(count, 1), 2)
        if count > 2:
            notes.append(
                "{} occupants were asked for; this engine plans one bed, so the room was laid out "
                "for two.".format(count))

    # -- bed: the largest the room size justifies, with smaller ones as fall-backs --
    wanted = None
    if bed_size:
        wanted = str(bed_size).strip().lower()
        if wanted not in BEDS:
            notes.append("Unknown bed size '{}'; choose from {}.".format(bed_size, ", ".join(BED_ORDER)))
            wanted = None
    if wanted is None:
        if occupants == 1:
            wanted = "double" if area >= thresholds.single_upgrade_area else "single"
        elif area >= thresholds.king_min_area:
            wanted = "king"
        elif area >= thresholds.queen_min_area:
            wanted = "queen"
        else:
            wanted = "double"
    smallest = "double" if occupants == 2 else "single"
    bed_sizes = [
        size for size in reversed(BED_ORDER)
        if BED_ORDER.index(smallest) <= BED_ORDER.index(size) <= BED_ORDER.index(wanted)
    ] or [wanted]
    if BED_SLEEPS[wanted] < occupants:
        notes.append("A {} sleeps one; it was kept because it was asked for.".format(BEDS[wanted].label))

    required_set = set(_normalise(required, notes))
    optional_set = set(_normalise(optional, notes))
    excluded_set = set(_normalise(excluded, notes)) - {"bed"}

    def wants(name: str, by_default: bool) -> bool:
        if name in excluded_set:
            return False
        return True if name in required_set or name in optional_set else by_default

    # -- wardrobe: sized to the head count, a size down when the room is tight --
    if occupants == 2:
        biggest = "4-door" if area >= thresholds.large_wardrobe_area else "3-door"
    else:
        biggest = "3-door" if area >= thresholds.medium_wardrobe_area else "2-door"
    wardrobe_sizes = (
        [size for size in reversed(WARDROBE_ORDER) if WARDROBE_ORDER.index(size) <= WARDROBE_ORDER.index(biggest)]
        if wants("wardrobe", True) else []
    )

    desk_area = thresholds.desk_min_area_double if occupants == 2 else thresholds.desk_min_area_single
    return Programme(
        occupants=occupants,
        occupants_source=source,
        bed_sizes=bed_sizes,
        bedside_tables=occupants if wants("bedside_table", True) else 0,
        wardrobe_sizes=wardrobe_sizes,
        wardrobe_required="wardrobe" not in optional_set,
        dresser=wants("dresser", area >= thresholds.dresser_min_area),
        desk=wants("desk", area >= desk_area),
        notes=notes,
    )
