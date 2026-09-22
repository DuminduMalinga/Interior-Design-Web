"""
Furniture-to-furniture and furniture-to-wall relationships (specification 11).

These predicates are deliberately shared between the hard constraints and the
scorer: "the coffee table is 450 mm from the sofa" is measured once, used as a
pass/fail below 400 mm and as a bonus inside the 400-500 mm band.
"""

from __future__ import annotations

import math
from typing import Iterable, List, Optional, Tuple

from ..models.furniture import Furniture, overlap_exempt
from ..models.geometry import Point, Rect, angle_between, distance, segment_overlap
from ..models.room import WALL_INWARD, Room
from .context import PlacementContext, Violation

WALL_TOUCH_TOLERANCE = 120.0  # mm - counts as "against the wall"


# --------------------------------------------------------------------------- #
# Wall relationships
# --------------------------------------------------------------------------- #
def wall_behind(item: Furniture, room: Room, tolerance: float = WALL_TOUCH_TOLERANCE) -> Optional[str]:
    """Name of the wall the item has its back to, if it is against one."""
    box = item.bbox
    back = item.back_direction
    if back == (0.0, -1.0) and box.y0 <= tolerance:
        return "south"
    if back == (0.0, 1.0) and box.y1 >= room.length - tolerance:
        return "north"
    if back == (-1.0, 0.0) and box.x0 <= tolerance:
        return "west"
    if back == (1.0, 0.0) and box.x1 >= room.width - tolerance:
        return "east"
    return None


def touching_walls(item: Furniture, room: Room, tolerance: float = WALL_TOUCH_TOLERANCE) -> List[str]:
    """Every wall the item's bounding box touches (a corner piece touches two)."""
    box = item.bbox
    walls = []
    if box.y0 <= tolerance:
        walls.append("south")
    if box.y1 >= room.length - tolerance:
        walls.append("north")
    if box.x0 <= tolerance:
        walls.append("west")
    if box.x1 >= room.width - tolerance:
        walls.append("east")
    return walls


def is_against_wall(item: Furniture, room: Room, tolerance: float = WALL_TOUCH_TOLERANCE) -> bool:
    return wall_behind(item, room, tolerance) is not None


def distance_to_nearest_wall(item: Furniture, room: Room) -> float:
    box = item.bbox
    return min(box.x0, box.y0, room.width - box.x1, room.length - box.y1)


# --------------------------------------------------------------------------- #
# Free space around a piece
# --------------------------------------------------------------------------- #
def _axis_of(direction: Tuple[float, float]) -> int:
    return 0 if direction[0] else 1


def clearance_in_direction(
    item: Furniture,
    direction: Tuple[float, float],
    ctx: PlacementContext,
    others: Optional[Iterable[Furniture]] = None,
    lateral_min_overlap: float = 150.0,
) -> float:
    """Free distance from one face of `item` to the first obstacle that way.

    Walls and other furniture both count as obstacles.  Used for the "dead gap"
    rules: a 200 mm slot behind a sofa is wasted floor, not circulation.
    """
    box = item.bbox
    room = ctx.room
    axis = _axis_of(direction)
    forward = direction[axis] > 0

    if axis == 0:
        face = box.x1 if forward else box.x0
        wall_limit = room.width if forward else 0.0
        lat0, lat1 = box.y0, box.y1
    else:
        face = box.y1 if forward else box.y0
        wall_limit = room.length if forward else 0.0
        lat0, lat1 = box.x0, box.x1

    gap = abs(wall_limit - face)
    for other in (others if others is not None else ctx.placed):
        if other is item or other.id == item.id or other.spec.flat:
            continue
        obox = other.bbox
        if axis == 0:
            overlap = segment_overlap(lat0, lat1, obox.y0, obox.y1)
            near, far = obox.x0, obox.x1
        else:
            overlap = segment_overlap(lat0, lat1, obox.x0, obox.x1)
            near, far = obox.y0, obox.y1
        if overlap < lateral_min_overlap:
            continue
        if forward and near >= face - 1.0:
            gap = min(gap, near - face)
        elif not forward and far <= face + 1.0:
            gap = min(gap, face - far)
    return max(0.0, gap)


def clearance_behind(item: Furniture, ctx: PlacementContext, others=None) -> float:
    return clearance_in_direction(item, item.back_direction, ctx, others)


def clearance_in_front(item: Furniture, ctx: PlacementContext, others=None) -> float:
    return clearance_in_direction(item, item.facing, ctx, others)


