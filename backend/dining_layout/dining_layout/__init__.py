"""
Rule-based dining-area furniture layout engine.

Pure Python with no third-party dependencies. Given a dining area's bounding
box and the doors and windows detected on the floor plan, it places a dining
table with its chairs, a sideboard and the pendant light over the table
according to twelve furniture-arrangement rules, and reports how every layout
does against each one.

    from dining_layout import generate_dining_layouts
    result = generate_dining_layouts({"room": {...}, "detections": [...]})
"""

from .floorplan import InputError
from .generator import generate_dining_layouts, rule_catalogue
from .rules import RULES

__all__ = ["InputError", "RULES", "generate_dining_layouts", "rule_catalogue"]
