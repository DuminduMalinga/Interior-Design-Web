"""
Central configuration: every tunable number used by the living-room rule engine.

Nothing in the rules or the search hard-codes a dimension; they all read from
here, so the engine can be re-tuned to a different standard by editing this one
file, or at runtime by sending a "config" block with the request.

All distances are millimetres, all areas square metres and all angles degrees.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Dict, Tuple


@dataclass
class Clearances:
    """The distances the rules measure against."""

    # the door and the landing in front of it
    door_entry_depth: float = 900.0       # kept clear in front of every door

    # rule 1 - talking to each other
    conversation_near: float = 900.0      # seat front to seat front: full marks from here ...
    conversation_far: float = 2700.0      # ... to here
    conversation_limit: float = 3700.0    # no marks from here
    facing_angle: float = 50.0            # a seat "faces the group" within this of its centre

    # rule 2 - seeing each other
    sight_full: float = 60.0              # another person this far off straight ahead is seen without turning
    sight_none: float = 110.0             # ... and from here they are behind the shoulder
    eye_height: float = 1100.0            # furniture taller than this blocks a seated person's view
    entrance_angle: float = 100.0         # the door counts as in view from the sofa within this

    # rule 3 - zones
    zone_gap_min: float = 600.0           # hard: clear floor between the seating group and another zone
    zone_gap_preferred: float = 900.0

    # rule 4 - doors, windows and the main paths
    door_gap_min: float = 900.0           # furniture to a doorway: no marks at or below this
    door_gap_good: float = 1500.0
    window_access_depth: float = 600.0    # band in front of a window kept free to reach it
    route_ahead: float = 1500.0           # floor straight ahead of a lone door that counts as the route

    # rule 5 - furniture sized to the room
    sofa_wall_ideal: float = 0.65         # sofa length over the room size along it: full marks up to here
    sofa_wall_max: float = 0.90           # ... no marks from here

    # rule 6 - within reach
    table_gap: float = 400.0              # built in: seat front to the coffee table
    reach_gap_min: float = 350.0          # hard limits on that gap
    reach_gap_max: float = 500.0
    reach: float = 600.0                  # a seat has a surface "within reach" up to here

    # rule 7 - the television
    tv_min: float = 1500.0                # hard: sofa front to the TV
    tv_near: float = 2000.0               # full marks from here ...
    tv_far: float = 3600.0                # ... to here
    tv_limit: float = 5500.0              # no marks from here
    tv_angle_full: float = 15.0           # TV this far off straight ahead of the sofa: full marks
    tv_angle_max: float = 35.0            # hard: never further off than this
    tv_centre_height: float = 1100.0      # centre of the screen above the floor

    # rule 7 - dining, working and reading in the room
    chair_pull_min: float = 700.0         # hard: dining-table edge to a wall or furniture, on every side with chairs
    chair_tuck: float = 300.0             # how far a pushed-in chair stands out from the table or desk
    desk_chair_space: float = 900.0       # clear floor in front of the desk
    armchair_front: float = 600.0         # clear floor in front of the reading chair
    daylight_near: float = 1500.0         # desk or reading chair to a window: full marks up to here
    daylight_far: float = 4000.0

    # rule 9 - moving between the areas
    path_widths: Tuple[float, ...] = (900.0, 750.0, 600.0)   # widest first; the last is the hard minimum
    cut_off_tolerance: float = 0.95

    # rule 10 - occupants with mobility needs
    accessible_path_widths: Tuple[float, ...] = (1200.0, 1000.0, 900.0)
    turning_space: float = 1500.0         # side of the clear square a wheelchair turns in
    transfer_width: float = 900.0         # clear floor beside the sofa to pull a wheelchair up
    transfer_depth: float = 1200.0


@dataclass
class RoomThresholds:
    """Rules 5 and 8: what a living room of a given size gets, and when it is full."""

    standard_area: float = 12.0        # below this the room gets the compact furniture
    generous_area: float = 20.0        # from here the generous furniture
    reading_area: float = 25.0         # a reading corner is assumed from here when no activities are given
    crowded_ratio: float = 0.28        # furniture may cover this much floor at full marks
    overcrowded_ratio: float = 0.45    # ... and no marks from here
    open_square_min: float = 0.15      # largest clear square over the room's shorter side: no marks
    open_square_good: float = 0.40     # ... full marks


@dataclass
class Weights:
    """Points each rule can contribute.

    The ten arrangement rules add up to 100. Their score is then converted
    to what `furniture_count` leaves of the 100-point total (90), and the extra
    rule's points are added on top.
    """

    face_to_face: float = 12.0       # rule 1
    views: float = 8.0               # rule 2
    zones: float = 8.0               # rule 3
    clear_openings: float = 12.0     # rule 4
    furniture_fit: float = 10.0      # rule 5
    within_reach: float = 10.0       # rule 6
    daily_activities: float = 12.0   # rule 7
    openness: float = 10.0           # rule 8
    movement: float = 10.0           # rule 9
    accessibility: float = 8.0       # rule 10
    furniture_count: float = 10.0    # the extra rule: most furniture of the layouts generated


@dataclass
class SearchSettings:
    """Search effort."""

    step: float = 150.0           # sampling step for the sofa across the floor and for pieces along a wall
    max_steps: int = 30           # ... widened in a large room so no more than this many are tried each way
    shortlist: int = 40           # sofa positions per variant scored in full
    finalists: int = 3            # ... of which this many are furnished, walked and fully scored
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
