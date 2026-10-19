"""
Central configuration: every tunable number used by the dining-area rule engine.

Nothing in the rules or the search hard-codes a dimension; they all read from
here, so the engine can be re-tuned to a different standard by editing this one
file, or at runtime by sending a "config" block with the request.

All distances are millimetres and all areas square metres.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Dict, Tuple


@dataclass
class Clearances:
    """The distances the rules measure against."""

    # the door and the landing in front of it
    door_entry_depth: float = 900.0       # kept clear in front of every door

    # rule 1 - how far the table is from the entrance
    table_door_near: float = 2500.0       # full marks up to here
    table_door_far: float = 5500.0        # no marks from here

    # rule 2 - pulling a chair out
    chair_pull_min: float = 700.0         # hard: table edge to a wall or furniture, on every side with chairs
    chair_pull_preferred: float = 900.0
    chair_tuck: float = 300.0             # how far a pushed-in chair stands out from the table edge
    chair_occupied: float = 500.0         # ... and how far with someone sitting on it

    # rule 3 - walking round the table
    path_widths: Tuple[float, ...] = (900.0, 750.0, 600.0)   # widest first; the last is the hard minimum
    walk_behind: float = 1100.0           # table edge to a wall for someone to pass behind a seated person
    cut_off_tolerance: float = 0.95

    # rule 5 - sitting comfortably
    seat_width_min: float = 550.0         # table edge per person
    seat_width_preferred: float = 650.0
    end_gap_min: float = 600.0            # a table end with no chair is flush to the wall or this far off it
    elbow_gap: float = 300.0              # ... and from here the end chairs have free elbows

    # rule 6 - doors and windows
    table_door_min: float = 800.0         # table edge to a doorway: no marks at or below this
    table_door_good: float = 1500.0
    window_access_depth: float = 600.0    # band in front of a window kept free to reach it

    # rule 7 - the table and other furniture
    furniture_gap_min: float = 900.0      # hard: table edge to the sideboard when chairs stand between them
    furniture_gap_side: float = 600.0     # hard: the same with no chairs between
    furniture_gap_preferred: float = 1200.0

    # rule 8 - the kitchen
    kitchen_near: float = 2000.0          # full marks up to here, measured to the kitchen door or wall
    kitchen_far: float = 5000.0
    kitchen_adjacent: float = 3000.0      # a kitchen further than this from the room is not "nearby"

    # rule 9 - the main route through the room
    route_width: float = 750.0            # path that must remain with every chair occupied
    route_ahead: float = 1500.0           # floor straight ahead of a lone door that counts as the route

    # rule 10 - light
    pendant_drop: float = 750.0           # lamp above the table top
    table_height: float = 750.0
    two_pendants_from: float = 2000.0     # a table this long gets two
    daylight_near: float = 1500.0         # table edge to a window: full marks up to here
    daylight_far: float = 4000.0

    # rule 11 - serving within reach
    serve_near: float = 1500.0            # table edge to the sideboard: full marks up to here
    serve_far: float = 3000.0

    @property
    def path_min(self) -> float:
        return min(self.path_widths)


@dataclass
class RoomThresholds:
    """Rules 4 and 12: what a dining area of a given size gets."""

    seats_4_area: float = 6.5          # below this the room is planned for two
    seats_6_area: float = 10.5
    seats_8_area: float = 19.0
    sideboard_area: float = 10.0       # a sideboard from here
    crowded_ratio: float = 0.28        # table and seated diners may cover this much floor at full marks
    overcrowded_ratio: float = 0.50    # ... and no marks from here


@dataclass
class Weights:
    """Points each of the twelve rules can contribute; they add up to 100."""

    table_access: float = 8.0        # rule 1
    chair_pullout: float = 12.0      # rule 2
    table_paths: float = 10.0        # rule 3
    table_size: float = 8.0          # rule 4
    seating_comfort: float = 8.0     # rule 5
    openings_clear: float = 9.0      # rule 6
    furniture_gap: float = 7.0       # rule 7
    kitchen_proximity: float = 8.0   # rule 8
    main_route: float = 10.0         # rule 9
    lighting: float = 6.0            # rule 10
    items_in_reach: float = 6.0      # rule 11
    occupants_fit: float = 8.0       # rule 12


@dataclass
class SearchSettings:
    """Search effort."""

    step: float = 100.0           # sampling step for the table across the floor and the sideboard along a wall
    finalists: int = 3            # table positions finished, walked and fully scored per variant
    max_layouts: int = 6          # alternatives returned


@dataclass
class Config:
    clearances: Clearances = field(default_factory=Clearances)
    rooms: RoomThresholds = field(default_factory=RoomThresholds)
    weights: Weights = field(default_factory=Weights)
    search: SearchSettings = field(default_factory=SearchSettings)

    def to_dict(self) -> Dict:
        return asdict(self)

    @staticmethod
    def from_dict(data: Dict = None) -> "Config":
        """Build a config, overriding only the keys present in `data`."""
        cfg = Config()
        if not data:
            return cfg
        for section in ("clearances", "rooms", "weights", "search"):
            overrides = data.get(section) or {}
            target = getattr(cfg, section)
            for key, value in overrides.items():
                if hasattr(target, key):
                    current = getattr(target, key)
                    setattr(target, key, tuple(value) if isinstance(current, tuple) else type(current)(value))
        return cfg
