"""
Central configuration: every tunable number used by the rule engine.

Nothing in `rules/`, `engine/` or `layouts/` hard-codes a dimension; they all
read from here.  A project can therefore be re-tuned to a different standard
(or a different country's guidance) by editing this one file, or at runtime by
supplying a "config" block in the input JSON.

All distances are millimetres unless stated otherwise.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Dict


@dataclass
class Clearances:
    """Clearance rules (hard-constraint thresholds)."""

    # 5.3 / 5.6 main entrance + circulation
    door_clearance_min: float = 900.0        # absolute minimum in front of a door
    door_clearance_preferred: float = 1200.0  # preferred, scored as a bonus
    circulation_min: float = 900.0            # minimum walkable corridor width
    circulation_preferred: float = 1200.0

    # 5.7 coffee table
    coffee_table_min: float = 400.0
    coffee_table_max: float = 500.0
    coffee_table_surround: float = 400.0      # movement space around the table

    # 5.8 seating
    seating_circulation_min: float = 600.0    # behind / beside frequently used seating
    seating_circulation_preferred: float = 900.0

    # 5.5 windows
    window_access_depth: float = 600.0        # keep-clear band in front of a window
    window_tall_furniture_height: float = 1100.0  # taller than this = "tall furniture"
    window_low_furniture_gap: float = 0.0     # low furniture may touch the wall
    curtain_operating_space: float = 300.0    # space for curtains/blinds to work

    # secondary circulation between furniture pieces
    minor_gap_min: float = 300.0

    # conversation distances (11. relationship rules)
    conversation_min: float = 1500.0
    conversation_max: float = 3000.0
    #: hard cap - a chair further than this from every other seat is not part
    #: of the group at all (an "orphan"), not just a loose conversation
    #: distance; the candidate is rejected outright rather than merely scored
    #: down. Deliberately looser than conversation_max so it never fights that
    #: softer preference, only catches genuine cross-room outliers.
    seating_group_max_span: float = 4500.0

    # TV viewing distance: multiplier band applied to the TV diagonal / width
    tv_distance_min: float = 1800.0
    tv_distance_max: float = 4500.0

    # reading zone
    arm_reach: float = 700.0                  # side table within arm's reach
    bookshelf_access: float = 750.0           # standing space in front of a bookshelf


@dataclass
class RoomThresholds:
    """Room-characteristic thresholds (square metres / ratios)."""

    small_room_area: float = 14.0   # m^2 - below this the room counts as small
    large_room_area: float = 26.0   # m^2 - at or above this the room counts as large
    narrow_aspect_ratio: float = 1.7   # long/short above this = narrow room
    square_aspect_ratio: float = 1.2   # below this = square-ish room
    min_practical_dimension: float = 2400.0  # a usable living room side, mm


@dataclass
class SearchSettings:
    """Search / optimisation effort."""

    wall_slide_step: float = 250.0     # sampling step along a wall
    open_grid_step: float = 500.0      # sampling step for free-floating pieces
    max_candidates_per_item: int = 260
    beam_width: int = 8                # partial layouts kept while placing
    branch_per_item: int = 6           # candidates expanded per partial layout
    hill_climb_passes: int = 3         # re-placement sweeps after the beam search
    grid_cell: float = 100.0           # circulation raster cell size
    max_rejections_recorded: int = 400


@dataclass
class ScoreWeights:
    """Soft-constraint weights (section 6 / 12 of the specification)."""

    sofa_faces_tv: float = 44.0
    seating_faces_each_other: float = 15.0
    coffee_table_centered: float = 22.0
    coffee_table_distance: float = 10.0
    reading_chair_near_bookshelf: float = 10.0
    side_table_within_reach: float = 8.0
    lamp_beside_reading_chair: float = 6.0
    desk_near_window: float = 8.0
    tv_on_solid_wall: float = 10.0
    good_circulation: float = 15.0
    preferred_circulation_width: float = 5.0
    wall_alignment: float = 10.0
    window_access: float = 8.0
    door_access: float = 8.0
    symmetry: float = 8.0
    usability_open_area: float = 10.0
    zone_separation: float = 8.0
    focal_balance: float = 6.0

    # penalties (negative contributions)
    penalty_close_to_door: float = -20.0
    penalty_poor_circulation: float = -15.0
    penalty_tv_facing_window: float = -15.0
    penalty_coffee_table_misplaced: float = -10.0
    penalty_floating_wall_item: float = -8.0
    penalty_window_partially_blocked: float = -8.0
    penalty_crowding: float = -6.0
    penalty_missing_furniture: float = -12.0


@dataclass
class Config:
    clearances: Clearances = field(default_factory=Clearances)
    rooms: RoomThresholds = field(default_factory=RoomThresholds)
    search: SearchSettings = field(default_factory=SearchSettings)
    weights: ScoreWeights = field(default_factory=ScoreWeights)

    def to_dict(self) -> Dict:
        return asdict(self)

    @staticmethod
    def from_dict(data: Dict = None) -> "Config":
        """Build a config, overriding only the keys present in `data`."""
        cfg = Config()
        if not data:
            return cfg
        for section in ("clearances", "rooms", "search", "weights"):
            overrides = data.get(section) or {}
            target = getattr(cfg, section)
            for key, value in overrides.items():
                if hasattr(target, key):
                    setattr(target, key, value)
        return cfg


DEFAULT_CONFIG = Config()
