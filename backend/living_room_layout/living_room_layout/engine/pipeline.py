"""
The end-to-end pipeline (specification 1 and 15).

    JSON input -> parse -> analyse room -> doors -> swings -> windows ->
    solid walls -> usable area -> room characteristics -> select layout ->
    select furniture -> generate candidates -> hard constraints ->
    soft score -> optimise -> best valid layout -> validate -> JSON output

`LayoutGenerator.run()` executes exactly that order and returns a
`GenerationResult` that can serialise itself to the output JSON.

If the selected layout cannot place its required furniture, the pipeline falls
back to the next feasible layout and says so in the explanation - the layout
choice itself is subject to the hard constraints.

`LayoutGenerator(scenario, force_layout="reading")` switches that fallback off
and generates exactly the layout asked for, which is how one room can be
rendered in all six layouts for comparison.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from ..io_json import Scenario
from ..layouts.base import BaseLayout, PlacementSpec
from ..models.furniture import Furniture
from ..rules.circulation_rules import analyse_circulation
from ..rules.context import PlacementContext, Violation
from ..rules.door_rules import check_door_clearance, check_door_opening, check_door_swing
from ..rules.hard_constraints import check_furniture_overlap, check_room_boundary, rule_catalogue
from ..rules.window_rules import check_window_block
from .constraint_checker import ConstraintChecker
from .layout_selector import LayoutDecision, LayoutSelector
from .optimizer import LayoutOptimizer, LayoutResult
from .room_analyzer import RoomAnalysis, RoomAnalyzer

MAX_LAYOUT_ATTEMPTS = 3


@dataclass
class GenerationResult:
    """Everything one run produced, ready to be serialised."""

    scenario: Scenario
    analysis: RoomAnalysis
    decision: LayoutDecision
    result: LayoutResult
    checker: ConstraintChecker
    specs: List[PlacementSpec]
    attempts: List[Dict] = field(default_factory=list)
    explanation: List[str] = field(default_factory=list)
    elapsed: float = 0.0

    # -- validation ---------------------------------------------------------- #
    def validation(self) -> Dict:
        ctx = PlacementContext(self.analysis, self.result.items)
        items = self.result.items

        def any_violation(check) -> Optional[Violation]:
            for item in items:
                others = [f for f in items if f.id != item.id]
                violation = check(item, ctx.with_placed(others))
                if violation is not None:
                    return violation
            return None

        boundary = any_violation(check_room_boundary)
        overlap = any_violation(check_furniture_overlap)
        door_open = any_violation(check_door_opening)
        door_clear = any_violation(check_door_clearance)
        door_swing = any_violation(check_door_swing)
        window = any_violation(check_window_block)
        circulation = self.result.circulation

        door_issue = door_open or door_clear or door_swing
        details = [v.message for v in self.result.violations]
        return {
            "valid": self.result.valid,
            "inside_room_boundary": boundary is None,
            "furniture_overlap": overlap is not None,
            "door_blocked": door_issue is not None,
            "door_swing_blocked": door_swing is not None,
            "window_blocked": window is not None,
            "circulation_valid": bool(circulation and circulation.valid),
            "circulation": circulation.to_dict() if circulation else None,
            "hard_constraint_violations": [v.to_dict() for v in self.result.violations],
            "notes": details,
            "unplaced_required_furniture": [
                f.to_dict() for f in self.result.failures if f.required
            ],
        }

    # -- output -------------------------------------------------------------- #
    def suitability(self):
        """The suitability of the layout that was generated, not of the first choice."""
        for entry in self.decision.ranking:
            if entry.layout == self.result.layout.name:
                return entry
        return self.decision.suitability

    def to_dict(self, include_analysis: bool = True) -> Dict:
        room = self.scenario.room
        clear = self.scenario.config.clearances
        data: Dict = {
            "room": {
                "width": room.width,
                "length": room.length,
                "height": room.height,
                "area_m2": round(room.area_m2, 2),
            },
            "doors": list(self.scenario.input_doors),
            "windows": list(self.scenario.input_windows),
            "layout": {
                "type": self.result.layout.name,
                "title": self.result.layout.title,
                "score": round(self.result.score.total, 1),
                "suitability_score": round(self.suitability().score, 1),
            },
            "furniture": [item.to_dict() for item in self.result.items],
            "validation": self.validation(),
            "explanation": list(self.explanation),
            "selected_layout": self.result.layout.name,
            "reason": list(self.decision.reasons),
            "rejected_positions": self.checker.flat_report(limit=25),
            "rejection_summary": self.checker.report(limit=30),
            "unplaced_furniture": [f.to_dict() for f in self.result.failures],
            "scoring": self.result.score.to_dict(),
            "layout_selection": self.decision.to_dict(),
            "openings": {
                "doors": [d.to_dict(room, clear.door_clearance_min) for d in self.scenario.doors],
                "windows": [w.to_dict(room, clear.window_access_depth) for w in self.scenario.windows],
            },
            "search": dict(
                self.checker.statistics(),
                attempts=self.attempts,
                placements_evaluated=self.result.iterations,
                elapsed_seconds=round(self.elapsed, 3),
                trace=list(self.result.trace),
            ),
            "rules_applied": {"hard_constraints": rule_catalogue()},
            "user_requirements": self.scenario.requirements.to_dict(),
        }
        if include_analysis:
            data["room_analysis"] = self.analysis.to_dict()
        return data


class LayoutGenerator:
    """Runs the whole pipeline for one scenario."""

    def __init__(self, scenario: Scenario, force_layout: Optional[str] = None):
        self.scenario = scenario
        #: name (or alias) of the one layout to generate; None = automatic
        self.force_layout = force_layout

    def run(self) -> GenerationResult:
        started = time.time()

        # steps 2-8: analyse the room
        analysis = RoomAnalyzer(self.scenario).analyze()

        # step 9: choose a layout
        selector = LayoutSelector()
        decision = selector.select(analysis, self.scenario.requirements)

        # steps 10-16: place, validate, score, optimise
        order = self._attempt_order(decision)
        checker = ConstraintChecker(self.scenario.config)
        attempts: List[Dict] = []
        best: Optional[LayoutResult] = None
        best_specs: List[PlacementSpec] = []
        best_layout: Optional[BaseLayout] = None

        for layout in order[:MAX_LAYOUT_ATTEMPTS]:
            specs = layout.plan(analysis, self.scenario.requirements, self.scenario.catalogue)
            optimizer = LayoutOptimizer(analysis, layout, self.scenario.catalogue, checker)
            result = optimizer.optimize(specs)
            missing_required = [f for f in result.failures if f.required]
            attempts.append(
                {
                    "layout": layout.name,
                    "score": round(result.score.total, 1),
                    "valid": result.valid,
                    "furniture_placed": len(result.items),
                    "required_missing": [f.role for f in missing_required],
                    "hard_constraint_violations": [v.message for v in result.violations],
                }
            )
            if best is None or self._better(result, best):
                best, best_specs, best_layout = result, specs, layout
            if result.valid and not missing_required:
                break

        explanation = self._explain(analysis, decision, best, attempts)
        return GenerationResult(
            scenario=self.scenario,
            analysis=analysis,
            decision=decision,
            result=best,
            checker=checker,
            specs=best_specs,
            attempts=attempts,
            explanation=explanation,
            elapsed=time.time() - started,
        )

    # ------------------------------------------------------------------ #
    def _attempt_order(self, decision: LayoutDecision) -> List[BaseLayout]:
        """Selected layout first, then the remaining feasible ones by score."""
        from ..layouts import LAYOUTS_BY_NAME, get_layout

        if self.force_layout:
            forced = get_layout(self.force_layout)
            if forced is not None:
                return [forced]      # the caller wants this layout, fallback included

        order = [decision.layout]
        for suitability in decision.ranking:
            if suitability.layout == decision.layout.name or not suitability.feasible:
                continue
            order.append(LAYOUTS_BY_NAME[suitability.layout])
        return order

    @staticmethod
    def _better(candidate: LayoutResult, current: LayoutResult) -> bool:
        """Valid beats invalid; then fewer missing required pieces; then score."""
        c_missing = len([f for f in candidate.failures if f.required])
        b_missing = len([f for f in current.failures if f.required])
        c_key = (candidate.valid, -c_missing, candidate.score.total)
        b_key = (current.valid, -b_missing, current.score.total)
        return c_key > b_key

    # ------------------------------------------------------------------ #
    def _explain(self, analysis, decision, result: LayoutResult, attempts) -> List[str]:
        """The narrative answer to 'why does the room look like this?'"""
        lines: List[str] = []
        lines.extend(analysis.facts[:4])
        lines.append(
            "Selected the {} because: {}".format(
                result.layout.title, "; ".join(decision.reasons[:3]) or "it scored highest"
            )
        )
        if result.layout.name != decision.layout.name:
            if self.force_layout:
                lines.append(
                    "The {} layout was generated on request, overriding the {} layout the selector "
                    "would have chosen".format(result.layout.name, decision.layout.name)
                )
            else:
                lines.append(
                    "The first-choice {} layout could not place its required furniture, so the {} layout "
                    "was generated instead".format(decision.layout.name, result.layout.name)
                )
        for item in result.items:
            reason = item.reasons[1] if len(item.reasons) > 1 else (item.reasons[0] if item.reasons else "")
            lines.append(
                "{} at ({:.0f}, {:.0f}) facing {}: {}".format(
                    (item.role or item.type).replace("_", " "),
                    item.x, item.y,
                    {0: "north", 90: "west", 180: "south", 270: "east"}[item.rotation],
                    reason,
                )
            )
        if result.circulation:
            lines.extend(result.circulation.messages[:2])
        for failure in result.failures:
            lines.append(
                "{} was not placed: {}".format(
                    failure.role or failure.type,
                    failure.reasons[0] if failure.reasons else "no candidate position satisfied every hard constraint",
                )
            )
        top = sorted(result.score.items, key=lambda s: -s.points)[:5]
        for entry in top:
            lines.append("+{:.0f} points: {}".format(entry.points, entry.message))
        for entry in sorted(result.score.items, key=lambda s: s.points)[:3]:
            if entry.points < 0:
                lines.append("{:.0f} points: {}".format(entry.points, entry.message))
        return lines


def generate(scenario: Scenario) -> GenerationResult:
    """Convenience wrapper: scenario in, finished layout out."""
    return LayoutGenerator(scenario).run()