# --------------------------------------------------------------------------- #
# Pairwise relationships
# --------------------------------------------------------------------------- #
def gap_between(a: Furniture, b: Furniture) -> float:
    """Shortest distance between two footprints (0 when touching/overlapping)."""
    best = float("inf")
    for ra in a.part_rects():
        for rb in b.part_rects():
            best = min(best, ra.distance_to_rect(rb))
    return best


def center_distance(a: Furniture, b: Furniture) -> float:
    return distance(a.seat_point(), b.seat_point())


def facing_angle(a: Furniture, b: Furniture) -> float:
    """Angle between a's facing direction and the direction towards b (deg)."""
    origin = a.seat_point()
    target = b.seat_point()
    to_target = (target[0] - origin[0], target[1] - origin[1])
    return angle_between(a.facing, to_target)


def faces(a: Furniture, b: Furniture, cone: float = 55.0) -> bool:
    """True when b lies inside a's forward cone."""
    return facing_angle(a, b) <= cone


def facing_quality(a: Furniture, b: Furniture) -> float:
    """1.0 when a points straight at b, falling to 0 at 90 degrees off-axis."""
    angle = facing_angle(a, b)
    if angle >= 90.0:
        return 0.0
    return 1.0 - angle / 90.0


def mutually_facing(a: Furniture, b: Furniture, cone: float = 70.0) -> bool:
    return faces(a, b, cone) and faces(b, a, cone)


def in_front_of(a: Furniture, b: Furniture, max_offset: float = 400.0) -> bool:
    """True when b sits in the band directly ahead of a (not off to one side)."""
    box_a = a.bbox
    box_b = b.bbox
    f = a.facing
    if f[1]:  # facing north/south -> compare x spans
        return segment_overlap(box_a.x0, box_a.x1, box_b.x0 - max_offset, box_b.x1 + max_offset) > 0 and faces(a, b, 70.0)
    return segment_overlap(box_a.y0, box_a.y1, box_b.y0 - max_offset, box_b.y1 + max_offset) > 0 and faces(a, b, 70.0)


def within_reach(a: Furniture, b: Furniture, reach: float) -> bool:
    return gap_between(a, b) <= reach


def alignment_offset(a: Furniture, b: Furniture) -> float:
    """Lateral offset between the centres, perpendicular to a's facing (mm)."""
    ca, cb = a.seat_point(), b.seat_point()
    f = a.facing
    return abs((cb[0] - ca[0]) * f[1] - (cb[1] - ca[1]) * f[0])


# --------------------------------------------------------------------------- #
# Hard constraints that live at the relationship level
# --------------------------------------------------------------------------- #
def check_wall_requirement(item: Furniture, ctx: PlacementContext) -> Optional[Violation]:
    """Pieces such as a bookshelf, TV or console have to have a wall behind them."""
    if not item.spec.requires_wall:
        return None
    wall = wall_behind(item, ctx.room)
    if wall is None:
        # a piece can also back onto another piece of similar height (a console
        # behind a sofa), which is a legitimate room divider
        for other in ctx.placed:
            if other.id == item.id or other.spec.flat:
                continue
            if clearance_behind(item, ctx, [other]) <= 60.0:
                return None
        return Violation(
            rule="requires_wall",
            message="{} needs a wall (or a solid piece) behind it but is free standing".format(
                item.role or item.type
            ),
            subject=item.id,
        )
    return None


#: pairs where the second piece legitimately occupies the first one's use space
USE_SPACE_PARTNERS = (("desk", "desk_chair"),)


def _use_space_exempt(owner: Furniture, intruder: Furniture) -> bool:
    """True when `intruder` is allowed to stand in `owner`'s use space."""
    if intruder.spec.flat or overlap_exempt(owner.type, intruder.type):
        return True
    for a, b in USE_SPACE_PARTNERS:
        if (owner.type, intruder.type) == (a, b):
            return True
    # a coffee table, side table or lamp in front of a seat is the point of it
    if owner.spec.is_seating and intruder.spec.category in ("table", "lighting"):
        return True
    return False


def _front_conflict(owner: Furniture, intruder: Furniture) -> bool:
    needed = owner.spec.front_clearance
    if needed <= 0 or _use_space_exempt(owner, intruder):
        return False
    return owner.front_zone(needed).intersects(intruder.bbox)


