"""Rule modules: hard constraints, soft constraints and the rule families."""

from .context import PlacementContext, ScoreItem, Violation
from .hard_constraints import ITEM_CONSTRAINTS, LAYOUT_CONSTRAINTS, check_item, check_layout, rule_catalogue
from .soft_constraints import LayoutScore, placement_score, score_layout

__all__ = [
    "ITEM_CONSTRAINTS",
    "LAYOUT_CONSTRAINTS",
    "LayoutScore",
    "PlacementContext",
    "ScoreItem",
    "Violation",
    "check_item",
    "check_layout",
    "placement_score",
    "rule_catalogue",
    "score_layout",
]
