"""
Central configuration: every tunable number used by the bedroom rule engine.

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

    # rules 3 and 8 - the door and the landing in front of it
    door_entry_depth: float = 900.0       # kept clear in front of every door
    door_ahead_good: float = 1800.0       # open floor straight ahead that earns full marks

    # rule 2 - how far the bed is from the doorway
    bed_door_near: float = 600.0          # no marks at or below this
    bed_door_far: float = 1500.0          # full marks from here

    # rule 5 - getting in and out of bed
    bed_side_min: float = 600.0           # hard minimum beside the bed
    bed_side_preferred: float = 750.0
    bed_foot_min: float = 600.0
    bed_foot_preferred: float = 900.0

    # rules 6 and 12 - reach from the pillow
    bedside_reach: float = 600.0

    # rule 7 - standing room in front of storage
    wardrobe_front_min: float = 750.0     # hard minimum
    wardrobe_front_preferred: float = 900.0
    drawer_front_min: float = 700.0       # hard minimum
    drawer_front_preferred: float = 900.0

    # rule 8 - walking path widths tried, widest first; the last one is the hard minimum
    path_widths: Tuple[float, ...] = (900.0, 750.0, 600.0)
    cut_off_tolerance: float = 0.95       # share of the open floor that must be reachable at full marks

    # rule 9 - floor a desk chair takes up while someone is sitting at it
    chair_pullout_depth: float = 900.0
    chair_pullout_width: float = 700.0

    # rules 4 and 10 - windows double as the room's ventilation openings
    window_access_depth: float = 600.0    # band in front of a window
    tall_furniture_height: float = 1100.0  # at or above this a piece counts as tall
    window_margin_preferred: float = 300.0
    floor_window_sill: float = 500.0      # a sill this low means full-height glazing

    # rule 11 - leftover wall gaps narrower than this are dead space
    dead_gap_max: float = 300.0

    # rule 12 - walk from the bed to everyday storage
    storage_reach_good: float = 3000.0
    storage_reach_far: float = 6000.0

    @property
    def path_min(self) -> float:
        return min(self.path_widths)


@dataclass
class RoomThresholds:
    """Rule 11: which furniture a room of a given size gets."""

    double_room_min_area: float = 10.0     # from here the room is assumed to sleep two
    double_room_min_side: float = 2600.0   # mm - and it must be at least this wide
    single_upgrade_area: float = 13.0      # one occupant gets a double bed from here
    queen_min_area: float = 13.0
    king_min_area: float = 18.0
    medium_wardrobe_area: float = 12.0     # one occupant gets a 3-door wardrobe from here
    large_wardrobe_area: float = 16.0      # two occupants get a 4-door wardrobe from here
    dresser_min_area: float = 13.0
    desk_min_area_single: float = 9.0
    desk_min_area_double: float = 13.0
    crowded_ratio: float = 0.45            # furniture may cover this much floor at full marks
    overcrowded_ratio: float = 0.65        # ... and no marks from here
    open_floor_side: float = 1500.0        # mm - a clear square this big is all any bedroom needs
    open_floor_share: float = 0.5          # ... or this share of the room's shorter side, if smaller


@dataclass
class Weights:
    """Points each of the twelve rules can contribute; they add up to 100."""

    entrance_view: float = 10.0       # rule 1
    door_distance: float = 6.0        # rule 2
    door_swing: float = 8.0           # rule 3
    bed_windows: float = 10.0         # rule 4
    bed_access: float = 12.0          # rule 5
    bedside_tables: float = 8.0       # rule 6
    storage_clearance: float = 10.0   # rule 7
    walking_path: float = 12.0        # rule 8
    desk_and_chair: float = 6.0       # rule 9
    tall_furniture: float = 5.0       # rule 10
    room_fit: float = 9.0             # rule 11
    reach_and_height: float = 4.0     # rule 12


@dataclass
class SearchSettings:
    """Search effort."""

    bed_step: float = 50.0        # sampling step for the bed along a wall
    item_step: float = 200.0      # sampling step for wardrobe / drawers / desk (flush positions are added)
    beds_per_wall: int = 3        # bed positions kept per headboard wall
    branch: int = 2               # options kept per partial layout when adding the desk / drawers
    beam: int = 6                 # complete layouts kept per wardrobe position
    finalists: int = 4            # complete layouts fully scored per variant
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
