"""
Rule-based living-room furniture layout engine.

Pure Python with no third-party dependencies. Given a living room's bounding
box and the doors and windows detected on the floor plan, it places a sofa,
armchairs, a coffee table, side tables, a TV unit and a rug - and a dining
table, a desk or a reading corner when the household's daily activities call
for one - according to ten furniture-arrangement rules, and reports how every
layout does against each one.

    from living_room_layout import generate_living_room_layouts
    result = generate_living_room_layouts({"room": {...}, "detections": [...]})
"""

from .floorplan import InputError
from .generator import generate_living_room_layouts, rule_catalogue
from .rules import RULES

__all__ = ["InputError", "RULES", "generate_living_room_layouts", "rule_catalogue"]
