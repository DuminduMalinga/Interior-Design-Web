"""
What the room gets, decided before anything is placed.

The fixture sizes follow the floor area - a walk-in shower and a wide vanity in
a large bathroom, short-projection fixtures in a small one - and the user's
mobility needs (rules 13 and 15) swap in a level-access shower, a higher pan
and a basin with knee space. The search falls back down the list when the room
cannot take the first choice with every clearance intact.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .config import Config
from .fixtures import LEVELS, Level
from .room import Room


@dataclass
class Programme:
    """The fixture list for one bathroom."""

    accessible: bool
    accessible_source: str              # "provided" | "default"
    levels: List[Level]                 # in order of preference
    shower: bool
    shower_required: bool
    cabinet: bool
    notes: List[str] = field(default_factory=list)

    def describe(self) -> str:
        first = self.levels[0]
        if not self.shower:
            first = Level(first.name, None, first.toilet, first.basin)
        return first.describe(self.cabinet)

    def to_dict(self) -> Dict:
        return {
            "accessible": self.accessible,
            "accessible_source": self.accessible_source,
            "levels": [level.name for level in self.levels],
            "shower": self.shower,
            "storage_cabinet": self.cabinet,
            "summary": self.describe(),
        }


def _flag(value) -> Optional[bool]:
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on", "required")
    return bool(value)


def select_programme(
    room: Room,
    config: Config,
    accessible=None,
    shower=None,
    storage_cabinet=None,
    fixture_size: Optional[str] = None,
) -> Programme:
    """Pick the fixtures for the floor area and the user's mobility needs."""
    t = config.rooms
    notes: List[str] = []
    area, short = room.area_m2, min(room.width, room.length)

    wanted = _flag(accessible)
    is_accessible = bool(wanted)
    source = "default" if wanted is None else "provided"

    if is_accessible:
        names = ["accessible", "accessible_compact", "accessible_tight"]
        side = config.access.turning_square
        if short < side:
            notes.append(
                "The room is {:.2f} m across at its narrowest; a wheelchair needs a clear {:.2f} m square to "
                "turn in, so full wheelchair access cannot be reached here.".format(short / 1000.0, side / 1000.0))
    else:
        order = ["large", "standard", "compact", "minimum"]   # "minimum" is only ever a fall-back
        size = str(fixture_size or "").strip().lower()
        if size in order[:3]:
            first = size
        else:
            if size:
                notes.append("'{}' is not a fixture size (large, standard, compact); ignored.".format(fixture_size))
            first = "large" if area >= t.large_min_area else "standard" if area >= t.standard_min_area else "compact"
        names = order[order.index(first):]

    asked = _flag(shower)
    fits = area >= t.shower_min_area and short >= t.shower_min_side
    has_shower = fits if asked is None else asked
    if asked is None and not fits:
        notes.append(
            "At {:.1f} m2 the room is planned as a toilet room - a pan and a basin, no shower.".format(area))

    cabinet = bool(_flag(storage_cabinet))      # only when asked for: a bathroom is not given one by its size

    return Programme(
        accessible=is_accessible,
        accessible_source=source,
        levels=[LEVELS[name] for name in names],
        shower=has_shower,
        shower_required=has_shower,
        cabinet=cabinet,
        notes=notes,
    )
