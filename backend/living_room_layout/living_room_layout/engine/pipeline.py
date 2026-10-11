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
from ..layouts.zones import assign_zones
from ..models.furniture import Furniture, FurnitureCatalogue
from ..models.geometry import Rect
from ..programme import Programme, apply_programme, catalogue_for
from ..rules.circulation_rules import analyse_circulation
from ..rules.context import PlacementContext, Violation
from ..rules.door_rules import check_door_clearance, check_door_opening, check_door_swing
from ..rules.hard_constraints import check_furniture_overlap, check_room_boundary, rule_catalogue
from ..rules.living_rules import rule_catalogue as living_rule_catalogue
from ..rules.window_rules import check_window_block
from .constraint_checker import ConstraintChecker
from .layout_selector import LayoutDecision, LayoutSelector
from .optimizer import LayoutOptimizer, LayoutResult
from .room_analyzer import RoomAnalysis, RoomAnalyzer

MAX_LAYOUT_ATTEMPTS = 3


@dataclass
class Attempt:
    """One layout generated at one furniture size tier."""

    layout: BaseLayout
    result: LayoutResult
    specs: List[PlacementSpec]
    programme: Programme
    catalogue: FurnitureCatalogue
    zones: Dict[str, Rect] = field(default_factory=dict)       # zone name -> floor band
    zone_by_role: Dict[str, Rect] = field(default_factory=dict)
    zone_reasons: List[str] = field(default_factory=list)

    @property
    def missing_required(self) -> List:
        return [f for f in self.result.failures if f.required]

    @property
    def complete(self) -> bool:
        return self.result.valid and not self.missing_required


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
    programme: Optional[Programme] = None
    catalogue: Optional[FurnitureCatalogue] = None
    zones: Dict[str, Rect] = field(default_factory=dict)

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
            # a dining set is listed as its table and its chairs
            "furniture": [entry for item in self.result.items for entry in item.output_dicts()],
            "validation": self.validation(),
            "explanation": list(self.explanation),
            "selected_layout": self.result.layout.name,
            "reason": list(self.decision.reasons),
            "rejected_positions": self.checker.flat_report(limit=25),
            "rejection_summary": self.checker.report(limit=30),
            "unplaced_furniture": [f.to_dict() for f in self.result.failures],
            "scoring": self.result.score.to_dict(),
            # the ten rules, each with its mark and the measured numbers behind it
            "rules": self.result.score.rules_report(),
            "programme": self.programme.to_dict(self.catalogue) if self.programme else None,
            "zones": [
                {"name": name, "bbox": [round(z.x0, 1), round(z.y0, 1), round(z.x1, 1), round(z.y1, 1)]}
                for name, z in self.zones.items()
            ],
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
            "rules_applied": {
                "rules": living_rule_catalogue(self.scenario.config),
                "hard_constraints": rule_catalogue(),
            },
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

        # the programme: furniture sizes (rule 5), the furniture each daily
        # activity needs (rule 7) and the clearances for mobility needs (rule 10)
        programme = apply_programme(self.scenario)

        # steps 2-8: analyse the room
        analysis = RoomAnalyzer(self.scenario).analyze()
        analysis.programme = programme
        analysis.sofa_length = self.scenario.catalogue.spec("sofa").width

        # step 9: choose a layout
        selector = LayoutSelector()
        decision = selector.select(analysis, self.scenario.requirements)

        # steps 10-16: place, validate, score, optimise
        order = self._attempt_order(decision)
        checker = ConstraintChecker(self.scenario.config)
        attempts: List[Dict] = []
        best: Optional[Attempt] = None

        for layout in order[:MAX_LAYOUT_ATTEMPTS]:
            attempt = self._attempt(layout, analysis, checker, programme)
            attempts.append(self._attempt_record(attempt))
            # rule 5: "select furniture sizes that fit" - when the sizes the
            # floor area called for leave a piece out, try the next size down
            smaller = programme.smaller_tier()
            if not attempt.complete and smaller is not None:
                retry = self._attempt(layout, analysis, checker, programme.at_tier(smaller))
                attempts.append(self._attempt_record(retry))
                if self._better(retry.result, attempt.result):
                    attempt = retry
            if best is None or self._better(attempt.result, best.result):
                best = attempt
            if attempt.complete:
                break

        # the rule report and the validation below refer to the winning attempt
        analysis.programme = best.programme
        analysis.zone_by_role = best.zone_by_role
        analysis.sofa_length = best.catalogue.spec("sofa").width
        explanation = self._explain(analysis, decision, best, attempts)
        return GenerationResult(
            scenario=self.scenario,
            analysis=analysis,
            decision=decision,
            result=best.result,
            checker=checker,
            specs=best.specs,
            attempts=attempts,
            explanation=explanation,
            elapsed=time.time() - started,
            programme=best.programme,
            catalogue=best.catalogue,
            zones=best.zones,
        )

    # ------------------------------------------------------------------ #
    def _attempt(self, layout: BaseLayout, analysis: RoomAnalysis, checker: ConstraintChecker,
                 programme: Programme) -> Attempt:
        """Plan, zone and optimise one layout at the programme's size tier."""
        scenario = self.scenario
        if programme.tier == programme.planned_tier:
            catalogue = scenario.catalogue
        else:
            catalogue = catalogue_for(programme.tier, scenario.furniture_overrides)
        # the furniture list as it stands for this layout (a corner layout swaps in its own sofa)
        programme = programme.at_tier(programme.tier)
        programme.required = list(scenario.requirements.required_furniture)
        programme.optional = list(scenario.requirements.optional_furniture)
        analysis.programme = programme
        analysis.sofa_length = catalogue.spec("sofa").width

        specs = layout.plan(analysis, scenario.requirements, catalogue)
        # rule 3: one floor band per activity area, when the plan has more than one
        zone_by_role, zone_reasons = assign_zones(specs, analysis)
        analysis.zone_by_role = zone_by_role
        zones = {spec.zone_name: spec.zone for spec in specs if spec.zone is not None and spec.zone_name}

        result = LayoutOptimizer(analysis, layout, catalogue, checker).optimize(specs)
        return Attempt(layout=layout, result=result, specs=specs, programme=programme,
                       catalogue=catalogue, zones=zones, zone_by_role=zone_by_role, zone_reasons=zone_reasons)

    @staticmethod
    def _attempt_record(attempt: Attempt) -> Dict:
        result = attempt.result
        return {
            "layout": attempt.layout.name,
            "size_tier": attempt.programme.tier,
            "score": round(result.score.total, 1),
            "valid": result.valid,
            "furniture_placed": len(result.items),
            "required_missing": [f.role for f in attempt.missing_required],
            "hard_constraint_violations": [v.message for v in result.violations],
        }

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
    def _explain(self, analysis, decision, best: Attempt, attempts) -> List[str]:
        """The narrative answer to 'why does the room look like this?'"""
        result = best.result
        programme = best.programme
        lines: List[str] = []
        lines.extend(analysis.facts[:4])
        lines.append("Furnished for {} ({}): {}".format(
            programme.activity_text(),
            "as given" if programme.activities_source == "provided" else "assumed from the room's purpose",
            programme.summary(best.catalogue)))
        lines.extend(programme.notes)
        if programme.tier != programme.planned_tier:
            lines.append("The {} sizes the floor area called for left a piece without a place, so {} sizes "
                         "were used".format(programme.planned_tier, programme.tier))
        lines.extend(best.zone_reasons)
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
        scale = result.score.scale
        for number, rule in enumerate(result.score.rules.values(), start=1):
            if not rule.applicable:
                lines.append("Rule {} - {}: not applicable. {}".format(number, rule.rule.title, rule.detail))
            else:
                lines.append("Rule {} - {}: {:.1f} of {:.0f} points. {}".format(
                    number, rule.rule.title, rule.points * scale, rule.weight * scale, rule.detail))
        return lines


def generate(scenario: Scenario) -> GenerationResult:
    """Convenience wrapper: scenario in, finished layout out."""
    return LayoutGenerator(scenario).run()