def check_use_clearance(item: Furniture, ctx: PlacementContext) -> Optional[Violation]:
    """The space a piece needs in front of it to be usable must stay free.

    Checked in both directions: a bookshelf you cannot stand in front of is
    invalid, and so is a side table dropped into that same standing space.
    """
    needed = item.spec.front_clearance
    if needed > 0:
        zone = item.front_zone(needed)
        if not ctx.room.rect.contains_rect(zone, tol=1.0):
            return Violation(
                rule="use_clearance_room",
                message="{} needs {:.0f} mm of standing space in front of it, "
                "which falls outside the room".format(item.role or item.type, needed),
                subject=item.id,
            )

    for other in ctx.placed:
        if other.id == item.id:
            continue
        if _front_conflict(item, other):
            return Violation(
                rule="use_clearance",
                message="{} blocks the {:.0f} mm of space {} needs in front of it".format(
                    other.role or other.type, item.spec.front_clearance, item.role or item.type
                ),
                subject=item.id,
                related=other.id,
            )
        if _front_conflict(other, item):
            return Violation(
                rule="use_clearance",
                message="{} would block the {:.0f} mm of space {} needs in front of it".format(
                    item.role or item.type, other.spec.front_clearance, other.role or other.type
                ),
                subject=item.id,
                related=other.id,
            )
    return None


def check_seating_clearance(item: Furniture, ctx: PlacementContext) -> Optional[Violation]:
    """5.8 - no unusable slot behind a seat.

    Either the seat is backed (against a wall or another piece) or it leaves a
    real 600 mm walkway behind it; anything in between is wasted floor.
    """
    if not item.spec.is_seating:
        return None
    minimum = ctx.config.clearances.seating_circulation_min
    gap = clearance_behind(item, ctx)
    if gap <= 60.0 or gap >= minimum:
        return None
    return Violation(
        rule="seating_clearance",
        message="{} leaves a {:.0f} mm gap behind it - too narrow to walk through "
        "and too wide to be against the wall (needs 0 or at least {:.0f} mm)".format(
            item.role or item.type, gap, minimum
        ),
        subject=item.id,
    )


#: accent seating that must stay part of the main seating group. Sofas anchor
#: the group rather than needing to join one, and desk_chair belongs to its
#: own desk zone (which can legitimately sit apart from the sofa), so neither
#: is checked here.
GROUP_SEATING_TYPES = ("chair", "reading_chair")


def check_seating_group_cohesion(item: Furniture, ctx: PlacementContext) -> Optional[Violation]:
    """No orphaned seat (specification 11 - seating group relationships).

    A chair belongs to the conversation group only if it is within reach of
    at least one other already-placed seat (the sofa, or another chair) - one
    stranded across the room is two separate seating areas, not one, and
    "nothing overlaps" should not be enough to call that valid.
    """
    if item.type not in GROUP_SEATING_TYPES:
        return None
    others = [f for f in ctx.placed if f.spec.is_seating and f.id != item.id]
    if not others:
        return None  # first seat placed - nothing to be cohesive with yet
    nearest = min(center_distance(item, other) for other in others)
    limit = ctx.config.clearances.seating_group_max_span
    if nearest <= limit:
        return None
    return Violation(
        rule="seating_group_cohesion",
        message="{} is {:.0f} mm from the nearest other seat - too far to be part of the "
        "same seating group (max {:.0f} mm)".format(item.role or item.type, nearest, limit),
        subject=item.id,
    )


#: below this footprint a piece is occasional furniture: you step over it
#: rather than walk around it, so it does not consume circulation space
OCCASIONAL_FOOTPRINT = 500_000.0     # mm^2 (a 700 x 700 piece)


def _is_circulation_obstacle(item: Furniture) -> bool:
    """True when a piece is big enough that people have to walk around it."""
    if item.spec.category == "lighting" or item.spec.flat:
        return False
    if item.spec.category == "table" and item.spec.footprint_area <= OCCASIONAL_FOOTPRINT:
        return False
    return True


