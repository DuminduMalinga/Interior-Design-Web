"""
Layout 6 - Multi-functional layout (specification 7.6).

The room is divided into three zones before any furniture is placed:

    ZONE 1  entertainment   in front of the media wall
    ZONE 2  reading         the quiet corner furthest from the entrance
    ZONE 3  work            the band with the best natural light

Each piece is then restricted to its zone, which is what keeps the work desk
out of the TV area and the reading corner out of the main walkway.

Rules enforced/scored here
    - desk near natural light but never blocking the window
    - bookshelf against a solid wall
    - the work zone stays out of the main circulation route
    - the reading chair can reach the shelves
    - the TV has an unobstructed viewing direction
    - at least one clear path from the entrance survives
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from ..models.furniture import FurnitureCatalogue
from ..models.geometry import Rect, Shape, corridor_polygon
from ..rules.context import PlacementContext, ScoreItem
from ..rules.circulation_rules import entrance_corridor
from ..rules.furniture_rules import gap_between, wall_behind
from .base import BaseLayout, PlacementSpec, Suitability


def compute_zones(analysis) -> Tuple[Dict[str, Rect], List[str]]:
    """Split the room into entertainment / reading / work zones."""
    room = analysis.room
    reasons: List[str] = []
    long_axis = 0 if room.width >= room.length else 1
    extent = room.width if long_axis == 0 else room.length
    cross = room.length if long_axis == 0 else room.width

    def band(lo: float, hi: float, clo: float = 0.0, chi: float = None) -> Rect:
        chi = cross if chi is None else chi
        if long_axis == 0:
            return Rect.from_bounds(lo, clo, hi, chi)
        return Rect.from_bounds(clo, lo, chi, hi)

    # 1. the entertainment zone takes the 58% of the long axis nearest the media wall
    media_wall = analysis.best_media_wall()
    anchor = 0.0
    if media_wall:
        info = analysis.wall_info(media_wall)
        segment = info.longest_solid
        point = room.wall(media_wall).point_at(segment.middle if segment else info.length / 2.0)
        anchor = point[long_axis]
        reasons.append(
            "Entertainment zone anchored on the {} wall, the best solid run for a screen".format(media_wall)
        )
    else:
        anchor = extent / 2.0
        reasons.append("No clear media wall; the entertainment zone takes the middle of the room")

    split = 0.58 * extent
    if anchor <= extent / 2.0:
        entertainment = band(0.0, split)
        rest_lo, rest_hi = split, extent
    else:
        entertainment = band(extent - split, extent)
        rest_lo, rest_hi = 0.0, extent - split

    # 2. the remaining band is halved across the room: work goes to the light
    mid = cross / 2.0
    window = analysis.largest_window()
    work_low = True
    if window is not None:
        centre = window.center_point(room)
        cross_coord = centre[1] if long_axis == 0 else centre[0]
        work_low = cross_coord <= mid
        reasons.append(
            "Work zone placed on the {} side, next to window '{}' for natural light".format(
                "lower" if work_low else "upper", window.id
            )
        )
    else:
        reasons.append("No window, so the work zone simply takes the quieter half of the secondary band")

    if work_low:
        work = band(rest_lo, rest_hi, 0.0, mid)
        reading = band(rest_lo, rest_hi, mid, cross)
    else:
        work = band(rest_lo, rest_hi, mid, cross)
        reading = band(rest_lo, rest_hi, 0.0, mid)
    reasons.append("Reading zone occupies the remaining quiet corner, away from the main walkway")

    return {"entertainment": entertainment, "reading": reading, "work": work}, reasons


class MultiFunctionalLayout(BaseLayout):
    name = "multi_function"
    title = "Multi-functional zoned layout"
    best_for = ["living + entertainment", "living + reading", "living + working"]
    purposes = ["multi_function", "multifunctional", "work", "home_office", "study"]

    def plan(self, analysis, requirements, catalogue: FurnitureCatalogue) -> List[PlacementSpec]:
        zones, _ = compute_zones(analysis)
        ent, read, work = zones["entertainment"], zones["reading"], zones["work"]
        specs = [
            PlacementSpec(
                role="tv_console", type="tv_console",
                strategies=["media_wall", "solid_wall"], zone=ent, zone_name="entertainment",
                note="ZONE 1: the media unit defines the entertainment zone",
            ),
            PlacementSpec(
                role="tv", type="tv", required=False,
                strategies=["on_console", "media_wall"], anchor="tv_console",
                zone=ent, zone_name="entertainment",
                note="ZONE 1: screen with an unobstructed viewing direction",
            ),
            PlacementSpec(
                role="sofa", type="sofa",
                strategies=["opposite", "wall_facing", "wall"], anchor="tv",
                zone=ent, zone_name="entertainment",
                note="ZONE 1: main seating facing the screen",
            ),
            PlacementSpec(
                role="coffee_table", type="coffee_table",
                strategies=["in_front_of"], anchor="sofa",
                zone=ent, zone_name="entertainment",
                note="ZONE 1: table in front of the sofa",
            ),
            PlacementSpec(
                role="chair_1", type="chair", required=False,
                strategies=["facing", "wall_facing"], anchor="sofa",
                zone=ent, zone_name="entertainment",
                note="ZONE 1: extra seat in the entertainment zone",
            ),
            PlacementSpec(
                role="chair_2", type="chair", required=False,
                strategies=["facing", "wall_facing"], anchor="sofa",
                zone=ent, zone_name="entertainment",
                note="ZONE 1: second extra seat",
            ),
            PlacementSpec(
                role="bookshelf", type="bookshelf",
                strategies=["solid_wall"], zone=read, zone_name="reading",
                note="ZONE 2: bookshelf on a solid wall inside the reading zone",
            ),
            PlacementSpec(
                role="reading_chair", type="reading_chair",
                strategies=["beside_facing", "near"], anchor="bookshelf",
                zone=read, zone_name="reading",
                note="ZONE 2: reading chair with access to the shelves",
            ),
            PlacementSpec(
                role="lamp", type="lamp", required=False,
                strategies=["beside"], anchor="reading_chair",
                zone=read, zone_name="reading",
                note="ZONE 2: lamp beside the reading chair",
            ),
            PlacementSpec(
                role="side_table_1", type="side_table", required=False,
                strategies=["beside"], anchor="reading_chair",
                zone=read, zone_name="reading",
                note="ZONE 2: side table within arm's reach",
            ),
            PlacementSpec(
                role="desk", type="desk",
                strategies=["near_window", "wall"], zone=work, zone_name="work",
                note="ZONE 3: desk in the daylight band, without covering the glass",
            ),
            PlacementSpec(
                role="desk_chair", type="desk_chair",
                strategies=["at_desk"], anchor="desk", zone=work, zone_name="work",
                note="ZONE 3: chair tucked at the desk, clear of the walkway",
            ),
        ]
        return self.apply_requirements(specs, requirements)

    def suitability(self, analysis, requirements) -> Suitability:
        score = 5.0
        reasons: List[str] = []
        blockers: List[str] = []

        points, notes = self._purpose_match(requirements, self.purposes, 40.0)
        score += points
        reasons += notes

        if analysis.size_class == "large":
            score += 25.0
            reasons.append("A large room can carry three separate zones")
        elif analysis.size_class == "medium":
            score += 5.0
            reasons.append("A medium room can carry two and a half zones at best")
        else:
            blockers.append("A small room cannot be split into entertainment, reading and work zones")

        if self._requested(requirements, "desk", "desk_chair"):
            score += 25.0
            reasons.append("User asked for a desk, which needs its own work zone")
        if self._requested(requirements, "bookshelf"):
            score += 8.0
            reasons.append("User asked for a bookshelf, which anchors the reading zone")

        if analysis.windows:
            score += 8.0
            reasons.append("Natural light is available for the work zone")
        else:
            score -= 8.0
            reasons.append("No window, so the work zone gets no daylight")

        if len(analysis.solid_walls()) >= 2:
            score += 8.0
            reasons.append("At least two solid walls are available for the media unit and the bookshelf")
        else:
            score -= 10.0
            reasons.append("Fewer than two solid walls, so the media unit and bookshelf compete")
        return Suitability(self.name, score, reasons, blockers)

    def bonus(self, ctx: PlacementContext, items) -> List[ScoreItem]:
        out: List[ScoreItem] = []
        zones, _ = compute_zones(ctx.analysis)
        placed_in_zone = 0
        checked = 0
        role_zone = {
            "tv": "entertainment", "tv_console": "entertainment", "sofa": "entertainment",
            "coffee_table": "entertainment", "chair_1": "entertainment", "chair_2": "entertainment",
            "bookshelf": "reading", "reading_chair": "reading", "lamp": "reading",
            "desk": "work", "desk_chair": "work",
        }
        for item in items:
            zone_name = role_zone.get(item.role)
            if not zone_name:
                continue
            checked += 1
            if zones[zone_name].contains_point(item.center, tol=250.0):
                placed_in_zone += 1
        if checked:
            ratio = placed_in_zone / checked
            out.append(ScoreItem("zone_discipline", ctx.config.weights.zone_separation * ratio,
                                 "{} of {} pieces stayed inside their assigned zone".format(placed_in_zone, checked)))

        # "Work zone should not overlap the main circulation route"
        corridor = entrance_corridor(ctx)
        work_pieces = [f for f in items if f.role in ("desk", "desk_chair")]
        if corridor is not None and work_pieces:
            clashing = [f for f in work_pieces if f.footprint().intersects(corridor)]
            if clashing:
                out.append(ScoreItem(
                    "work_zone_on_route", -10.0,
                    "The {} sits on the main route in from the entrance".format(
                        clashing[0].role or clashing[0].type)))
            else:
                out.append(ScoreItem(
                    "work_zone_off_route", 6.0,
                    "The work zone is clear of the main circulation route from the entrance"))

        # "TV zone should have an unobstructed viewing direction"
        tv = ctx.first("tv", "tv_console")
        sofa = ctx.first("sofa", "l_sofa", "loveseat")
        if tv is not None and sofa is not None:
            sight = corridor_polygon(sofa.seat_point(), tv.bbox.center,
                                     ctx.config.clearances.circulation_min * 0.8)
            blockers = [
                f for f in items
                if f.id not in (tv.id, sofa.id) and not f.spec.flat
                and f.spec.height > 700.0
                and f.footprint().intersects(Shape.of(sight))
            ]
            if blockers:
                out.append(ScoreItem(
                    "viewing_line_blocked", -8.0,
                    "The {} stands in the line of sight between the sofa and the screen".format(
                        blockers[0].role or blockers[0].type)))
            else:
                out.append(ScoreItem(
                    "viewing_line_clear", 6.0,
                    "Nothing tall stands between the sofa and the screen"))

        desk = ctx.first("desk")
        if desk is not None and ctx.windows:
            nearest = min(
                ctx.windows,
                key=lambda w: desk.bbox.distance_to_rect(
                    w.access_zone(ctx.room, ctx.config.clearances.window_access_depth)))
            gap = desk.bbox.distance_to_rect(
                nearest.access_zone(ctx.room, ctx.config.clearances.window_access_depth))
            if gap <= 1000.0:
                out.append(ScoreItem("desk_daylight", 8.0,
                                     "The desk is {:.0f} mm from window '{}' without covering it".format(
                                         gap, nearest.id)))
        shelf = ctx.first("bookshelf")
        chair = ctx.first("reading_chair")
        if shelf is not None and chair is not None and gap_between(shelf, chair) <= 1500.0:
            out.append(ScoreItem("reading_zone_complete", 6.0,
                                 "The reading chair has direct access to the bookshelf"))
        return out
