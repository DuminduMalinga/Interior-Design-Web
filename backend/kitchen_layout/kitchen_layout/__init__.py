"""
Rule-based kitchen layout engine.

Pure Python with no third-party dependencies. Given a kitchen's bounding box and
the doors and windows detected on the floor plan, it lays out the classic kitchen
shapes the room allows - one-wall, L-shaped, U-shaped, galley - places the sink,
the stove, the refrigerator, the worktops and a dining table according to twelve
kitchen-arrangement rules, and reports how every layout does against each one.

    from kitchen_layout import generate_kitchen_layouts
    result = generate_kitchen_layouts({"room": {...}, "detections": [...]})
"""

from .floorplan import InputError
from .generator import generate_kitchen_layouts, rule_catalogue
from .rules import RULES

__all__ = ["InputError", "RULES", "generate_kitchen_layouts", "rule_catalogue"]
