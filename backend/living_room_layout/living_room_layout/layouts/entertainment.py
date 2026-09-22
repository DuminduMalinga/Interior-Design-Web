"""
Layout 2 - TV / entertainment layout (specification 7.2).

The screen is the focal point: the media wall is chosen first, the sofa is
placed facing it at a sensible viewing distance, and everything else fills in
around that axis.

Rules enforced/scored here
    - sofa faces the TV
    - the TV sits on a solid wall, never opposite a large window
    - the coffee table sits between sofa and TV
    - lounge chairs do not cut the sofa-to-door route
"""

from __future__ import annotations

from typing import List

from ..models.furniture import FurnitureCatalogue
from ..models.room import OPPOSITE_WALL
from ..rules.context import PlacementContext, ScoreItem
from ..rules.furniture_rules import center_distance, facing_quality, wall_behind
from .base import BaseLayout, PlacementSpec, Suitability


class EntertainmentLayout(BaseLayout):
    name = "entertainment"
    title = "TV / entertainment layout"
    best_for = ["TV-focused rooms", "family rooms"]
    purposes = ["entertainment", "tv", "media", "movie"]

    def plan(self, analysis, requirements, catalogue: FurnitureCatalogue) -> List[PlacementSpec]:
        specs = [
            PlacementSpec(
                role="tv_console", type="tv_console",
                strategies=["media_wall", "solid_wall"],
                note="The console defines the media wall: solid, uninterrupted, away from glare",
            ),
            PlacementSpec(
                role="tv", type="tv",
                strategies=["on_console", "media_wall"], anchor="tv_console",
                note="Screen mounted on the media wall above the console",
            ),
            PlacementSpec(
                role="sofa", type="sofa",
                strategies=["opposite", "wall_facing", "floating"], anchor="tv",
                min_distance=1800.0, max_distance=4500.0,
                note="Main seating placed square to the screen at a comfortable viewing distance "
                     "(floated off the wall when the facing wall is glazed)",
            ),
            PlacementSpec(
                role="coffee_table", type="coffee_table",
                strategies=["in_front_of"], anchor="sofa",
                note="Table between the sofa and the screen, clear of the viewing line",
            ),
            PlacementSpec(
                role="chair_1", type="chair", required=False,
                strategies=["facing", "wall_facing", "corner"], anchor="tv",
                note="Lounge chair angled so it can see the screen without blocking the walkway",
            ),
            PlacementSpec(
                role="chair_2", type="chair", required=False,
                strategies=["facing", "wall_facing", "corner"], anchor="tv",
                note="Second lounge chair on the opposite side of the viewing axis",
            ),
            PlacementSpec(
                role="side_table_1", type="side_table", required=False,
                strategies=["beside"], anchor="sofa",
                note="Side table at the end of the sofa",
            ),
        ]
        return self.apply_requirements(specs, requirements)

    def suitability(self, analysis, requirements) -> Suitability:
        score = 18.0
        reasons: List[str] = []
        blockers: List[str] = []

        points, notes = self._purpose_match(requirements, self.purposes, 35.0)
        score += points
        reasons += notes

        media_wall = analysis.best_media_wall()
        if media_wall is None:
            blockers.append("No solid wall is available for a television")
        else:
            info = analysis.wall_info(media_wall)
            score += 15.0
            reasons.append(
                "The {} wall offers a {:.0f} mm solid run for the screen".format(
                    media_wall, info.longest_solid_length
                )
            )
            opposite = analysis.wall_info(OPPOSITE_WALL[media_wall])
            if opposite.window_coverage > 0.5:
                score -= 12.0
                reasons.append(
                    "The wall opposite the screen is {:.0f}% glazed, which will cause glare".format(
                        opposite.window_coverage * 100
                    )
                )

        # a viewing axis needs depth
        depth = min(analysis.room.width, analysis.room.length)
        if depth < 2600.0:
            score -= 12.0
            reasons.append("Only {:.0f} mm between opposite walls, tight for TV viewing".format(depth))
        elif depth >= 3200.0:
            score += 10.0
            reasons.append("{:.0f} mm across the room gives a comfortable viewing distance".format(depth))

        if self._requested(requirements, "tv", "tv_console"):
            score += 15.0
            reasons.append("User explicitly asked for a TV, which this layout centres the room on")
        elif not analysis.windows:
            score += 3.0
        return Suitability(self.name, score, reasons, blockers)

    def bonus(self, ctx: PlacementContext, items) -> List[ScoreItem]:
        out: List[ScoreItem] = []
        tv = ctx.first("tv", "tv_console")
        sofa = ctx.first("sofa", "l_sofa", "loveseat")
        if tv is None or sofa is None:
            return out
        gap = center_distance(sofa, tv)
        quality = facing_quality(sofa, tv)
        if quality > 0.8:
            out.append(ScoreItem("viewing_axis", 8.0,
                                 "The sofa is square to the screen, giving every seat the same view"))
        clear = ctx.config.clearances
        if clear.tv_distance_min <= gap <= clear.tv_distance_max:
            out.append(ScoreItem("viewing_distance", 6.0,
                                 "Viewing distance is {:.0f} mm, inside the recommended band".format(gap)))
        wall = wall_behind(tv, ctx.room)
        if wall and not ctx.analysis.wall_info(wall).has_window:
            out.append(ScoreItem("screen_wall_solid", 6.0,
                                 "The screen is on the windowless {} wall".format(wall)))

        # the lounge chairs exist to watch the screen too, not just to face
        # the sofa - without this, nothing rewards a chair actually angled
        # towards the TV and it can end up turned any which way.
        for chair in (f for f in items if f.type == "chair"):
            quality = facing_quality(chair, tv)
            if quality > 0.5:
                out.append(ScoreItem("chair_faces_screen", 8.0 * quality,
                                     "{} is angled towards the screen".format(chair.role or chair.type)))
        return out
