"""
Layout 1 - Conversation layout (specification 7.1).

Sofa plus two accent chairs turned towards each other around a central coffee
table.  The TV, if any, is secondary: seating faces seating, not a screen.

Rules enforced/scored here
    - sofa and chairs face each other
    - seating 1.5-3 m apart
    - coffee table centred between the seating
    - chairs clear of doors, windows unobstructed, entrance path clear
"""

from __future__ import annotations

from typing import List

from ..models.furniture import FurnitureCatalogue
from ..rules.context import PlacementContext, ScoreItem
from ..rules.furniture_rules import center_distance, facing_quality, gap_between
from .base import BaseLayout, PlacementSpec, Suitability


class ConversationLayout(BaseLayout):
    name = "conversation"
    title = "Conversation layout"
    best_for = ["family rooms", "socialising", "entertaining guests"]
    purposes = ["family_social", "conversation", "socializing", "guests"]

    def plan(self, analysis, requirements, catalogue: FurnitureCatalogue) -> List[PlacementSpec]:
        specs = [
            PlacementSpec(
                role="sofa", type="sofa",
                strategies=["wall", "solid_wall"],
                note="The sofa anchors the conversation group against the longest usable wall",
            ),
            PlacementSpec(
                role="coffee_table", type="coffee_table",
                strategies=["in_front_of"], anchor="sofa",
                note="Central table shared by every seat",
            ),
            PlacementSpec(
                role="chair_1", type="chair",
                strategies=["facing", "wall_facing"], anchor="sofa",
                min_distance=1500.0, max_distance=3000.0,
                note="Accent chair angled towards the sofa to close the conversation circle",
            ),
            PlacementSpec(
                role="chair_2", type="chair",
                strategies=["facing", "wall_facing"], anchor="sofa",
                min_distance=1500.0, max_distance=3000.0,
                note="Second accent chair opposite the first, keeping the group symmetric",
            ),
            PlacementSpec(
                role="side_table_1", type="side_table", required=False,
                strategies=["beside"], anchor="sofa",
                note="Side table within arm's reach of the sofa",
            ),
            PlacementSpec(
                role="side_table_2", type="side_table", required=False,
                strategies=["beside"], anchor="chair_1",
                note="Second side table serving the accent chairs",
            ),
            PlacementSpec(
                role="tv_console", type="tv_console", required=False,
                strategies=["opposite", "media_wall", "solid_wall"], anchor="sofa",
                note="Optional media unit; in this layout the TV is not the focus, but it "
                     "still goes on the wall facing the sofa when that wall is usable",
            ),
            PlacementSpec(
                role="tv", type="tv", required=False,
                strategies=["on_console", "media_wall"], anchor="tv_console",
                note="Optional screen above the console",
            ),
        ]
        return self.apply_requirements(specs, requirements)

    def suitability(self, analysis, requirements) -> Suitability:
        score = 20.0
        reasons: List[str] = ["Conversation seating suits any room with one good wall for a sofa"]
        blockers: List[str] = []

        points, notes = self._purpose_match(requirements, self.purposes, 35.0)
        score += points
        reasons += notes

        if analysis.size_class == "medium":
            score += 15.0
            reasons.append("A medium room has room for a sofa plus two chairs without crowding")
        elif analysis.size_class == "large":
            score += 8.0
            reasons.append("A large room can host a conversation group, though it may leave dead corners")
        else:
            score -= 10.0
            reasons.append("A small room struggles to fit two extra chairs at conversation distance")

        if analysis.proportion == "square":
            score += 8.0
            reasons.append("Square proportions suit a facing seating circle")
        elif analysis.proportion == "narrow":
            score -= 6.0
            reasons.append("A narrow room makes facing seating hard to keep 1.5-3 m apart")

        longest = max((w.longest_solid_length for w in analysis.walls.values()), default=0.0)
        if longest < 2400.0:
            blockers.append("No wall run long enough ({:.0f} mm) for a 2200 mm sofa".format(longest))
        else:
            score += 6.0
            reasons.append("Longest solid wall run is {:.0f} mm, enough for the sofa".format(longest))

        if self._requested(requirements, "chair"):
            score += 10.0
            reasons.append("User asked for chairs, which this layout arranges around the sofa")
        return Suitability(self.name, score, reasons, blockers)

    def bonus(self, ctx: PlacementContext, items) -> List[ScoreItem]:
        out: List[ScoreItem] = []
        sofa = ctx.first("sofa", "l_sofa", "loveseat")
        chairs = [f for f in items if f.type in ("chair", "reading_chair")]
        pairs = 0
        for i in range(len(chairs)):
            for j in range(i + 1, len(chairs)):
                gap = center_distance(chairs[i], chairs[j])
                if 1500.0 <= gap <= 3600.0:
                    pairs += 1
        if pairs:
            out.append(ScoreItem("conversation_circle", 4.0 * pairs,
                                 "{} pair(s) of chairs sit within talking distance of each other".format(pairs)))
        if sofa is not None and len(chairs) >= 2:
            quality = sum(facing_quality(c, sofa) for c in chairs) / len(chairs)
            out.append(ScoreItem("chairs_face_sofa", 10.0 * quality,
                                 "Accent chairs are turned towards the sofa"))
        return out
