"""
Activity zones (rule 3: "divide the room into living, dining, and entertainment
zones when necessary").

A zone is only *necessary* when the room holds more than one activity area:

    living    the seating group, with the TV wall it faces (entertainment)
    reading   bookshelf and reading chair
    work      desk and desk chair
    dining    the dining table and its chairs

`plan_zones` cuts the floor into bands along the room's long axis - the living
area at the end with the best wall for a screen, dining at the other end,
reading and work in between - and `assign_zones` restricts every piece of a
layout plan to the band of the area it belongs to.  The multi-functional layout
keeps its own entertainment / reading / work split (layouts/multifunctional.py)
unless a dining area has to be fitted in as well.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from ..models.geometry import Rect
from .base import PlacementSpec

AREAS = ("living", "reading", "work", "dining")

#: the area a piece defines by being there
AREA_OF_TYPE = {
    "sofa": "living", "l_sofa": "living", "loveseat": "living", "chair": "living",
    "tv": "living", "tv_console": "living",
    "bookshelf": "reading", "reading_chair": "reading",
    "desk": "work", "desk_chair": "work",
    "dining_set": "dining",
}
#: pieces that belong wherever the piece they are anchored to stands
FOLLOWERS = ("coffee_table", "side_table", "lamp", "rug")
#: share of the long axis each band takes, before normalising
BAND_WEIGHT = {"living": 5.0, "middle": 3.0, "dining": 3.5}


def area_of(spec: PlacementSpec, by_role: Dict[str, PlacementSpec]) -> Optional[str]:
    """The activity area a planned piece belongs to (None = anywhere)."""
    seen = set()
    while spec is not None and spec.role not in seen:
        seen.add(spec.role)
        if spec.type in AREA_OF_TYPE:
            return AREA_OF_TYPE[spec.type]
        if spec.type not in FOLLOWERS:
            return None
        spec = by_role.get(spec.anchor) if spec.anchor else None
    return "living"


def plan_zones(analysis, areas: List[str]) -> Tuple[Dict[str, Rect], List[str]]:
    """One floor band per activity area; needs at least two areas."""
    room = analysis.room
    reasons: List[str] = []
    long_axis = 0 if room.width >= room.length else 1
    extent = room.width if long_axis == 0 else room.length
    cross = room.length if long_axis == 0 else room.width

    def band(lo: float, hi: float, clo: float = 0.0, chi: Optional[float] = None) -> Rect:
        chi = cross if chi is None else chi
        if long_axis == 0:
            return Rect.from_bounds(lo, clo, hi, chi)
        return Rect.from_bounds(clo, lo, chi, hi)

    middle = [a for a in ("reading", "work") if a in areas]
    order = [name for name, present in (("living", "living" in areas), ("middle", bool(middle)),
                                        ("dining", "dining" in areas)) if present]
    total = sum(BAND_WEIGHT[name] for name in order)

    # the living area takes the end with the best solid wall for a screen
    living_low = True
    media_wall = analysis.best_media_wall()
    if media_wall:
        info = analysis.wall_info(media_wall)
        segment = info.longest_solid
        point = room.wall(media_wall).point_at(segment.middle if segment else info.length / 2.0)
        living_low = point[long_axis] <= extent / 2.0
        if "living" in areas:
            reasons.append("Living zone at the {} end, by the {} wall - the best solid run for a screen".format(
                ("west" if living_low else "east") if long_axis == 0 else ("south" if living_low else "north"),
                media_wall))
    if not living_low:
        order.reverse()

    zones: Dict[str, Rect] = {}
    cursor = 0.0
    for name in order:
        length = extent * BAND_WEIGHT[name] / total
        lo, hi = cursor, cursor + length
        cursor = hi
        if name != "middle":
            zones[name] = band(lo, hi)
            continue
        if len(middle) == 1:
            zones[middle[0]] = band(lo, hi)
            continue
        # reading and work share the band across the room: work takes the daylight
        mid = cross / 2.0
        window = analysis.largest_window()
        work_low = True
        if window is not None:
            centre = window.center_point(room)
            work_low = (centre[1] if long_axis == 0 else centre[0]) <= mid
            reasons.append("Work zone on the side of window '{}' for daylight".format(window.id))
        zones["work"] = band(lo, hi, 0.0, mid) if work_low else band(lo, hi, mid, cross)
        zones["reading"] = band(lo, hi, mid, cross) if work_low else band(lo, hi, 0.0, mid)
    if "dining" in zones:
        reasons.append("Dining zone at the far end of the room from the seating group")
    return zones, reasons


def assign_zones(specs: List[PlacementSpec], analysis) -> Tuple[Dict[str, Rect], List[str]]:
    """Restrict every planned piece to its area's zone.

    Returns the zone each *role* was given (empty when the plan has a single
    area, so no division is needed) and the reasons behind the split.
    """
    by_role = {spec.role: spec for spec in specs}
    area_by_role = {spec.role: area_of(spec, by_role) for spec in specs}
    areas = [a for a in AREAS if a in area_by_role.values()]

    own_zones = [spec for spec in specs if spec.zone is not None]
    if own_zones and "dining" not in areas:
        # the layout zoned the room itself (multi-functional): keep its split
        return {spec.role: spec.zone for spec in own_zones}, []
    if len(areas) < 2:
        return {}, []

    zones, reasons = plan_zones(analysis, areas)
    by_role_zone: Dict[str, Rect] = {}
    for spec in specs:
        area = area_by_role[spec.role]
        if area is None:
            spec.zone, spec.zone_name = None, ""
            continue
        spec.zone, spec.zone_name = zones[area], area
        by_role_zone[spec.role] = zones[area]
    return by_role_zone, reasons