def check_coffee_table_clearance(item: Furniture, ctx: PlacementContext) -> Optional[Violation]:
    """5.7 - a coffee table must be reachable from the seating but not touch it.

    Symmetric: it fires both when the table is placed near a seat and when a
    seat is placed near the table, so the search can never build the conflict
    and only discover it at the end.
    """
    clear = ctx.config.clearances
    if item.type == "coffee_table":
        table = item
        seats = [f for f in ctx.placed if f.spec.is_seating]
    else:
        tables = ctx.by_type("coffee_table")
        if not tables:
            return None
        table = min(tables, key=lambda t: gap_between(item, t))
        seats = [item] if item.spec.is_seating else []

    gaps = [gap_between(table, seat) for seat in seats]
    nearest = min(gaps) if gaps else float("inf")
    if nearest < clear.coffee_table_min:
        closest = seats[gaps.index(nearest)]
        return Violation(
            rule="coffee_table_min_clearance",
            message="coffee table is only {:.0f} mm from the {} - at least {:.0f} mm is needed "
            "for legs and passage".format(nearest, closest.role or closest.type, clear.coffee_table_min),
            subject=item.id,
            related=closest.id,
        )

    # "Around coffee table: 400-500 mm" - movement space against anything a
    # person has to walk around.  Small occasional pieces (a side table at the
    # end of the sofa, a floor lamp) belong to the same furniture group and are
    # stepped over, not walked around, so they are exempt.
    surround = clear.coffee_table_surround
    obstacles = [item] if item.type != "coffee_table" else list(ctx.placed)
    for other in obstacles:
        if other.id == table.id or other.spec.flat or other.spec.is_seating:
            continue
        if not _is_circulation_obstacle(other):
            continue
        gap = gap_between(table, other)
        if gap < surround:
            return Violation(
                rule="coffee_table_surround",
                message="only {:.0f} mm between the coffee table and the {} - {:.0f} mm of "
                "movement space is needed all round the table".format(
                    gap, other.role or other.type, surround
                ),
                subject=item.id,
                related=other.id,
            )

    # the table also has to stay within reach of the main sofa
    sofa = ctx.primary_sofa()
    if item.type == "coffee_table" and sofa is not None:
        reach = gap_between(table, sofa)
        limit = clear.coffee_table_max + clear.coffee_table_surround
        if reach > limit:
            return Violation(
                rule="coffee_table_reach",
                message="coffee table is {:.0f} mm from the sofa, beyond the {:.0f} mm "
                "at which it can still be used".format(reach, limit),
                subject=item.id,
                related=sofa.id,
            )
    return None


#: pieces that only make sense directly above/on another piece
PAIRED_WITH = {"tv": "tv_console"}


def _pairing_violation(top: Furniture, base: Furniture, room: Room = None) -> Optional[Violation]:
    if top.bbox.inflate(200.0).intersects(base.bbox):
        if room is not None:
            top_wall = wall_behind(top, room)
            base_wall = wall_behind(base, room)
            if top_wall and base_wall and top_wall != base_wall:
                return Violation(
                    rule="media_pairing",
                    message="the {} is on the {} wall while its console is on the {} wall".format(
                        top.role or top.type, top_wall, base_wall
                    ),
                    subject=top.id,
                    related=base.id,
                )
        return None
    return Violation(
        rule="media_pairing",
        message="the {} is {:.0f} mm away from the {} instead of standing on it".format(
            top.role or top.type, top.bbox.distance_to_rect(base.bbox), base.role or base.type
        ),
        subject=top.id,
        related=base.id,
    )


def check_paired_furniture(item: Furniture, ctx: PlacementContext) -> Optional[Violation]:
    """A TV belongs on its console, not somewhere else on the same wall.

    Checked from both sides, so moving the console away from the screen is a
    violation just as much as moving the screen away from the console.
    """
    base_type = PAIRED_WITH.get(item.type)
    if base_type is not None:
        bases = ctx.by_type(base_type)
        if bases:
            nearest = min(bases, key=lambda p: item.bbox.distance_to_rect(p.bbox))
            return _pairing_violation(item, nearest, ctx.room)

    for top_type, needed_base in PAIRED_WITH.items():
        if needed_base != item.type:
            continue
        tops = ctx.by_type(top_type)
        others = [f for f in ctx.by_type(item.type) if f.id != item.id]
        if tops and not others:      # this is the only base for those pieces
            nearest = min(tops, key=lambda t: item.bbox.distance_to_rect(t.bbox))
            return _pairing_violation(nearest, item, ctx.room)
    return None


def check_minimum_gaps(item: Furniture, ctx: PlacementContext) -> Optional[Violation]:
    """No unusable slivers between pieces (dead space narrower than 300 mm)."""
    minimum = ctx.config.clearances.minor_gap_min
    for other in ctx.placed:
        if other.id == item.id or other.spec.flat or item.spec.flat:
            continue
        if overlap_exempt(item.type, other.type):
            continue
        gap = gap_between(item, other)
        if 1.0 < gap < minimum:
            # touching or nested groupings (a side table beside a sofa) are fine
            if item.spec.category == "table" or other.spec.category == "table":
                continue
            if item.spec.category == "lighting" or other.spec.category == "lighting":
                continue
            return Violation(
                rule="dead_gap",
                message="{:.0f} mm of unusable space between {} and {}".format(
                    gap, item.role or item.type, other.role or other.type
                ),
                subject=item.id,
                related=other.id,
            )
    return None
