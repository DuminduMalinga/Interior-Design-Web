"""
Soft constraints (specification 6 and 12).

Soft constraints never invalidate a layout - they rank the valid ones.  Every
component returns `ScoreItem` records rather than a bare number, so the final
report can say exactly where the points came from, which is the whole point of
a rule-based system.

Scoring is split into the seven components named in the specification:

    circulation, relationships, wall alignment, window access, door access,
    symmetry, usability

plus explicit penalties.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from ..models.furniture import Furniture
from ..models.geometry import Rect, clamp, distance, segment_overlap
from ..models.room import OPPOSITE_WALL
from .circulation_rules import (
    CirculationReport,
    analyse_circulation,
    build_grid,
    entrance_corridor,
)
from .context import PlacementContext, ScoreItem
from .door_rules import distance_to_nearest_door, preferred_clearance_satisfied
from .furniture_rules import (
    alignment_offset,
    center_distance,
    facing_quality,
    faces,
    gap_between,
    in_front_of,
    is_against_wall,
    touching_walls,
    wall_behind,
)
from .window_rules import window_coverage_penalty_terms


@dataclass
class LayoutScore:
    """The complete soft-constraint evaluation of one layout."""

    total: float = 0.0
    components: Dict[str, float] = field(default_factory=dict)
    items: List[ScoreItem] = field(default_factory=list)
    circulation: Optional[CirculationReport] = None

    def add(self, component: str, entries: List[ScoreItem]) -> None:
        points = sum(e.points for e in entries)
        self.components[component] = round(self.components.get(component, 0.0) + points, 2)
        self.items.extend(entries)
        self.total = round(self.total + points, 2)

    def positives(self) -> List[ScoreItem]:
        return [i for i in self.items if i.points > 0]

    def negatives(self) -> List[ScoreItem]:
        return [i for i in self.items if i.points < 0]

    def to_dict(self) -> Dict:
        return {
            "total": round(self.total, 1),
            "components": dict(self.components),
            "contributions": [i.to_dict() for i in sorted(self.items, key=lambda s: -s.points)],
        }


def _label(item: Furniture) -> str:
    return item.role or item.type


# --------------------------------------------------------------------------- #
# 1. circulation
# --------------------------------------------------------------------------- #
def circulation_score(ctx: PlacementContext, items: List[Furniture], report: CirculationReport) -> List[ScoreItem]:
    w = ctx.config.weights
    out: List[ScoreItem] = []
    if report.valid:
        out.append(ScoreItem("circulation_valid", w.good_circulation,
                             "A continuous walking path links the entrance to every seat and opening"))
        if report.preferred_width_met:
            out.append(ScoreItem("circulation_preferred_width", w.preferred_circulation_width,
                                 "The path is a comfortable 1200 mm wide, not just the 900 mm minimum"))
    else:
        out.append(ScoreItem("circulation_poor", w.penalty_poor_circulation,
                             "Parts of the room cannot be reached from the entrance"))
    if report.reachable_ratio < 0.6:
        out.append(ScoreItem("circulation_reach", w.penalty_crowding,
                             "Only {:.0f}% of the walkable space connects to the entrance".format(
                                 report.reachable_ratio * 100)))
    return out


# --------------------------------------------------------------------------- #
# 2. furniture relationships (specification 11)
# --------------------------------------------------------------------------- #
def furniture_relationship_score(ctx: PlacementContext, items: List[Furniture]) -> List[ScoreItem]:
    w = ctx.config.weights
    clear = ctx.config.clearances
    out: List[ScoreItem] = []
    by = lambda *keys: _find(items, *keys)

    sofa = _primary_sofa(items)
    tv = by("tv") or by("tv_console")
    table = by("coffee_table")
    chairs = [f for f in items if f.type in ("chair", "reading_chair") and f is not sofa]
    bookshelf = by("bookshelf")
    desk = by("desk")

    # sofa -> TV
    if sofa is not None and tv is not None:
        quality = facing_quality(sofa, tv)
        gap = center_distance(sofa, tv)
        if quality > 0.55 and clear.tv_distance_min <= gap <= clear.tv_distance_max:
            out.append(ScoreItem("sofa_faces_tv", w.sofa_faces_tv * quality,
                                 "The sofa faces the {} at {:.0f} mm, inside the comfortable viewing band".format(
                                     _label(tv), gap)))
        elif quality > 0.55:
            out.append(ScoreItem("sofa_faces_tv_distance", w.sofa_faces_tv * quality * 0.4,
                                 "The sofa faces the {} but the {:.0f} mm viewing distance is outside the ideal band".format(
                                     _label(tv), gap)))
        else:
            out.append(ScoreItem("sofa_not_facing_tv", -w.sofa_faces_tv * 0.5,
                                 "The sofa does not face the {}".format(_label(tv))))

    # sofa <-> chairs (conversation)
    for chair in chairs:
        if sofa is None:
            continue
        gap = center_distance(chair, sofa)
        if faces(chair, sofa, 70.0) and clear.conversation_min <= gap <= clear.conversation_max:
            out.append(ScoreItem("seating_faces_seating", w.seating_faces_each_other * facing_quality(chair, sofa),
                                 "{} faces the sofa at {:.0f} mm, within conversation range".format(
                                     _label(chair), gap)))
        elif gap > clear.conversation_max:
            out.append(ScoreItem("seating_too_far", -4.0,
                                 "{} is {:.0f} mm from the sofa, beyond comfortable conversation range".format(
                                     _label(chair), gap)))

    # sofa -> coffee table
    if table is not None and sofa is not None:
        gap = gap_between(table, sofa)
        if clear.coffee_table_min <= gap <= clear.coffee_table_max and in_front_of(sofa, table):
            out.append(ScoreItem("coffee_table_distance", w.coffee_table_distance,
                                 "Coffee table sits {:.0f} mm in front of the sofa, inside the 400-500 mm band".format(gap)))
        elif in_front_of(sofa, table):
            out.append(ScoreItem("coffee_table_distance_ok", w.coffee_table_distance * 0.4,
                                 "Coffee table is in front of the sofa but {:.0f} mm away".format(gap)))
        else:
            out.append(ScoreItem("coffee_table_misplaced", w.penalty_coffee_table_misplaced,
                                 "Coffee table is off to the side rather than in front of the sofa"))
        # centred within the seating group
        seats = [f for f in items if f.spec.is_seating]
        if len(seats) >= 2:
            cx = sum(s.seat_point()[0] for s in seats) / len(seats)
            cy = sum(s.seat_point()[1] for s in seats) / len(seats)
            offset = distance((cx, cy), table.seat_point())
            if offset <= 700:
                out.append(ScoreItem("coffee_table_centered", w.coffee_table_centered * (1 - offset / 700.0),
                                     "Coffee table is centred in the seating group ({:.0f} mm off centre)".format(offset)))

    # reading chair -> bookshelf
    reading = _find(items, "reading_chair") or _find_role(items, "reading_chair")
    if reading is not None and bookshelf is not None:
        gap = gap_between(reading, bookshelf)
        if gap <= 1800:
            out.append(ScoreItem("reading_chair_near_bookshelf", w.reading_chair_near_bookshelf * (1 - gap / 1800.0),
                                 "The reading chair is {:.0f} mm from the bookshelf, an easy reach".format(gap)))

    # side table -> nearest seat
    for side in [f for f in items if f.type == "side_table"]:
        seats = [f for f in items if f.spec.is_seating]
        if not seats:
            continue
        nearest = min(seats, key=lambda s: gap_between(side, s))
        gap = gap_between(side, nearest)
        if gap <= clear.arm_reach:
            # scaled, not flat: a table flush against the seat reads as
            # "attached" to it, one drifting toward the far edge of arm's
            # reach should not score the same as one snug against it.
            out.append(ScoreItem("side_table_within_reach", w.side_table_within_reach * (1 - gap / clear.arm_reach),
                                 "Side table is {:.0f} mm from the {}, within arm's reach".format(gap, _label(nearest))))

    # lamp -> reading chair
    for lamp in [f for f in items if f.type == "lamp"]:
        anchor = reading or _primary_sofa(items)
        if anchor is None:
            continue
        gap = gap_between(lamp, anchor)
        if gap <= 900:
            out.append(ScoreItem("lamp_beside_seat", w.lamp_beside_reading_chair,
                                 "Floor lamp stands {:.0f} mm beside the {}".format(gap, _label(anchor))))

    # desk -> window
    if desk is not None and ctx.windows:
        nearest = min(
            ctx.windows,
            key=lambda win: desk.bbox.distance_to_rect(win.access_zone(ctx.room, clear.window_access_depth)),
        )
        gap = desk.bbox.distance_to_rect(nearest.access_zone(ctx.room, clear.window_access_depth))
        if gap <= 1200:
            out.append(ScoreItem("desk_near_window", w.desk_near_window,
                                 "Desk is {:.0f} mm from window '{}', so it gets natural light".format(gap, nearest.id)))

    return out


# --------------------------------------------------------------------------- #
# 3. wall alignment
# --------------------------------------------------------------------------- #
def wall_alignment_score(ctx: PlacementContext, items: List[Furniture]) -> List[ScoreItem]:
    w = ctx.config.weights
    out: List[ScoreItem] = []
    wall_pieces = [f for f in items if f.spec.prefers_wall or f.spec.requires_wall]
    if wall_pieces:
        against = [f for f in wall_pieces if is_against_wall(f, ctx.room)]
        ratio = len(against) / len(wall_pieces)
        out.append(ScoreItem("wall_alignment", w.wall_alignment * ratio,
                             "{} of {} wall-hugging pieces are actually against a wall".format(
                                 len(against), len(wall_pieces))))
        for piece in wall_pieces:
            if piece not in against:
                out.append(ScoreItem("floating_wall_piece", w.penalty_floating_wall_item,
                                     "{} would normally stand against a wall but floats in the room".format(
                                         _label(piece))))

    # TV on a solid wall
    tv = _find(items, "tv") or _find(items, "tv_console")
    if tv is not None:
        wall = wall_behind(tv, ctx.room)
        if wall is not None:
            info = ctx.analysis.wall_info(wall)
            if info.is_solid_wall and not info.has_window:
                out.append(ScoreItem("tv_on_solid_wall", w.tv_on_solid_wall,
                                     "The {} is on the solid {} wall".format(_label(tv), wall)))
            opposite = ctx.analysis.wall_info(OPPOSITE_WALL[wall])
            if opposite.window_coverage > 0.35:
                out.append(ScoreItem("tv_facing_window", w.penalty_tv_facing_window,
                                     "The {} faces the glazed {} wall, which will glare".format(
                                         _label(tv), opposite.name)))
    return out


# --------------------------------------------------------------------------- #
# 4. window access
# --------------------------------------------------------------------------- #
def window_access_score(ctx: PlacementContext, items: List[Furniture],
                        report: Optional[CirculationReport] = None) -> List[ScoreItem]:
    w = ctx.config.weights
    out: List[ScoreItem] = []
    if not ctx.windows:
        return out
    blocked = window_coverage_penalty_terms(items, ctx)
    if not blocked:
        out.append(ScoreItem("windows_clear", w.window_access,
                             "Every window is free of furniture and fully accessible"))
        return out
    for window_id in getattr(report, "unreachable_windows", []) if report else []:
        out.append(ScoreItem("window_not_walkable", -3.0,
                             "You cannot walk right up to window '{}'".format(window_id)))
    for window_id, item, coverage in blocked:
        out.append(ScoreItem("window_partially_blocked", w.penalty_window_partially_blocked * coverage,
                             "{} covers {:.0f}% of window '{}'".format(_label(item), coverage * 100, window_id)))
    return out


# --------------------------------------------------------------------------- #
# 5. door access
# --------------------------------------------------------------------------- #
def door_access_score(ctx: PlacementContext, items: List[Furniture]) -> List[ScoreItem]:
    w = ctx.config.weights
    clear = ctx.config.clearances
    out: List[ScoreItem] = []
    if not ctx.doors:
        return out
    if preferred_clearance_satisfied(ctx, items):
        out.append(ScoreItem("door_preferred_clearance", w.door_access,
                             "Every door keeps the preferred {:.0f} mm of clear floor".format(
                                 clear.door_clearance_preferred)))
    tight = [f for f in items
             if not f.spec.flat and distance_to_nearest_door(f, ctx.with_placed(items)) < 200.0]
    for item in tight:
        out.append(ScoreItem("close_to_door", w.penalty_close_to_door * 0.25,
                             "{} sits right on the edge of the door clearance zone".format(_label(item))))
    return out


# --------------------------------------------------------------------------- #
# 6. symmetry
# --------------------------------------------------------------------------- #
def symmetry_score(ctx: PlacementContext, items: List[Furniture]) -> List[ScoreItem]:
    w = ctx.config.weights
    out: List[ScoreItem] = []
    sofa = _primary_sofa(items)
    chairs = [f for f in items if f.type in ("chair", "reading_chair")]
    if sofa is None or len(chairs) < 2:
        return out
    offsets = [alignment_offset(sofa, c) for c in chairs]
    left = [c for c in chairs if _side_of(sofa, c) < 0]
    right = [c for c in chairs if _side_of(sofa, c) > 0]
    balance = 1.0 - abs(len(left) - len(right)) / float(len(chairs))
    spread = 1.0 - clamp(abs(max(offsets) - min(offsets)) / 1500.0, 0.0, 1.0)
    points = w.symmetry * (0.6 * balance + 0.4 * spread)
    if points > 0.5:
        out.append(ScoreItem("symmetry", points,
                             "Seating is balanced around the sofa axis ({} left / {} right)".format(
                                 len(left), len(right))))
    return out


# --------------------------------------------------------------------------- #
# 7. usability
# --------------------------------------------------------------------------- #
def usability_score(ctx: PlacementContext, items: List[Furniture], report: CirculationReport) -> List[ScoreItem]:
    w = ctx.config.weights
    out: List[ScoreItem] = []
    grid = report.grid or build_grid(ctx, items)
    free_ratio = grid.free_area() / ctx.room.area if ctx.room.area else 0.0
    open_square = grid.largest_free_square_side()

    out.append(ScoreItem("open_floor", w.usability_open_area * clamp((free_ratio - 0.35) / 0.4, 0.0, 1.0),
                         "{:.0f}% of the floor is left open".format(free_ratio * 100)))
    if open_square >= 1500:
        out.append(ScoreItem("open_centre", w.focal_balance,
                             "A {:.0f} mm clear square remains in the middle of the room".format(open_square)))
    elif open_square < 900:
        out.append(ScoreItem("crowded", w.penalty_crowding,
                             "The largest clear square is only {:.0f} mm - the room feels crowded".format(open_square)))

    seats = [f for f in items if f.spec.is_seating]
    if seats:
        cx = sum(s.seat_point()[0] for s in seats) / len(seats)
        cy = sum(s.seat_point()[1] for s in seats) / len(seats)
        offset = distance((cx, cy), ctx.room.center)
        reference = max(ctx.room.width, ctx.room.length) / 2.0
        out.append(ScoreItem("focal_balance", w.focal_balance * clamp(1.0 - offset / reference, 0.0, 1.0),
                             "The seating group sits {:.0f} mm from the room centre".format(offset)))
    return out


# --------------------------------------------------------------------------- #
# Completeness
# --------------------------------------------------------------------------- #
def completeness_score(ctx: PlacementContext, items: List[Furniture], expected: List[str]) -> List[ScoreItem]:
    w = ctx.config.weights
    out: List[ScoreItem] = []
    placed_roles = [f.role for f in items] + [f.type for f in items]
    missing = [role for role in expected if role not in placed_roles]
    for role in missing:
        out.append(ScoreItem("missing_furniture", w.penalty_missing_furniture,
                             "Requested '{}' could not be placed without breaking a hard constraint".format(role)))
    if expected and not missing:
        out.append(ScoreItem("all_furniture_placed", 6.0,
                             "Every requested piece of furniture was placed"))
    return out


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
def score_layout(
    ctx: PlacementContext,
    items: List[Furniture],
    expected: Optional[List[str]] = None,
    report: Optional[CirculationReport] = None,
    extra: Optional[List[ScoreItem]] = None,
) -> LayoutScore:
    """Full soft-constraint evaluation of a complete layout."""
    full_ctx = ctx.with_placed(items)
    report = report or analyse_circulation(full_ctx, items)

    score = LayoutScore(circulation=report)
    score.add("circulation", circulation_score(full_ctx, items, report))
    score.add("relationships", furniture_relationship_score(full_ctx, items))
    score.add("wall_alignment", wall_alignment_score(full_ctx, items))
    score.add("window_access", window_access_score(full_ctx, items, report))
    score.add("door_access", door_access_score(full_ctx, items))
    score.add("symmetry", symmetry_score(full_ctx, items))
    score.add("usability", usability_score(full_ctx, items, report))
    score.add("completeness", completeness_score(full_ctx, items, expected or []))
    if extra:
        score.add("layout_specific", extra)
    return score


# --------------------------------------------------------------------------- #
# Incremental score used to rank candidates during the search
# --------------------------------------------------------------------------- #
def placement_score(item: Furniture, ctx: PlacementContext) -> float:
    """Cheap, local goodness of one placement given what is already placed.

    Deliberately does not rasterise anything: it runs for every candidate.
    """
    w = ctx.config.weights
    clear = ctx.config.clearances
    points = 0.0

    # wall preference
    if item.spec.prefers_wall or item.spec.requires_wall:
        walls = touching_walls(item, ctx.room)
        if is_against_wall(item, ctx.room):
            points += w.wall_alignment
            if len(walls) >= 2:
                points += 2.0  # corners use space efficiently
        else:
            points += w.penalty_floating_wall_item

    # stay away from doors
    door_gap = distance_to_nearest_door(item, ctx)
    if door_gap < 300.0:
        points += w.penalty_close_to_door * 0.3
    elif door_gap < 900.0:
        points += 2.0
    else:
        points += 4.0

    # never stand in the straight route from the front door into the room
    corridor = entrance_corridor(ctx)
    if corridor is not None and not item.spec.flat and item.footprint().intersects(corridor):
        points += w.penalty_poor_circulation

    # windows: the rules allow low furniture in front of glass, but the more of
    # a window a piece covers the worse the placement, so the penalty scales
    # with the covered fraction instead of being a flat charge.
    for window in ctx.windows:
        zone = window.access_zone(ctx.room, clear.window_access_depth)
        if not item.bbox.intersects(zone):
            continue
        wall = ctx.room.wall(window.wall)
        box = item.bbox
        if wall.is_horizontal:
            covered = segment_overlap(box.x0, box.x1, window.start, window.end)
        else:
            covered = segment_overlap(box.y0, box.y1, window.start, window.end)
        fraction = covered / window.width if window.width else 0.0
        # The rules explicitly allow low pieces (low sofa, low TV console, small
        # side table, low storage) in front of glass: they keep the daylight.
        # Anything that rises above the sill eats into the window itself.
        below_sill = item.spec.height <= window.sill_height
        weight = 0.35 if below_sill else (0.5 + 2.0 * fraction)
        points += w.penalty_window_partially_blocked * weight

    # relationships with what is already there
    for other in ctx.placed:
        points += _pair_score(item, other, ctx)

    return points


def _pair_score(item: Furniture, other: Furniture, ctx: PlacementContext) -> float:
    w = ctx.config.weights
    clear = ctx.config.clearances
    a, b = item.type, other.type
    pair = {a, b}
    points = 0.0

    if "coffee_table" in pair and (pair & {"sofa", "l_sofa", "loveseat"}):
        table, sofa = (item, other) if item.type == "coffee_table" else (other, item)
        gap = gap_between(table, sofa)
        if clear.coffee_table_min <= gap <= clear.coffee_table_max:
            points += w.coffee_table_distance
        elif gap < clear.coffee_table_min:
            points -= 10.0
        elif gap <= clear.coffee_table_max + clear.coffee_table_surround:
            points += w.coffee_table_distance * 0.4
        if in_front_of(sofa, table):
            points += 5.0
        else:
            points += w.penalty_coffee_table_misplaced * 0.5

    if item.spec.is_seating and other.type in ("tv", "tv_console"):
        quality = facing_quality(item, other)
        gap = center_distance(item, other)
        if quality > 0.5 and clear.tv_distance_min <= gap <= clear.tv_distance_max:
            points += w.sofa_faces_tv * quality
        elif quality > 0.5:
            points += w.sofa_faces_tv * quality * 0.3

    if item.spec.is_seating and other.spec.is_seating:
        gap = center_distance(item, other)
        if clear.conversation_min <= gap <= clear.conversation_max:
            points += w.seating_faces_each_other * 0.5 * (facing_quality(item, other) + facing_quality(other, item))

    if "side_table" in pair and (item.spec.is_seating or other.spec.is_seating):
        gap = gap_between(item, other)
        if gap <= clear.arm_reach:
            points += w.side_table_within_reach * (1 - gap / clear.arm_reach)

    if "bookshelf" in pair and (pair & {"reading_chair", "chair"}):
        gap = gap_between(item, other)
        if gap <= 1800:
            points += w.reading_chair_near_bookshelf * (1 - gap / 1800.0)

    if "lamp" in pair and (item.spec.is_seating or other.spec.is_seating):
        if gap_between(item, other) <= 900:
            points += w.lamp_beside_reading_chair

    return points


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _find(items: List[Furniture], *types: str) -> Optional[Furniture]:
    for type_name in types:
        for item in items:
            if item.type == type_name:
                return item
    return None


def _find_role(items: List[Furniture], *roles: str) -> Optional[Furniture]:
    for role in roles:
        for item in items:
            if item.role == role:
                return item
    return None


def _primary_sofa(items: List[Furniture]) -> Optional[Furniture]:
    sofas = [f for f in items if f.type in ("sofa", "l_sofa", "loveseat")]
    return max(sofas, key=lambda f: f.spec.footprint_area) if sofas else None


def _side_of(reference: Furniture, other: Furniture) -> float:
    """Which side of `reference`'s facing axis `other` sits on (-1 / +1)."""
    f = reference.facing
    o = reference.seat_point()
    t = other.seat_point()
    cross = f[0] * (t[1] - o[1]) - f[1] * (t[0] - o[0])
    return 1.0 if cross > 0 else -1.0
