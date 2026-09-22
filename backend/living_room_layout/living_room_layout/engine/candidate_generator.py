"""
Candidate position generation (specification 9 and 10).

Positions are never random.  Each layout tells the generator *how* a piece
relates to the room or to an already placed piece, and the matching strategy
turns that relation into a bounded set of concrete (x, y, rotation) candidates:

    wall / solid_wall / media_wall   slide along the free runs of a wall
    corner                           flush into each of the four corners
    center / floating                a coarse grid over the open floor
    opposite                         against the wall facing an anchor
    facing / wall_facing             turned towards an anchor
    in_front_of / beside / near      relative to an anchor piece
    near_window / at_desk / on_console  special pairings

Every candidate is tried at the orientations that make sense for its strategy;
the constraint checker then discards the invalid ones and the scorer ranks the
rest.
"""

from __future__ import annotations

import math
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from ..layouts.base import PlacementSpec
from ..models.furniture import ROTATIONS, Furniture, FurnitureSpec
from ..models.geometry import Rect, clamp, distance
from ..models.room import OPPOSITE_WALL, WALL_FACING_ROTATION, WALL_NAMES
from ..rules.context import PlacementContext
from ..rules.furniture_rules import wall_behind

FACING = {0: (0.0, 1.0), 90: (-1.0, 0.0), 180: (0.0, -1.0), 270: (1.0, 0.0)}


def rotation_towards(vector: Tuple[float, float]) -> int:
    """The cardinal rotation whose facing direction best matches `vector`."""
    return max(ROTATIONS, key=lambda r: FACING[r][0] * vector[0] + FACING[r][1] * vector[1])


def extent_at(spec: FurnitureSpec, rotation: int) -> Tuple[float, float]:
    return (spec.depth, spec.width) if rotation in (90, 270) else (spec.width, spec.depth)


