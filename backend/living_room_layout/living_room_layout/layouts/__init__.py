"""Layout registry.

Adding a layout: implement `BaseLayout` in a new module and append it to
`ALL_LAYOUTS`.  Nothing else in the system needs to change.
"""

from .base import BaseLayout, PlacementSpec, Suitability
from .conversation import ConversationLayout
from .entertainment import EntertainmentLayout
from .l_shaped import LShapedLayout
from .multifunctional import MultiFunctionalLayout, compute_zones
from .open_center import OpenCenterLayout
from .reading import ReadingLayout

ALL_LAYOUTS = [
    ConversationLayout(),
    EntertainmentLayout(),
    LShapedLayout(),
    ReadingLayout(),
    OpenCenterLayout(),
    MultiFunctionalLayout(),
]

LAYOUTS_BY_NAME = {layout.name: layout for layout in ALL_LAYOUTS}

# aliases so the input JSON can use the informal names from the specification
LAYOUT_ALIASES = {
    "tv": "entertainment",
    "entertainment": "entertainment",
    "conversation": "conversation",
    "l_shaped": "l_shaped",
    "l-shape": "l_shaped",
    "corner": "l_shaped",
    "reading": "reading",
    "relaxation": "reading",
    "open_center": "open_center",
    "open-centre": "open_center",
    "multi_function": "multi_function",
    "multifunctional": "multi_function",
}


def get_layout(name: str):
    """Look up a layout by name or alias; returns None when unknown."""
    if not name:
        return None
    key = LAYOUT_ALIASES.get(str(name).strip().lower(), str(name).strip().lower())
    return LAYOUTS_BY_NAME.get(key)


__all__ = [
    "ALL_LAYOUTS",
    "LAYOUTS_BY_NAME",
    "LAYOUT_ALIASES",
    "BaseLayout",
    "PlacementSpec",
    "Suitability",
    "get_layout",
    "compute_zones",
]
