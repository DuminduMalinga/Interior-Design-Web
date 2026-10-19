"""
Central configuration: every tunable number used by the bathroom rule engine.

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
    door_entry_depth: float = 700.0       # kept clear in front of every door

    # rule 1 - how far the basin is from the entrance
    basin_door_near: float = 1200.0       # full marks up to here
    basin_door_far: float = 3200.0        # no marks from here

    # rule 2 - room to use the toilet
    toilet_side_min: float = 380.0        # hard: centre line to a wall or another fixture
    toilet_side_preferred: float = 450.0
    toilet_front_min: float = 500.0       # hard: clear floor in front of the pan
    toilet_front_preferred: float = 750.0

    # rule 3 - getting in and out of the shower
    shower_opening: float = 700.0         # width of the way in
    shower_exit_min: float = 600.0        # hard: dry floor to step out on to
    shower_exit_preferred: float = 800.0

    # rule 4 - walking path widths tried, widest first; the last one is the hard minimum
    path_widths: Tuple[float, ...] = (900.0, 750.0, 600.0)
    cut_off_tolerance: float = 0.95       # share of the open floor that must be reachable at full marks

    # rule 5 - standing at the basin
    basin_zone_width: float = 700.0       # hard: elbow room, centred on the basin
    basin_front_min: float = 550.0        # hard: floor to stand on in front of it
    basin_front_preferred: float = 750.0
    basin_side_preferred: float = 450.0   # centre line to a side wall or a tall neighbour

    # rules 6 and 7 - cabinets and their doors
    cabinet_leaf_max: float = 450.0       # widest door leaf a cabinet is given
    open_door_path: float = 500.0         # path that must remain past an open cabinet door
    window_access_depth: float = 400.0    # band in front of a window a tall cabinet keeps out of
    tall_fixture_height: float = 1100.0

    # rule 8 - towels
    towel_reach_good: float = 700.0       # an arm's length from where the user stands
    towel_reach_far: float = 1600.0
    towel_rail: float = 600.0
    towel_rail_min: float = 450.0
    towel_ring: float = 250.0
    towel_height: float = 1100.0

    # rule 9 - the mirror
    mirror_bottom: float = 1100.0         # above the floor; its middle is then at standing eye height
    mirror_top: float = 1900.0
    mirror_side_reach: float = 500.0      # a side wall this near the basin can take the mirror instead

    # rule 10 - toiletries
    reach: float = 600.0                  # what a hand reaches without a step
    storage_step: float = 1200.0          # one step from the basin to the storage
    storage_far: float = 2500.0

    # rule 11 - water
    splash_depth: float = 400.0           # floor outside the shower opening that gets wet

    # rule 12 - open floor
    open_floor_side: float = 900.0        # a clear square this big is all a bathroom needs
    open_floor_min: float = 600.0

    # rule 14 - drainage
    drain_inset: float = 250.0            # the waste, measured in from the two walls of its corner
    drain_run_good: float = 3000.0        # longest fall to the drain that earns full marks
    drain_run_far: float = 5000.0
    floor_fall: str = "1:80"

    @property
    def path_min(self) -> float:
        return min(self.path_widths)


@dataclass
class Access:
    """Rules 13 and 15: what changes when the user has mobility needs."""

    turning_square: float = 1500.0        # clear floor a wheelchair turns in
    path_width: float = 900.0
    door_width: float = 800.0
    transfer_width: float = 800.0         # clear floor beside the pan to transfer from a chair
    wall_bar_reach: float = 500.0         # a side wall within this of the pan's centre line takes a fixed bar
    toilet_front: float = 700.0
    basin_front: float = 800.0
    shower_opening: float = 850.0
    mirror_bottom: float = 900.0          # low enough to be used seated
    towel_height: float = 900.0
    bar_length: float = 600.0
    bar_height: float = 700.0             # horizontal bars; vertical ones run 800 - 1400


@dataclass
class RoomThresholds:
    """What a bathroom of a given size gets."""

    shower_min_area: float = 2.4           # below this the room is a toilet room: pan and basin only
    shower_min_side: float = 1100.0
    standard_min_area: float = 3.6         # standard fixtures from here, compact ones below
    large_min_area: float = 6.0            # a walk-in shower and a wide vanity from here
    alcove_stretch: float = 300.0          # a shower this close to filling the wall is made to fit it
    crowded_ratio: float = 0.38            # fixtures may cover this much floor at full marks
    overcrowded_ratio: float = 0.58        # ... and no marks from here


@dataclass
class Weights:
    """Points each of the fifteen rules can contribute; they add up to 100."""

    basin_entrance: float = 8.0       # rule 1
    toilet_space: float = 9.0         # rule 2
    shower_entry: float = 9.0         # rule 3
    walking_paths: float = 10.0       # rule 4
    basin_standing: float = 8.0       # rule 5
    cabinet_position: float = 6.0     # rule 6
    cabinet_doors: float = 6.0        # rule 7
    towel_reach: float = 6.0          # rule 8
    mirror: float = 5.0               # rule 9
    toiletries_reach: float = 5.0     # rule 10
    splash_control: float = 7.0       # rule 11
    clear_floor: float = 6.0          # rule 12
    wheelchair_access: float = 5.0    # rule 13
    floor_and_drainage: float = 5.0   # rule 14
    grab_bars: float = 5.0            # rule 15


@dataclass
class SearchSettings:
    """Search effort."""

    step: float = 100.0           # sampling step along a wall (flush and centred positions are added)
    basin_step: float = 200.0     # the basin is tried last, around every toilet position, so more coarsely
    toilets_per_wall: int = 2     # toilet positions kept per wall for every shower position
    basins_per_wall: int = 2      # basin positions kept per wall for every toilet position
    finalists: int = 3            # complete layouts fitted out, walked and fully scored per variant
    variants_per_corner: int = 4  # toilet / basin wall combinations finished for every shower corner
    max_layouts: int = 6          # alternatives returned


@dataclass
class Config:
    clearances: Clearances = field(default_factory=Clearances)
    access: Access = field(default_factory=Access)
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
        for section in ("clearances", "access", "rooms", "weights", "search"):
            overrides = data.get(section) or {}
            target = getattr(cfg, section)
            for key, value in overrides.items():
                if hasattr(target, key):
                    current = getattr(target, key)
                    setattr(target, key, tuple(value) if isinstance(current, tuple) else type(current)(value))
        return cfg