class CandidateGenerator:
    """Builds the candidate placements for one `PlacementSpec`."""

    def __init__(self, analysis):
        self.analysis = analysis
        self.room = analysis.room
        self.config = analysis.config

    # ------------------------------------------------------------------ #
    # public entry point
    # ------------------------------------------------------------------ #
    def generate(
        self,
        spec: PlacementSpec,
        furniture_spec: FurnitureSpec,
        ctx: PlacementContext,
        placed_by_role: Dict[str, Furniture],
        item_id: str,
    ) -> List[Furniture]:
        anchor = placed_by_role.get(spec.anchor) if spec.anchor else None
        raw: List[Tuple[float, float, int, str, str]] = []

        for strategy in spec.strategies:
            raw.extend(self._run_strategy(strategy, spec, furniture_spec, ctx, anchor, placed_by_role))

        # a strategy that depends on a missing anchor falls back to the walls
        if not raw:
            raw.extend(self._strategy_wall(spec, furniture_spec, ctx, solid_only=False))
            raw.extend(self._strategy_center(spec, furniture_spec, ctx, margin=0.0, label="fallback_center"))

        candidates = self._materialise(raw, spec, furniture_spec, item_id)
        candidates = self._apply_zone(candidates, spec)
        return candidates[: self.config.search.max_candidates_per_item]

    # ------------------------------------------------------------------ #
    # strategy dispatch
    # ------------------------------------------------------------------ #
    def _run_strategy(self, strategy, spec, fspec, ctx, anchor, placed_by_role):
        if strategy == "wall":
            return self._strategy_wall(spec, fspec, ctx, solid_only=False)
        if strategy == "solid_wall":
            return self._strategy_wall(spec, fspec, ctx, solid_only=True)
        if strategy == "media_wall":
            return self._strategy_media_wall(spec, fspec, ctx)
        if strategy == "corner":
            return self._strategy_corner(spec, fspec, ctx)
        if strategy == "center":
            return self._strategy_center(spec, fspec, ctx, margin=0.0, label="center")
        if strategy == "floating":
            return self._strategy_center(
                spec, fspec, ctx, margin=self.config.clearances.circulation_min, label="floating"
            )
        if strategy == "near_window":
            return self._strategy_near_window(spec, fspec, ctx)
        if anchor is None:
            return []
        if strategy == "opposite":
            return self._strategy_opposite(spec, fspec, ctx, anchor)
        if strategy == "facing":
            return self._strategy_facing(spec, fspec, ctx, anchor)
        if strategy == "wall_facing":
            return self._strategy_wall_facing(spec, fspec, ctx, anchor)
        if strategy == "in_front_of":
            return self._strategy_in_front_of(spec, fspec, ctx, anchor)
        if strategy == "beside":
            return self._strategy_beside(spec, fspec, ctx, anchor)
        if strategy == "beside_facing":
            return self._strategy_beside_facing(spec, fspec, ctx, anchor)
        if strategy == "near":
            return self._strategy_near(spec, fspec, ctx, anchor)
        if strategy == "on_console":
            return self._strategy_on_console(spec, fspec, ctx, anchor)
        if strategy == "at_desk":
            return self._strategy_at_desk(spec, fspec, ctx, anchor)
        return []

    # ------------------------------------------------------------------ #
    # wall-based strategies
    # ------------------------------------------------------------------ #
    def _segments(self, wall_name: str, solid_only: bool):
        info = self.analysis.wall_info(wall_name)
        return info.solid_segments if solid_only else info.door_free_segments

    def _slots_on_wall(self, wall_name: str, rotation: int, fspec: FurnitureSpec, segments, step: float):
        """Flush-to-wall positions for one wall at one rotation."""
        wall = self.room.wall(wall_name)
        dx, dy = extent_at(fspec, rotation)
        horizontal = wall.is_horizontal
        along = dx if horizontal else dy
        depth = dy if horizontal else dx
        out: List[Tuple[float, float]] = []
        for segment in segments:
            if segment.length + 1.0 < along:
                continue
            lo = segment.start
            hi = segment.end - along
            positions = self._sample(lo, hi, step)
            positions.append(segment.middle - along / 2.0)  # centred in the run
            for p in positions:
                p = clamp(p, 0.0, wall.length - along)
                if wall_name == "south":
                    out.append((p, 0.0))
                elif wall_name == "north":
                    out.append((p, self.room.length - depth))
                elif wall_name == "west":
                    out.append((0.0, p))
                else:
                    out.append((self.room.width - depth, p))
        return out

    def _strategy_wall(self, spec, fspec, ctx, solid_only: bool):
        step = self.config.search.wall_slide_step
        walls = spec.walls or list(WALL_NAMES)
        label = "solid_wall" if solid_only else "wall"
        out = []
        for wall_name in walls:
            rotation = WALL_FACING_ROTATION[wall_name]
            segments = self._segments(wall_name, solid_only)
            for (x, y) in self._slots_on_wall(wall_name, rotation, fspec, segments, step):
                for variant in spec.variants:
                    out.append((x, y, rotation, variant, "{}:{}".format(label, wall_name)))
        return out

    def _strategy_media_wall(self, spec, fspec, ctx):
        best = self.analysis.best_media_wall()
        order = ([best] if best else []) + [w.name for w in self.analysis.solid_walls() if w.name != best]
        step = self.config.search.wall_slide_step
        out = []
        for rank, wall_name in enumerate(order):
            rotation = WALL_FACING_ROTATION[wall_name]
            segments = self._segments(wall_name, solid_only=True)
            label = "media_wall:{}".format(wall_name) if rank == 0 else "solid_wall:{}".format(wall_name)
            for (x, y) in self._slots_on_wall(wall_name, rotation, fspec, segments, step):
                out.append((x, y, rotation, spec.variants[0], label))
        return out

    def _strategy_corner(self, spec, fspec, ctx):
        out = []
        corners = (
            ("south", "west", 0.0, 0.0),
            ("south", "east", 1.0, 0.0),
            ("north", "west", 0.0, 1.0),
            ("north", "east", 1.0, 1.0),
        )
        for wall_a, wall_b, fx, fy in corners:
            for rotation in (WALL_FACING_ROTATION[wall_a], WALL_FACING_ROTATION[wall_b]):
                dx, dy = extent_at(fspec, rotation)
                x = 0.0 if fx == 0.0 else self.room.width - dx
                y = 0.0 if fy == 0.0 else self.room.length - dy
                for variant in spec.variants:
                    out.append((x, y, rotation, variant, "corner:{}_{}".format(wall_a, wall_b)))
        return out

    def _strategy_center(self, spec, fspec, ctx, margin: float, label: str):
        step = self.config.search.open_grid_step
        out = []
        for rotation in ROTATIONS:
            dx, dy = extent_at(fspec, rotation)
            lo_x, hi_x = margin, self.room.width - dx - margin
            lo_y, hi_y = margin, self.room.length - dy - margin
            if hi_x < lo_x or hi_y < lo_y:
                continue
            for x in self._sample(lo_x, hi_x, step):
                for y in self._sample(lo_y, hi_y, step):
                    out.append((x, y, rotation, spec.variants[0], label))
        return out

    # ------------------------------------------------------------------ #
    # anchor-based strategies
    # ------------------------------------------------------------------ #
    def _strategy_opposite(self, spec, fspec, ctx, anchor: Furniture):
        """Against the wall opposite the anchor, aligned with it."""
        wall = wall_behind(anchor, self.room)
        if wall is None:
            return []
        target = OPPOSITE_WALL[wall]
        rotation = WALL_FACING_ROTATION[target]
        step = self.config.search.wall_slide_step
        segments = self._segments(target, solid_only=False)
        anchor_axis = anchor.center[0] if self.room.wall(target).is_horizontal else anchor.center[1]
        out = []
        for (x, y) in self._slots_on_wall(target, rotation, fspec, segments, step):
            dx, dy = extent_at(fspec, rotation)
            centre = x + dx / 2.0 if self.room.wall(target).is_horizontal else y + dy / 2.0
            if abs(centre - anchor_axis) > 1400.0:
                continue
            out.append((x, y, rotation, spec.variants[0], "opposite:{}".format(target)))
        return out

    def _strategy_facing(self, spec, fspec, ctx, anchor: Furniture):
        """On an arc in front of the anchor, turned towards it."""
        lo = spec.min_distance or self.config.clearances.conversation_min
        hi = spec.max_distance or self.config.clearances.conversation_max
        origin = anchor.seat_point()
        af = anchor.facing
        out = []
        for angle in (-75.0, -55.0, -35.0, -15.0, 0.0, 15.0, 35.0, 55.0, 75.0):
            rad = math.radians(angle)
            direction = (
                af[0] * math.cos(rad) - af[1] * math.sin(rad),
                af[0] * math.sin(rad) + af[1] * math.cos(rad),
            )
            for radius in self._sample(lo, hi, 400.0):
                cx = origin[0] + direction[0] * radius
                cy = origin[1] + direction[1] * radius
                rotation = rotation_towards((origin[0] - cx, origin[1] - cy))
                dx, dy = extent_at(fspec, rotation)
                x, y = cx - dx / 2.0, cy - dy / 2.0
                if not self._inside(x, y, dx, dy):
                    continue
                out.append((x, y, rotation, spec.variants[0], "facing:{}".format(anchor.role or anchor.type)))
        return out

    def _strategy_wall_facing(self, spec, fspec, ctx, anchor: Furniture):
        """Against a wall, but rotated to face the anchor."""
        step = self.config.search.wall_slide_step
        out = []
        for wall_name in WALL_NAMES:
            rotation = WALL_FACING_ROTATION[wall_name]
            segments = self._segments(wall_name, solid_only=False)
            for (x, y) in self._slots_on_wall(wall_name, rotation, fspec, segments, step):
                dx, dy = extent_at(fspec, rotation)
                cx, cy = x + dx / 2.0, y + dy / 2.0
                to_anchor = (anchor.seat_point()[0] - cx, anchor.seat_point()[1] - cy)
                if FACING[rotation][0] * to_anchor[0] + FACING[rotation][1] * to_anchor[1] <= 0:
                    continue  # the wall would put the anchor behind this piece
                out.append((x, y, rotation, spec.variants[0], "wall_facing:{}".format(wall_name)))
        return out

    def _strategy_in_front_of(self, spec, fspec, ctx, anchor: Furniture):
        """Directly in front of the anchor at the prescribed gap."""
        clear = self.config.clearances
        gaps = [clear.coffee_table_min, (clear.coffee_table_min + clear.coffee_table_max) / 2.0,
                clear.coffee_table_max, clear.coffee_table_max + 150.0]
        af = anchor.facing
        anchor_front = anchor.front_center(0.0)
        out = []
        for rotation in (anchor.rotation, (anchor.rotation + 90) % 360):
            dx, dy = extent_at(fspec, rotation)
            for gap in gaps:
                for lateral in (-600.0, -300.0, 0.0, 300.0, 600.0):
                    # perpendicular offset along the anchor's face
                    perp = (-af[1], af[0])
                    cx = anchor_front[0] + af[0] * (gap + (dy if af[1] else dx) / 2.0) + perp[0] * lateral
                    cy = anchor_front[1] + af[1] * (gap + (dy if af[1] else dx) / 2.0) + perp[1] * lateral
                    x, y = cx - dx / 2.0, cy - dy / 2.0
                    if not self._inside(x, y, dx, dy):
                        continue
                    out.append((x, y, rotation, spec.variants[0],
                                "in_front_of:{}".format(anchor.role or anchor.type)))
        return out

    def _strategy_beside(self, spec, fspec, ctx, anchor: Furniture):
        """At either end of the anchor, flush with its front or its back.

        Gaps are ordered snuggest-first (2-5 cm, reading as "attached" to the
        seat) with a couple of looser fallbacks so the strategy still finds a
        legal spot when the tightest ones are blocked by a crowded room -
        never returning zero candidates matters here: an anchored strategy
        that comes back empty falls through to `generate()`'s wall/centre
        fallback, which is anchor-*independent* and can land the piece
        anywhere, nowhere near the seat it was meant to sit beside. The soft
        scorer (`side_table_within_reach`) prefers the snug end of this list,
        not just "anywhere inside arm's reach".
        """
        box = anchor.bbox
        af = anchor.facing
        perp = (-af[1], af[0])
        out = []
        for rotation in (anchor.rotation, (anchor.rotation + 90) % 360):
            dx, dy = extent_at(fspec, rotation)
            half_along = (box.width if af[1] else box.height) / 2.0
            for side in (-1.0, 1.0):
                for gap in (0.0, 20.0, 50.0, 120.0, 250.0):
                    for depth_shift in (0.0, -250.0, 250.0):
                        cx = box.cx + perp[0] * side * (half_along + gap + (dx if perp[0] else dy) / 2.0)
                        cy = box.cy + perp[1] * side * (half_along + gap + (dy if perp[1] else dx) / 2.0)
                        cx += af[0] * depth_shift
                        cy += af[1] * depth_shift
                        x, y = cx - dx / 2.0, cy - dy / 2.0
                        if not self._inside(x, y, dx, dy):
                            continue
                        out.append((x, y, rotation, spec.variants[0],
                                    "beside:{}".format(anchor.role or anchor.type)))
        return out

    def _strategy_beside_facing(self, spec, fspec, ctx, anchor: Furniture):
        """Beside the anchor on the same wall, turned into the room.

        This is what keeps a reading chair *next to* the bookshelf rather than
        in front of it, so the shelves stay reachable.
        """
        wall = wall_behind(anchor, self.room)
        out = []
        if wall is not None:
            wall_obj = self.room.wall(wall)
            anchor_pos = wall_obj.position_of(anchor.bbox.center)
            anchor_half = (anchor.bbox.width if wall_obj.is_horizontal else anchor.bbox.height) / 2.0
            for rotation in (WALL_FACING_ROTATION[wall],
                             (WALL_FACING_ROTATION[wall] + 90) % 360,
                             (WALL_FACING_ROTATION[wall] + 270) % 360):
                dx, dy = extent_at(fspec, rotation)
                along = dx if wall_obj.is_horizontal else dy
                for side in (-1.0, 1.0):
                    for gap in (100.0, 350.0, 700.0):
                        pos = anchor_pos + side * (anchor_half + gap + along / 2.0) - along / 2.0
                        x, y = self._wall_point(wall, pos, rotation, fspec)
                        if x is None:
                            continue
                        out.append((x, y, rotation, spec.variants[0],
                                    "beside_facing:{}".format(anchor.role or anchor.type)))
        out.extend(self._strategy_near(spec, fspec, ctx, anchor))
        return out

    def _strategy_near(self, spec, fspec, ctx, anchor: Furniture):
        """On a ring around the anchor, at every orientation."""
        limit = spec.max_distance or 1600.0
        origin = anchor.bbox.center
        out = []
        for angle in range(0, 360, 30):
            rad = math.radians(angle)
            for radius in self._sample(700.0, max(900.0, limit), 400.0):
                cx = origin[0] + math.cos(rad) * radius
                cy = origin[1] + math.sin(rad) * radius
                for rotation in ROTATIONS:
                    dx, dy = extent_at(fspec, rotation)
                    x, y = cx - dx / 2.0, cy - dy / 2.0
                    if not self._inside(x, y, dx, dy):
                        continue
                    out.append((x, y, rotation, spec.variants[0],
                                "near:{}".format(anchor.role or anchor.type)))
        return out

    def _strategy_near_window(self, spec, fspec, ctx):
        """Under or beside a window: the daylight positions."""
        step = 250.0
        out = []
        for window in self.analysis.windows:
            wall_name = window.wall
            wall = self.room.wall(wall_name)
            rotation = WALL_FACING_ROTATION[wall_name]
            for rot in (rotation, (rotation + 90) % 360, (rotation + 270) % 360):
                dx, dy = extent_at(fspec, rot)
                along = dx if wall.is_horizontal else dy
                lo = max(0.0, window.start - 600.0)
                hi = min(wall.length - along, window.end + 600.0 - along)
                for pos in self._sample(lo, hi, step):
                    x, y = self._wall_point(wall_name, pos, rot, fspec)
                    if x is None:
                        continue
                    out.append((x, y, rot, spec.variants[0], "near_window:{}".format(window.id)))
            # also perpendicular to the window on the adjoining walls
            for other in WALL_NAMES:
                if other in (wall_name, OPPOSITE_WALL[wall_name]):
                    continue
                rot2 = WALL_FACING_ROTATION[other]
                segments = self._segments(other, solid_only=False)
                for (x, y) in self._slots_on_wall(other, rot2, fspec, segments, step):
                    if distance((x, y), window.center_point(self.room)) <= 2200.0:
                        out.append((x, y, rot2, spec.variants[0], "near_window:{}".format(window.id)))
        return out

    def _strategy_on_console(self, spec, fspec, ctx, anchor: Furniture):
        """A TV sits on/above its console, flush to the same wall."""
        rotation = anchor.rotation
        out = []
        wall = wall_behind(anchor, self.room)
        if wall is not None:
            wall_obj = self.room.wall(wall)
            dx, dy = extent_at(fspec, rotation)
            along = dx if wall_obj.is_horizontal else dy
            anchor_along = anchor.bbox.width if wall_obj.is_horizontal else anchor.bbox.height
            anchor_start = wall_obj.position_of((anchor.bbox.x0, anchor.bbox.y0))
            base = anchor_start + (anchor_along - along) / 2.0
            for lateral in (0.0, -200.0, 200.0):
                x, y = self._wall_point(wall, base + lateral, rotation, fspec)
                if x is None:
                    continue
                out.append((x, y, rotation, spec.variants[0], "on_console"))
        if not out:  # console is free standing: centre the screen on its back
            box = anchor.bbox
            dx, dy = extent_at(fspec, rotation)
            af = anchor.facing
            cx = box.cx - af[0] * (box.width - dx) / 2.0
            cy = box.cy - af[1] * (box.height - dy) / 2.0
            x, y = cx - dx / 2.0, cy - dy / 2.0
            if self._inside(x, y, dx, dy):
                out.append((x, y, rotation, spec.variants[0], "on_console"))
        return out

    def _strategy_at_desk(self, spec, fspec, ctx, anchor: Furniture):
        """Desk chair tucked in front of the desk."""
        af = anchor.facing
        out = []
        for gap in (0.0, 150.0, 350.0):
            for lateral in (-200.0, 0.0, 200.0):
                perp = (-af[1], af[0])
                front = anchor.front_center(gap)
                for rotation in ((anchor.rotation + 180) % 360, anchor.rotation):
                    dx, dy = extent_at(fspec, rotation)
                    cx = front[0] + af[0] * (dy if af[1] else dx) / 2.0 + perp[0] * lateral
                    cy = front[1] + af[1] * (dy if af[1] else dx) / 2.0 + perp[1] * lateral
                    x, y = cx - dx / 2.0, cy - dy / 2.0
                    if not self._inside(x, y, dx, dy):
                        continue
                    out.append((x, y, rotation, spec.variants[0], "at_desk"))
        return out

    # ------------------------------------------------------------------ #
    # helpers
    # ------------------------------------------------------------------ #
    @staticmethod
    def _sample(lo: float, hi: float, step: float) -> List[float]:
        if hi < lo:
            return []
        if step >= (hi - lo):
            return [lo, hi] if hi > lo else [lo]
        values = []
        value = lo
        while value < hi:
            values.append(value)
            value += step
        values.append(hi)
        return values

    def _inside(self, x: float, y: float, dx: float, dy: float) -> bool:
        return x >= -1.0 and y >= -1.0 and x + dx <= self.room.width + 1.0 and y + dy <= self.room.length + 1.0

    def _wall_point(self, wall_name: str, position: float, rotation: int, fspec: FurnitureSpec):
        """Flush-to-wall (x, y) for a piece starting at `position` along the wall."""
        wall = self.room.wall(wall_name)
        dx, dy = extent_at(fspec, rotation)
        along = dx if wall.is_horizontal else dy
        depth = dy if wall.is_horizontal else dx
        if position < -1.0 or position + along > wall.length + 1.0:
            return (None, None)
        position = clamp(position, 0.0, wall.length - along)
        if wall_name == "south":
            return (position, 0.0)
        if wall_name == "north":
            return (position, self.room.length - depth)
        if wall_name == "west":
            return (0.0, position)
        return (self.room.width - depth, position)

    def _materialise(self, raw, spec: PlacementSpec, fspec: FurnitureSpec, item_id: str) -> List[Furniture]:
        seen = set()
        out: List[Furniture] = []
        for (x, y, rotation, variant, strategy) in raw:
            key = (round(x / 25.0), round(y / 25.0), rotation % 360, variant)
            if key in seen:
                continue
            seen.add(key)
            out.append(
                Furniture(
                    id=item_id,
                    spec=fspec,
                    x=round(x, 1),
                    y=round(y, 1),
                    rotation=rotation % 360,
                    variant=variant,
                    role=spec.role,
                    strategy=strategy,
                )
            )
        return out

    def _apply_zone(self, candidates: List[Furniture], spec: PlacementSpec) -> List[Furniture]:
        """Restrict to the layout zone, but never return an empty list because of it."""
        if spec.zone is None:
            return candidates
        zone: Rect = spec.zone
        inside = [c for c in candidates if zone.contains_point(c.center, tol=200.0)]
        return inside if inside else candidates
