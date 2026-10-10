"""
Central configuration: every tunable number used by the kitchen rule engine.

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

    counter_depth: float = 600.0          # base units and worktop, front to back
    door_entry_depth: float = 900.0       # kept clear in front of every room door
    min_counter: float = 300.0            # a stretch of worktop shorter than this is a useless filler

    # rule 1 - the sink
    sink_landing_good: float = 450.0      # worktop on the far side of the sink at full marks
    corner_clear: float = 300.0           # hard: sink and stove stand this far from an inside corner

    # rule 2 - the preparation worktop beside the sink
    prep_min: float = 600.0               # hard minimum
    prep_preferred: float = 900.0

    # rule 3 - sink -> preparation -> stove
    prep_far: float = 1800.0              # from here the stove is a carry away from the sink ...
    prep_too_far: float = 3600.0          # ... and from here it is too far
    stove_door_good: float = 1200.0       # stove this far from the doorway at full marks

    # rule 4 - the work triangle (sink, stove, refrigerator), between the fronts of the three
    leg_min: float = 1200.0
    leg_max: float = 2700.0
    triangle_min: float = 4000.0
    triangle_max: float = 7900.0

    # rule 5 - worktop beside the stove
    stove_landing_min: float = 300.0      # hard, on at least one side
    stove_landing_good: float = 400.0     # the larger side at full marks
    stove_tall_gap: float = 300.0         # hard: worktop between the stove and the refrigerator

    # rule 6 - the refrigerator door
    fridge_standing: float = 500.0        # floor wanted beyond the open door, to stand and reach in

    # rule 7 - opened cupboards and drawers
    opened_depth: float = 500.0           # how far an open door or drawer reaches into the aisle
    opened_passage: float = 500.0         # floor a person needs to get past it
    module_width: float = 600.0           # one base cabinet

    # rule 8 - utensils
    utensil_reach: float = 900.0          # drawers this close to the stove at full marks

    # rule 9 - the working route
    aisle_min: float = 900.0              # hard: clear floor in front of every unit
    aisle_preferred: float = 1200.0
    path_widths: Tuple[float, ...] = (1050.0, 900.0, 600.0)   # widest first; the last is the hard minimum

    # rule 10 - dining table and chairs
    chair_depth: float = 450.0            # a seated chair, measured out from the table edge
    chair_pullout: float = 300.0          # further floor to push the chair back and stand up
    stove_table_good: float = 1800.0      # table this far from the stove at full marks

    # rule 11 - raw and ready-to-eat food
    ready_counter_min: float = 300.0
    ready_counter_good: float = 600.0

    # windows and tall units
    window_access_depth: float = 600.0
    tall_furniture_height: float = 1100.0

    # rule 12 - floor left open
    cut_off_tolerance: float = 0.95

    @property
    def path_min(self) -> float:
        return min(self.path_widths)


@dataclass
class RoomThresholds:
    """Rule 12: which size of appliance a kitchen gets, and whether it takes a table."""

    standard_min_area: float = 7.0         # below this the kitchen gets compact appliances
    large_min_area: float = 14.0           # from here it gets the large ones
    table_min_area: float = 9.0            # from here a dining table is tried
    table_four_area: float = 12.0          # seats four from here ...
    table_six_area: float = 22.0           # ... and six from here
    max_leg: float = 3600.0                # longest leg of an L or a U, measured from the corner
    max_run: float = 6000.0                # longest straight run
    min_leg: float = 900.0
    open_floor_side: float = 1500.0        # a clear square this big is all a kitchen needs
    open_floor_share: float = 0.4          # ... or this share of the room's shorter side, if smaller


@dataclass
class Weights:
    """Points each of the twelve rules can contribute; they add up to 100."""

    sink_location: float = 8.0        # rule 1
    prep_by_sink: float = 8.0         # rule 2
    safe_workflow: float = 12.0       # rule 3
    work_triangle: float = 12.0       # rule 4
    stove_counter: float = 8.0        # rule 5
    fridge_door: float = 7.0          # rule 6
    opened_units: float = 8.0         # rule 7
    utensils: float = 4.0             # rule 8
    working_route: float = 12.0       # rule 9
    dining: float = 7.0               # rule 10
    food_separation: float = 8.0      # rule 11
    appliances_and_space: float = 6.0  # rule 12


@dataclass
class SearchSettings:
    """Search effort."""

    step: float = 150.0           # sampling step for the sink and the stove along a run
    sinks_per_fridge: int = 10    # sink positions kept for each refrigerator position
    finalists: int = 6            # sink / stove / fridge combinations fully built per kitchen shape
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
