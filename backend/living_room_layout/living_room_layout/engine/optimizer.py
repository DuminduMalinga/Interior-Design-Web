"""
Layout optimisation (specification 13).

The search is deliberately transparent - no learning, no randomness, and every
step can be replayed:

    1. place the pieces in plan order (anchors before the things that
       reference them);
    2. for each piece generate candidate positions, discard the ones that break
       a hard constraint, and rank the survivors with the local soft score;
    3. keep the best `beam_width` partial layouts rather than committing to a
       single greedy choice (beam search - a bounded breadth-first search);
    4. score every finished layout with the full soft-constraint model;
    5. hill-climb: try re-placing each piece in turn and keep any move that
       raises the whole-layout score;
    6. re-validate the winner and report it.

Running the same input twice produces the same layout.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from ..config import Config
from ..layouts.base import BaseLayout, PlacementSpec
from ..models.furniture import Furniture, FurnitureCatalogue
from ..rules.circulation_rules import CirculationReport, analyse_circulation
from ..rules.context import PlacementContext, Violation
from ..rules.soft_constraints import LayoutScore
from .candidate_generator import CandidateGenerator
from .constraint_checker import ConstraintChecker
from .scorer import LayoutScorer


@dataclass
class PlacementFailure:
    """A piece the search could not place anywhere legal."""

    role: str
    type: str
    required: bool
    candidates_tried: int
    reasons: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return {
            "furniture": self.role or self.type,
            "type": self.type,
            "required": self.required,
            "candidates_tried": self.candidates_tried,
            "reasons": self.reasons[:5],
        }


@dataclass
class PartialLayout:
    items: List[Furniture] = field(default_factory=list)
    local_score: float = 0.0
    trace: List[str] = field(default_factory=list)

    def clone_with(self, item: Furniture, points: float, note: str) -> "PartialLayout":
        return PartialLayout(
            items=self.items + [item],
            local_score=self.local_score + points,
            trace=self.trace + [note],
        )

    def key(self) -> Tuple:
        return tuple(
            (i.role, round(i.x / 50.0), round(i.y / 50.0), i.rotation, i.variant) for i in self.items
        )


@dataclass
class LayoutResult:
    """A finished, validated layout."""

    layout: BaseLayout
    items: List[Furniture]
    score: LayoutScore
    circulation: CirculationReport
    violations: List[Violation] = field(default_factory=list)
    failures: List[PlacementFailure] = field(default_factory=list)
    trace: List[str] = field(default_factory=list)
    iterations: int = 0

    @property
    def valid(self) -> bool:
        return not self.violations

    @property
    def total(self) -> float:
        return self.score.total


class LayoutOptimizer:
    """Beam search plus hill climbing over candidate placements."""

    def __init__(
        self,
        analysis,
        layout: BaseLayout,
        catalogue: FurnitureCatalogue,
        checker: Optional[ConstraintChecker] = None,
    ):
        self.analysis = analysis
        self.layout = layout
        self.catalogue = catalogue
        self.config: Config = analysis.config
        self.generator = CandidateGenerator(analysis)
        self.checker = checker or ConstraintChecker(self.config)
        self.base_ctx = PlacementContext(analysis, [])

    # ------------------------------------------------------------------ #
    def optimize(self, specs: List[PlacementSpec]) -> LayoutResult:
        scorer = LayoutScorer(self.layout, [s.role for s in specs if s.required])
        beam: List[PartialLayout] = [PartialLayout()]
        failures: List[PlacementFailure] = []
        counters: Dict[str, int] = {}
        iterations = 0

        for spec in specs:
            counters[spec.type] = counters.get(spec.type, 0) + 1
            item_id = "{}_{}".format(spec.type, counters[spec.type])
            fspec = self.catalogue.spec(spec.type)

            next_beam: List[PartialLayout] = []
            tried = 0
            failure_reasons: List[str] = []

            for partial in beam:
                ctx = self.base_ctx.with_placed(partial.items)
                placed_by_role = {i.role: i for i in partial.items}
                candidates = self.generator.generate(spec, fspec, ctx, placed_by_role, item_id)
                tried += len(candidates)

                scored: List[Tuple[float, Furniture]] = []
                for candidate in candidates:
                    iterations += 1
                    violation = self.checker.validate(candidate, ctx)
                    if violation is not None:
                        if len(failure_reasons) < 6 and violation.message not in failure_reasons:
                            failure_reasons.append(violation.message)
                        continue
                    scored.append((scorer.score_placement(candidate, ctx, spec), candidate))

                scored.sort(key=lambda pair: -pair[0])
                for points, candidate in scored[: self.config.search.branch_per_item]:
                    candidate.reasons = self._placement_reasons(spec, candidate, points)
                    next_beam.append(
                        partial.clone_with(
                            candidate,
                            points,
                            "{} placed by strategy '{}' (local score {:.1f})".format(
                                spec.label(), candidate.strategy, points
                            ),
                        )
                    )
                if not scored:
                    # this branch cannot take the piece; it survives without it
                    next_beam.append(
                        PartialLayout(
                            items=list(partial.items),
                            local_score=partial.local_score,
                            trace=partial.trace
                            + ["{} could not be placed on this branch".format(spec.label())],
                        )
                    )

            beam = self._prune(next_beam)
            if all(not any(i.role == spec.role for i in p.items) for p in beam):
                failures.append(
                    PlacementFailure(
                        role=spec.role, type=spec.type, required=spec.required,
                        candidates_tried=tried, reasons=failure_reasons,
                    )
                )

        # ---- score every finished layout -------------------------------- #
        best_result: Optional[LayoutResult] = None
        for partial in beam:
            score = scorer.score(self.base_ctx, partial.items)
            result = LayoutResult(
                layout=self.layout,
                items=partial.items,
                score=score,
                circulation=score.circulation,
                failures=failures,
                trace=partial.trace,
                iterations=iterations,
            )
            if best_result is None or self._preferred(result, best_result):
                best_result = result

        if best_result is None:  # nothing at all could be placed
            empty_score = scorer.score(self.base_ctx, [])
            return LayoutResult(
                layout=self.layout, items=[], score=empty_score,
                circulation=empty_score.circulation, failures=failures, iterations=iterations,
            )

        best_result = self._hill_climb(best_result, specs, scorer)
        best_result.violations = self.checker.validate_layout(self.base_ctx, best_result.items)
        return best_result

    # ------------------------------------------------------------------ #
    def _prune(self, beam: List[PartialLayout]) -> List[PartialLayout]:
        """Keep the best partial layouts, preferring the ones still walkable.

        Circulation is a hard constraint on the finished layout, so a branch
        that has already sealed the entrance off is demoted here rather than
        being discovered at the very end.
        """
        seen = set()
        unique: List[PartialLayout] = []
        for partial in sorted(beam, key=lambda p: -p.local_score):
            key = partial.key()
            if key in seen:
                continue
            seen.add(key)
            unique.append(partial)

        width = self.config.search.beam_width
        shortlist = unique[: width * 3]
        rated = []
        for partial in shortlist:
            ctx = self.base_ctx.with_placed(partial.items)
            walkable = analyse_circulation(ctx, partial.items).valid
            rated.append((walkable, partial.local_score, partial))
        rated.sort(key=lambda entry: (not entry[0], -entry[1]))
        return [entry[2] for entry in rated[:width]]

    # ------------------------------------------------------------------ #
    def _hill_climb(self, result: LayoutResult, specs: List[PlacementSpec], scorer: LayoutScorer) -> LayoutResult:
        """Re-place one piece at a time, keeping any move that improves the total."""
        best_items = list(result.items)
        best_score = result.score
        spec_by_role = {s.role: s for s in specs}

        for sweep in range(self.config.search.hill_climb_passes):
            improved = False
            for index in range(len(best_items)):
                current = best_items[index]
                spec = spec_by_role.get(current.role)
                if spec is None:
                    continue
                others = [f for f in best_items if f.id != current.id]
                ctx = self.base_ctx.with_placed(others)
                placed_by_role = {i.role: i for i in others}
                candidates = self.generator.generate(
                    spec, current.spec, ctx, placed_by_role, current.id
                )
                ranked: List[Tuple[float, Furniture]] = []
                for candidate in candidates:
                    if self.checker.validate(candidate, ctx, record=False) is not None:
                        continue
                    ranked.append((scorer.score_placement(candidate, ctx, spec), candidate))
                ranked.sort(key=lambda pair: -pair[0])

                for points, candidate in ranked[:4]:
                    trial = others[:index] + [candidate] + others[index:]
                    # anything anchored to this piece (a side table beside the
                    # sofa, the screen on its console...) has to follow it even
                    # though it is not itself hard-invalidated by the move.
                    trial = self._repair(trial, spec_by_role, scorer, moved_role=spec.role, max_rounds=6)
                    if trial is None:
                        continue     # the move broke a piece that cannot be fixed
                    score = scorer.score(self.base_ctx, trial)
                    new_key = self._score_key(score)
                    old_key = self._score_key(best_score)
                    if new_key[0] != old_key[0]:
                        accept = new_key[0]          # the move restored walkability
                    else:
                        accept = new_key[1] > old_key[1] + 0.01
                    if accept:
                        candidate.reasons = self._placement_reasons(spec, candidate, points)
                        best_items = trial
                        best_score = score
                        improved = True
                        result.trace.append(
                            "Hill climbing moved {} to strategy '{}' (+{:.1f} points)".format(
                                spec.label(), candidate.strategy, score.total - result.score.total
                            )
                        )
                        break
            if not improved:
                break

        result.items = best_items
        result.score = best_score
        result.circulation = best_score.circulation or analyse_circulation(
            self.base_ctx.with_placed(best_items), best_items
        )
        return result

    # ------------------------------------------------------------------ #
    def _repair(
        self,
        items: List[Furniture],
        spec_by_role: Dict[str, PlacementSpec],
        scorer: LayoutScorer,
        max_rounds: int = 2,
        moved_role: Optional[str] = None,
    ) -> Optional[List[Furniture]]:
        """Re-place any piece a move has just invalidated - or orphaned.

        Moving one piece can legitimately require another to follow it: sliding
        a media console to a different wall has to take the screen with it
        (a *hard* link, `check_paired_furniture`), but a side table set beside
        the sofa is only a *soft* preference - nothing invalidates it when the
        sofa moves on, so without `moved_role` it would simply get left behind.
        `moved_role` is the role that was just placed elsewhere; every item
        anchored to it is force-repaired once even though it is still "valid"
        on its own. Returns None when the layout cannot be fixed.
        """
        items = list(items)
        already_repaired: set = set()
        for _ in range(max_rounds):
            broken = None
            hard_violation = False
            for index, item in enumerate(items):
                others = [f for f in items if f.id != item.id]
                if self.checker.validate(item, self.base_ctx.with_placed(others), record=False):
                    broken = index
                    hard_violation = True
                    break
                dependent_spec = spec_by_role.get(item.role)
                if (
                    moved_role is not None
                    and dependent_spec is not None
                    and dependent_spec.anchor == moved_role
                    and item.role not in already_repaired
                ):
                    broken = index
                    break
            if broken is None:
                return items

            item = items[broken]
            spec = spec_by_role.get(item.role)
            if spec is None:
                return None if hard_violation else items
            already_repaired.add(item.role)
            others = [f for f in items if f.id != item.id]
            ctx = self.base_ctx.with_placed(others)
            candidates = self.generator.generate(
                spec, item.spec, ctx, {i.role: i for i in others}, item.id
            )
            best: Optional[Tuple[float, Furniture]] = None
            for candidate in candidates:
                if self.checker.validate(candidate, ctx, record=False) is not None:
                    continue
                points = scorer.score_placement(candidate, ctx, spec)
                if best is None or points > best[0]:
                    best = (points, candidate)
            if best is None:
                # a hard link (e.g. the screen needs its console) that cannot
                # be satisfied kills the whole move; a soft follower (a side
                # table that simply couldn't find a snug spot by the new
                # anchor) is left where it was instead of vetoing an
                # otherwise-good move for an optional piece of furniture.
                if hard_violation:
                    return None
                continue
            best[1].reasons = self._placement_reasons(spec, best[1], best[0])
            best[1].reasons.append("Re-placed so it stayed with the piece it belongs to")
            items = others[:broken] + [best[1]] + others[broken:]
        return items if self._items_valid(items) else None

    def _items_valid(self, items: List[Furniture]) -> bool:
        """Every piece still satisfies the per-item hard constraints."""
        for item in items:
            others = [f for f in items if f.id != item.id]
            if self.checker.validate(item, self.base_ctx.with_placed(others), record=False) is not None:
                return False
        return True

    @staticmethod
    def _walkable(score: LayoutScore) -> bool:
        return bool(score.circulation and score.circulation.valid)

    @classmethod
    def _score_key(cls, score: LayoutScore) -> Tuple[bool, float]:
        """Walkable layouts always beat unwalkable ones, then points decide."""
        return (cls._walkable(score), score.total)

    @classmethod
    def _preferred(cls, candidate: LayoutResult, current: LayoutResult) -> bool:
        return cls._score_key(candidate.score) > cls._score_key(current.score)

    # ------------------------------------------------------------------ #
    def _placement_reasons(self, spec: PlacementSpec, item: Furniture, points: float) -> List[str]:
        """Human-readable justification attached to each placed piece."""
        reasons: List[str] = []
        if spec.note:
            reasons.append(spec.note)
        strategy, _, detail = item.strategy.partition(":")
        described = {
            "wall": "placed flat against the {} wall",
            "solid_wall": "placed against the solid {} wall",
            "media_wall": "placed on the {} wall, the best uninterrupted run for a screen",
            "corner": "tucked into the {} corner to free the middle of the room",
            "opposite": "placed against the {} wall so it faces its anchor",
            "wall_facing": "placed against the {} wall and turned towards the seating group",
            "facing": "turned to face the {}",
            "in_front_of": "set directly in front of the {}",
            "beside": "set beside the {}, within arm's reach",
            "beside_facing": "set next to the {} without blocking access to it",
            "near": "kept close to the {}",
            "near_window": "kept in the daylight from {}",
            "on_console": "mounted on the media unit",
            "at_desk": "tucked in at the desk",
            "center": "placed in the open floor area",
            "floating": "floated clear of the walls so circulation runs behind it",
            "fallback_center": "placed in the first free position that satisfies every hard constraint",
        }
        template = described.get(strategy)
        if template:
            reasons.append(template.format(detail.replace("_", " ")) if "{}" in template else template)
        reasons.append("Local placement score {:.1f}".format(points))
        return reasons
