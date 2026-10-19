"""
Rule-based master-bedroom furniture layout engine.

Pure Python with no third-party dependencies. Given a master bedroom's bounding box
and the doors and windows detected on the floor plan, it arranges a bed,
bedside tables, a wardrobe, a dressing table, a study desk and the lighting according to fifteen
furniture-arrangement rules, and reports how every layout does against each one.

    from master_bedroom_layout import generate_master_bedroom_layouts
    result = generate_master_bedroom_layouts({"room": {...}, "detections": [...]})
"""

from .floorplan import InputError
from .generator import generate_master_bedroom_layouts, rule_catalogue
from .rules import RULES

__all__ = ["InputError", "RULES", "generate_master_bedroom_layouts", "rule_catalogue"]
