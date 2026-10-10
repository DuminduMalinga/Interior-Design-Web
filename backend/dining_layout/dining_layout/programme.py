"""
Rules 4 and 12 - what the dining area gets, decided before anything is placed.

The number of seats follows the number of occupants when the request gives one,
and the floor area when it does not; the table follows the seats. The search
falls back to a smaller table when the room cannot take the first choice with
every clearance intact (rule 4).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .config import Config
from .furniture import SEAT_COUNTS, TABLES
from .room import Room


@dataclass
class Programme:
    """The furniture list for one dining area."""

    seats: int                          # what is wanted
    seats_source: str                   # "provided" | "inferred"
    seat_options: List[int]             # in order of preference: `seats`, then every size down
    sideboard: bool
    use: str                            # "everyday" | "entertaining"
    notes: List[str] = field(default_factory=list)

    def describe(self) -> str:
        parts = [TABLES[self.seat_options[0]].label, "{} chairs".format(self.seat_options[0])]
        if self.sideboard:
            parts.append("sideboard")
        parts.append("pendant light")
        return ", ".join(parts)

    def to_dict(self) -> Dict:
        return {
            "seats": self.seats,
            "seats_source": self.seats_source,
            "seat_options": list(self.seat_options),
            "sideboard": self.sideboard,
            "use": self.use,
            "summary": self.describe(),
        }


def _flag(value) -> Optional[bool]:
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


def select_programme(room: Room, config: Config, seats=None, occupants=None, sideboard=None, use=None) -> Programme:
    """Pick the table for the occupants (or the floor area) and decide on a sideboard."""
    t = config.rooms
    notes: List[str] = []
    area = room.area_m2

    use_name = str(use or "everyday").strip().lower()
    if use_name not in ("everyday", "entertaining"):
        notes.append("'{}' is not a use this engine knows (everyday, entertaining); everyday was assumed.".format(use))
        use_name = "everyday"

    wanted, source = None, "inferred"
    for value, guests in ((seats, 0), (occupants, 2 if use_name == "entertaining" else 0)):
        try:
            number = int(value) if value is not None else 0
        except (TypeError, ValueError):
            number = 0
        if number > 0:
            wanted, source = number + guests, "provided"     # entertaining: room for two guests
            break
    if wanted is None:
        wanted = 2 if area < t.seats_4_area else 4 if area < t.seats_6_area else 6 if area < t.seats_8_area else 8
    # the smallest standard table that seats everyone
    first = next((n for n in SEAT_COUNTS if n >= wanted), SEAT_COUNTS[-1])
    if wanted > SEAT_COUNTS[-1]:
        notes.append("{} seats were asked for; the largest table this engine places seats {}.".format(
            wanted, SEAT_COUNTS[-1]))

    with_sideboard = _flag(sideboard)
    if with_sideboard is None:
        with_sideboard = area >= t.sideboard_area or use_name == "entertaining"

    return Programme(
        seats=first,
        seats_source=source,
        seat_options=[n for n in reversed(SEAT_COUNTS) if n <= first],
        sideboard=with_sideboard,
        use=use_name,
        notes=notes,
    )
