"""
Layout 4 - Reading / relaxation layout (specification 7.4).

Built around the bookshelf: shelf on a solid wall, a reading chair beside it
(not in front of it), a side table within arm's reach and a lamp behind the
shoulder.

Rules enforced/scored here
    - bookshelf against a solid wall, never in front of a window
    - the reading chair does not block access to the shelves
    - side table within arm's reach, lamp beside or behind the chair
    - the reading chair never blocks the door or the entrance route
"""

from __future__ import annotations

from typing import List

from ..models.furniture import FurnitureCatalogue
from ..rules.context import PlacementContext, ScoreItem
from ..rules.furniture_rules import faces, gap_between, wall_behind
from .base import BaseLayout, PlacementSpec, Suitability


class ReadingLayout(BaseLayout):
    name = "reading"
    title = "Reading / relaxation layout"
    best_for = ["reading", "relaxation", "quiet living rooms"]
    purposes = ["reading", "relaxation", "quiet", "study"]

    def plan(self, analysis, requirements, catalogue: FurnitureCatalogue) -> List[PlacementSpec]:
        specs = [
            PlacementSpec(
                role="bookshelf", type="bookshelf",
                strategies=["solid_wall"],
                note="The bookshelf needs a solid wall with no window behind or beside it",
            ),
            PlacementSpec(
                role="reading_chair", type="reading_chair",
                strategies=["beside_facing", "near", "facing"], anchor="bookshelf",
                max_distance=1800.0,
                note="Reading chair beside the shelves, turned into the room so the shelves stay reachable",
            ),
            PlacementSpec(
                role="side_table_1", type="side_table",
                strategies=["beside"], anchor="reading_chair",
                note="Side table within arm's reach of the reading chair",
            ),
            PlacementSpec(
                role="lamp", type="lamp", required=False,
                strategies=["beside"], anchor="reading_chair",
                note="Floor lamp beside or behind the reading chair",
            ),
            PlacementSpec(
                role="sofa", type="sofa",
                strategies=["wall", "solid_wall"],
                note="Sofa for relaxed seating, away from the reading corner",
            ),
            PlacementSpec(
                role="coffee_table", type="coffee_table", required=False,
                strategies=["in_front_of"], anchor="sofa",
                note="Low table in front of the sofa",
            ),
            PlacementSpec(
                role="side_table_2", type="side_table", required=False,
                strategies=["beside"], anchor="sofa",
                note="Side table at the end of the sofa",
            ),
        ]
        return self.apply_requirements(specs, requirements)

    def suitability(self, analysis, requirements) -> Suitability:
        score = 12.0
        reasons: List[str] = []
        blockers: List[str] = []

        points, notes = self._purpose_match(requirements, self.purposes, 40.0)
        score += points
        reasons += notes

        solid = analysis.solid_walls()
        if not solid:
            blockers.append("No solid wall available for a bookshelf")
        else:
            best = solid[0]
            score += 12.0
            reasons.append(
                "The {} wall has a {:.0f} mm solid run for the bookshelf".format(
                    best.name, best.longest_solid_length
                )
            )

        if analysis.windows:
            score += 10.0
            reasons.append("Windows provide the natural light a reading corner wants")
        else:
            score -= 5.0
            reasons.append("No window, so the reading corner depends entirely on artificial light")

        if analysis.size_class == "small":
            score -= 4.0
            reasons.append("A small room fits a reading corner only if the sofa stays modest")
        else:
            score += 8.0
            reasons.append("There is room for a reading corner alongside the main seating")

        if self._requested(requirements, "bookshelf", "reading_chair"):
            score += 18.0
            reasons.append("User asked for a bookshelf / reading chair")
        return Suitability(self.name, score, reasons, blockers)

    def bonus(self, ctx: PlacementContext, items) -> List[ScoreItem]:
        out: List[ScoreItem] = []
        shelf = ctx.first("bookshelf")
        chair = ctx.first("reading_chair")
        if shelf is not None:
            wall = wall_behind(shelf, ctx.room)
            if wall and not ctx.analysis.wall_info(wall).has_window:
                out.append(ScoreItem("bookshelf_solid_wall", 10.0,
                                     "Bookshelf stands against the windowless {} wall".format(wall)))
        if shelf is not None and chair is not None:
            gap = gap_between(chair, shelf)
            if gap <= 1200.0 and not faces(chair, shelf, 40.0):
                out.append(ScoreItem("chair_beside_shelf", 8.0,
                                     "The reading chair is {:.0f} mm from the shelves and turned away from "
                                     "them, so the books stay reachable".format(gap)))
        lamp = ctx.first("lamp")
        if lamp is not None and chair is not None and gap_between(lamp, chair) <= 700.0:
            out.append(ScoreItem("lamp_position", 5.0, "The floor lamp is right beside the reading chair"))
        return out
