"""
Rule-based bedroom furniture layout engine.

Pure Python with no third-party dependencies. Given a bedroom's bounding box
and the doors and windows detected on the floor plan, it arranges a bed,
bedside tables, a wardrobe, drawers and a study desk according to twelve
furniture-arrangement rules, and reports how every layout does against each one.

    from bedroom_layout import generate_bedroom_layouts
    result = generate_bedroom_layouts({"room": {...}, "detections": [...]})
"""

from .floorplan import InputError
from .generator import generate_bedroom_layouts, rule_catalogue
from .rules import RULES

__all__ = ["InputError", "RULES", "generate_bedroom_layouts", "rule_catalogue"]
