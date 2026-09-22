"""
Layout 3 - L-shaped / corner layout (specification 7.3).

An L-sofa pushed into a corner buys the most seating per square metre, which is
why this layout wins in small and awkward rooms.

Rules enforced/scored here
    - the L-sofa backs onto two walls, or one wall with an open return
    - the corner is used, not wasted
    - the tall (backed) part of the sofa never covers a window
    - the coffee table is reachable from both arms of the L
    - the accent chair faces the sofa and the door route stays open
"""

from __future__ import annotations

from typing import List

from ..models.furniture import FurnitureCatalogue
from ..rules.context import PlacementContext, ScoreItem
from ..models.geometry import Shape
from ..rules.furniture_rules import gap_between, touching_walls
from .base import BaseLayout, PlacementSpec, Suitability


class LShapedLayout(BaseLayout):
    name = "l_shaped"
    title = "L-shaped / corner layout"
    best_for = ["small rooms", "medium rooms", "awkward corners"]
    purposes = ["family_social", "compact", "lounging", "entertainment"]

    def plan(self, analysis, requirements, catalogue: FurnitureCatalogue) -> List[PlacementSpec]:
        specs = [
            PlacementSpec(
                role="l_sofa", type="l_sofa",
                strategies=["corner", "wall"],
                variants=("left", "right"),
                note="The L-sofa takes the corner so the middle of the room stays free",
            ),
            PlacementSpec(
                role="coffee_table", type="coffee_table",
                strategies=["in_front_of"], anchor="l_sofa",
                note="Table placed in the elbow of the L so both arms can reach it",
            ),
            PlacementSpec(
                role="tv_console", type="tv_console", required=False,
                strategies=["media_wall", "solid_wall"],
                note="Console on the wall the long arm of the sofa faces",
            ),
            PlacementSpec(
                role="tv", type="tv", required=False,
                strategies=["on_console", "media_wall"], anchor="tv_console",
                note="Screen above the console",
            ),
            PlacementSpec(
                role="chair_1", type="chair", required=False,
                strategies=["facing", "corner", "wall_facing"], anchor="l_sofa",
                min_distance=1500.0, max_distance=3000.0,
                note="Accent chair closing the fourth side of the seating group",
            ),
            PlacementSpec(
                role="side_table_1", type="side_table", required=False,
                strategies=["beside"], anchor="l_sofa",
                note="Side table at the open end of the L",
            ),
        ]
        return self.apply_requirements(specs, requirements)

    def suitability(self, analysis, requirements) -> Suitability:
        score = 15.0
        reasons: List[str] = []
        blockers: List[str] = []

        points, notes = self._purpose_match(requirements, self.purposes, 20.0)
        score += points
        reasons += notes

        if analysis.size_class == "small":
            score += 30.0
            reasons.append("A small room gains the most seats per square metre from an L-sofa in the corner")
        elif analysis.size_class == "medium":
            score += 16.0
            reasons.append("An L-sofa still leaves a medium room a usable open centre")
        else:
            score -= 5.0
            reasons.append("In a large room a corner sofa leaves the middle empty")

        # an L-sofa needs two clean wall runs meeting at a corner
        best_corner = None
        best_length = 0.0
        pairs = (("south", "west"), ("south", "east"), ("north", "west"), ("north", "east"))
        for a, b in pairs:
            ia, ib = analysis.wall_info(a), analysis.wall_info(b)
            usable = min(ia.longest_solid_length, ib.longest_solid_length)
            if usable > best_length:
                best_length, best_corner = usable, (a, b)
        if best_length < 1800.0:
            blockers.append(
                "No corner has two solid runs long enough for an L-sofa (best is {:.0f} mm)".format(best_length)
            )
        else:
            score += 10.0
            reasons.append(
                "The {}/{} corner has {:.0f} mm of solid wall on both sides".format(
                    best_corner[0], best_corner[1], best_length
                )
            )

        if analysis.proportion == "narrow":
            score += 6.0
            reasons.append("A corner arrangement copes well with a narrow floor plan")
        if self._requested(requirements, "l_sofa"):
            score += 20.0
            reasons.append("User asked for an L-shaped sofa")
        return Suitability(self.name, score, reasons, blockers)

    def placement_bias(self, item, spec: PlacementSpec, ctx: PlacementContext) -> float:
        """Steer the L-sofa towards a corner whose walls carry no glazing.

        The rule "do not cover windows with the tall portion of the sofa" has to
        influence candidate ranking, not just the final score, or the search
        never offers the clean corner as an option.
        """
        if item.type != "l_sofa":
            return 0.0
        points = 0.0
        walls = touching_walls(item, ctx.room)
        for wall_name in walls:
            info = ctx.analysis.wall_info(wall_name)
            if info.has_window:
                points -= 14.0
            if info.has_door:
                points -= 6.0
        return points

    def bonus(self, ctx: PlacementContext, items) -> List[ScoreItem]:
        out: List[ScoreItem] = []
        sofa = ctx.first("l_sofa")
        if sofa is None:
            return out
        walls = touching_walls(sofa, ctx.room)
        if len(walls) >= 2:
            out.append(ScoreItem("corner_used", 12.0,
                                 "The L-sofa backs onto the {} and {} walls, using the corner".format(*walls[:2])))
        elif walls:
            out.append(ScoreItem("one_wall_backed", 5.0,
                                 "The L-sofa backs onto the {} wall with an open return".format(walls[0])))
        # "Do not cover windows with the tall portion of the sofa": the backed
        # run of the L is the tall part, so check the wall it leans against.
        for wall_name in walls:
            info = ctx.analysis.wall_info(wall_name)
            if not info.has_window:
                continue
            covered = [
                w for w in info.windows
                if sofa.footprint().intersects(
                    Shape.of(w.access_zone(ctx.room, ctx.config.clearances.window_access_depth)))
            ]
            if covered:
                out.append(ScoreItem(
                    "l_sofa_backs_window", -10.0,
                    "The backed run of the L-sofa stands against window '{}' on the {} wall".format(
                        covered[0].id, wall_name)))
            else:
                out.append(ScoreItem(
                    "l_sofa_clear_of_window", 4.0,
                    "The backed run of the L-sofa clears the glazing on the {} wall".format(wall_name)))

        table = ctx.first("coffee_table")
        if table is not None:
            reach = gap_between(table, sofa)
            if reach <= ctx.config.clearances.coffee_table_max:
                out.append(ScoreItem("table_in_elbow", 6.0,
                                     "The coffee table sits in the elbow of the L, {:.0f} mm from both arms".format(reach)))
        return out
