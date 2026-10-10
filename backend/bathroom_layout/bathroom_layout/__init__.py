"""
Rule-based bathroom fixture layout engine.

Pure Python with no third-party dependencies. Given a bathroom's bounding box
and the doors and windows detected on the floor plan, it arranges a shower, a
toilet, a washbasin and a storage cabinet, fixes the mirror, the towel rails,
the floor drain and any grab bars, and reports how every layout does against
fifteen fixture-arrangement rules.

    from bathroom_layout import generate_bathroom_layouts
    result = generate_bathroom_layouts({"room": {...}, "detections": [...]})
"""

from .floorplan import InputError
from .generator import generate_bathroom_layouts, rule_catalogue
from .rules import RULES

__all__ = ["InputError", "RULES", "generate_bathroom_layouts", "rule_catalogue"]
