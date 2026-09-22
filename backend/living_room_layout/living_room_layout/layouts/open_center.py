"""
Layout 5 - Open-centre layout (specification 7.5).

For large rooms: the seating group is pulled away from the walls to form an
island, with circulation running around its perimeter instead of through it.

Rules enforced/scored here
    - a balanced centre; the sofa defines the seating zone
    - chairs face the sofa, coffee table centred in the group
    - perimeter circulation is preserved
    - not every piece is shoved against a wall
"""

from __future__ import annotations

from typing import List

from ..models.furniture import FurnitureCatalogue
from ..models.geometry import Rect, distance
from ..rules.context import PlacementContext, ScoreItem
from ..rules.furniture_rules import distance_to_nearest_wall, is_against_wall
from .base import BaseLayout, PlacementSpec, Suitability


def perimeter_clear_fraction(ctx: PlacementContext, items) -> float:
    """Fraction of the perimeter walkway (a band along all four walls) left free.

    Layout 5 depends on circulation running *around* the furniture rather than
    through it, so this measures the ring rather than the whole floor.
    """
    room = ctx.room
    band = ctx.config.clearances.circulation_min
    strips = [
        Rect(0.0, 0.0, room.width, band),                       # south
        Rect(0.0, room.length - band, room.width, band),        # north
        Rect(0.0, 0.0, band, room.length),                      # west
        Rect(room.width - band, 0.0, band, room.length),        # east
    ]
    total = sum(strip.area for strip in strips)
    blocked = 0.0
    for strip in strips:
        for item in items:
            if item.spec.flat:
                continue
            for part in item.part_rects():
                blocked += strip.intersection_area(part)
    return max(0.0, min(1.0, 1.0 - blocked / total)) if total else 1.0


class OpenCenterLayout(BaseLayout):
    name = "open_center"
    title = "Open-centre layout"
    best_for = ["large living rooms", "open-plan houses"]
    purposes = ["family_social", "entertaining", "open_plan", "conversation"]

    def plan(self, analysis, requirements, catalogue: FurnitureCatalogue) -> List[PlacementSpec]:
        specs = [
            PlacementSpec(
                role="sofa", type="sofa",
                strategies=["floating", "wall"],
                note="The sofa floats clear of the wall and defines the seating island",
            ),
            PlacementSpec(
                role="coffee_table", type="coffee_table",
                strategies=["in_front_of"], anchor="sofa",
                note="Large table anchoring the centre of the group",
            ),
            PlacementSpec(
                role="chair_1", type="chair",
                strategies=["facing", "floating"], anchor="sofa",
                min_distance=1500.0, max_distance=3000.0,
                note="Accent chair facing the sofa across the table",
            ),
            PlacementSpec(
                role="chair_2", type="chair",
                strategies=["facing", "floating"], anchor="sofa",
                min_distance=1500.0, max_distance=3000.0,
                note="Second accent chair balancing the group",
            ),
            PlacementSpec(
                role="tv_console", type="tv_console", required=False,
                strategies=["media_wall", "solid_wall"],
                note="Media unit on the wall the seating island faces",
            ),
            PlacementSpec(
                role="tv", type="tv", required=False,
                strategies=["on_console", "media_wall"], anchor="tv_console",
                note="Screen above the console",
            ),
            PlacementSpec(
                role="side_table_1", type="side_table", required=False,
                strategies=["beside"], anchor="sofa",
                note="Side table serving the sofa",
            ),
            PlacementSpec(
                role="side_table_2", type="side_table", required=False,
                strategies=["beside"], anchor="chair_1",
                note="Side table serving the chairs",
            ),
        ]
        return self.apply_requirements(specs, requirements)

    def suitability(self, analysis, requirements) -> Suitability:
        score = 8.0
        reasons: List[str] = []
        blockers: List[str] = []

        points, notes = self._purpose_match(requirements, self.purposes, 15.0)
        score += points
        reasons += notes

        if analysis.size_class == "large":
            score += 35.0
            reasons.append("A large room ({:.1f} m2) can afford an island of seating with circulation all round".format(
                analysis.area_m2))
        elif analysis.size_class == "medium":
            score += 4.0
            reasons.append("A medium room can float the seating only if the walkways stay narrow")
        else:
            blockers.append("A small room cannot keep circulation around a floating seating group")

        needed = 2 * analysis.config.clearances.circulation_min + 2200.0
        if min(analysis.room.width, analysis.room.length) < needed:
            blockers.append(
                "The room is only {:.0f} mm across; {:.0f} mm is needed to walk around a floating sofa".format(
                    min(analysis.room.width, analysis.room.length), needed
                )
            )
        else:
            score += 10.0
            reasons.append("There is room to walk around all four sides of the seating group")

        if analysis.proportion == "square":
            score += 8.0
            reasons.append("Square proportions keep a floating group visually balanced")
        return Suitability(self.name, score, reasons, blockers)

    def placement_bias(self, item, spec, ctx) -> float:
        """Pull the seating group off the walls: that is the whole idea here."""
        if not item.spec.is_seating:
            return 0.0
        gap = distance_to_nearest_wall(item, ctx.room)
        if gap >= ctx.config.clearances.circulation_min:
            return 16.0        # a real walkway behind the seat
        if is_against_wall(item, ctx.room):
            return -14.0       # cancels the generic wall-alignment reward
        return 0.0

    def bonus(self, ctx: PlacementContext, items) -> List[ScoreItem]:
        out: List[ScoreItem] = []
        sofa = ctx.first("sofa", "l_sofa", "loveseat")
        if sofa is None:
            return out
        gap = distance_to_nearest_wall(sofa, ctx.room)
        if gap >= ctx.config.clearances.circulation_min:
            out.append(ScoreItem("floating_sofa", 12.0,
                                 "The sofa floats {:.0f} mm off the wall, so people can walk behind it".format(gap)))
        seats = [f for f in items if f.spec.is_seating]
        if len(seats) >= 3:
            cx = sum(s.seat_point()[0] for s in seats) / len(seats)
            cy = sum(s.seat_point()[1] for s in seats) / len(seats)
            offset = distance((cx, cy), ctx.room.center)
            if offset <= 900.0:
                out.append(ScoreItem("balanced_centre", 10.0,
                                     "The seating group is centred in the room ({:.0f} mm off)".format(offset)))
        # "Maintain a clear perimeter circulation path": a walkable ring has to
        # survive all the way round the seating island.
        ring = perimeter_clear_fraction(ctx, items)
        if ring >= 0.95:
            out.append(ScoreItem("perimeter_circulation", 10.0,
                                 "A clear walking route runs right around the seating island"))
        elif ring >= 0.7:
            out.append(ScoreItem("perimeter_circulation_partial", 4.0 * ring,
                                 "{:.0f}% of the perimeter route stays clear".format(ring * 100)))
        else:
            out.append(ScoreItem("perimeter_blocked", -8.0,
                                 "Only {:.0f}% of the perimeter route is clear, so people have to "
                                 "cut through the seating group".format(ring * 100)))

        wall_hugging = [f for f in items if f.spec.is_seating and is_against_wall(f, ctx.room)]
        if len(wall_hugging) == len(seats) and seats:
            out.append(ScoreItem("everything_against_walls", -8.0,
                                 "Every seat ended up against a wall, which defeats an open-centre plan"))
        return out
