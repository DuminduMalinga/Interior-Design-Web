"""
Scoring: the ten living-room rules, plus the cheap local score used while
searching.

Soft constraints never invalidate a layout - they rank the valid ones.  A
finished layout is marked against the ten rules in `rules/living_rules.py`;
the 0-100 total of those marks *is* the layout's score, and it is what the
optimiser maximises.  Every rule keeps the measured numbers behind its mark,
so the report can say exactly where the points came from.

Two smaller terms steer the search without being part of the reported score:

* a layout's own character (`layouts/<layout>.bonus()`), scaled right down, so
  six layout types stay six different arrangements when the rules tie;
* a charge for every planned piece left out, so the search does not "open up"
  the room by simply placing less furniture.

`placement_score` is the fast per-candidate estimate used to rank positions
before a whole layout exists; it rewards the same things the rules do.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence

from ..models.furniture import Furniture
from ..models.geometry import segment_overlap
from .circulation_rules import CirculationReport, analyse_circulation, entrance_corridor
from .context import PlacementContext, ScoreItem
from .door_rules import distance_to_nearest_door
from .furniture_rules import (
    center_distance,
    facing_quality,
    gap_between,
    in_front_of,
    is_against_wall,
    touching_walls,
)
from .living_rules import RuleEvaluator, RuleResult, conversation_mark, look_quality, total_score

#: how much of a layout's own character bonus counts towards the search objective
CHARACTER_SHARE = 0.1
#: search-objective charge per planned piece that could not be placed
MISSING_REQUIRED = 6.0
MISSING_OPTIONAL = 1.5


@dataclass
class LayoutScore:
    """The complete evaluation of one layout against the ten rules."""

    total: float = 0.0                 # 0-100, the reported score
    objective: float = 0.0             # what the search maximises: total + character - missing pieces
    components: Dict[str, float] = field(default_factory=dict)
    items: List[ScoreItem] = field(default_factory=list)
    rules: Dict[str, RuleResult] = field(default_factory=dict)
    character: List[ScoreItem] = field(default_factory=list)
    circulation: Optional[CirculationReport] = None

    def positives(self) -> List[ScoreItem]:
        return [i for i in self.items if i.points > 0]

    def negatives(self) -> List[ScoreItem]:
        return [i for i in self.items if i.points < 0]

    @property
    def scale(self) -> float:
        """Turns rule weights into points that add up to the 0-100 total."""
        applicable = sum(r.weight for r in self.rules.values() if r.applicable)
        return 100.0 / applicable if applicable else 0.0

    def rules_report(self) -> List[Dict]:
        scale = self.scale
        return [result.to_dict(scale) for result in self.rules.values()]

    def to_dict(self) -> Dict:
        return {
            "total": round(self.total, 1),
            "components": dict(self.components),
            "contributions": [i.to_dict() for i in sorted(self.items, key=lambda s: -s.points)],
            "layout_character": [i.to_dict() for i in self.character],
        }


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
def score_layout(
    ctx: PlacementContext,
    items: List[Furniture],
    planned: Optional[Sequence] = None,
    report: Optional[CirculationReport] = None,
    extra: Optional[List[ScoreItem]] = None,
) -> LayoutScore:
    """Mark a complete layout against the ten rules.

    `planned` is the layout's list of PlacementSpecs (what was meant to be
    placed), `extra` the layout's own character bonus.
    """
    full_ctx = ctx.with_placed(items)
    report = report or analyse_circulation(full_ctx, items)
    planned = list(planned or [])

    score = LayoutScore(circulation=report, character=list(extra or []))
    score.rules = RuleEvaluator(full_ctx, items, report, planned).evaluate()
    scale = score.scale
    for number, result in enumerate(score.rules.values(), start=1):
        if not result.applicable:
            continue
        points = round(result.points * scale, 2)
        score.components[result.rule.key] = points
        score.items.append(ScoreItem(result.rule.key, points, "Rule {} ({}): {}".format(
            number, result.rule.title.lower(), result.detail)))
    score.total = round(total_score(score.rules), 2)

    placed = {f.role for f in items}
    missing = sum(MISSING_REQUIRED if spec.required else MISSING_OPTIONAL
                  for spec in planned if spec.role not in placed)
    score.objective = score.total + CHARACTER_SHARE * sum(e.points for e in score.character) - missing
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

    sofas = ("sofa", "l_sofa", "loveseat")

    # a seat and the screen, whichever of the two is placed second (rule 7: the
    # TV unit is only useful where the sofa looks at it). An armchair's first
    # job is to face the sofa (rule 1), so the screen pulls on it far less.
    seat, screen = (item, other) if item.spec.is_seating else (other, item)
    if seat.spec.is_seating and screen.type in ("tv", "tv_console") and (seat is item or seat.type in sofas):
        quality = look_quality(seat, screen)
        gap = center_distance(seat, screen)
        pull = w.sofa_faces_tv if seat.type in sofas else w.sofa_faces_tv * 0.25
        if quality > 0.5 and clear.tv_distance_min <= gap <= clear.tv_distance_max:
            points += pull * quality
        elif quality > 0.5:
            points += pull * quality * 0.3

    if item.spec.is_seating and other.spec.is_seating:
        chair, sofa = (item, other) if other.type in sofas else (other, item)
        if sofa.type in sofas and chair.type == "chair":
            # rule 1, as the rule itself marks it: turned to the sofa, in front of it, at talking distance
            points += w.chair_faces_sofa * conversation_mark(chair, sofa, ctx.config)
        else:
            gap = center_distance(item, other)
            if clear.conversation_min <= gap <= clear.conversation_max:
                points += w.seating_faces_each_other * 0.5 * (
                    facing_quality(item, other) + facing_quality(other, item))

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
