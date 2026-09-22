"""
Layout scoring (specification 12).

`LayoutScorer` is the single place that turns a set of placed furniture into a
number.  It composes:

    generic soft constraints   rules/soft_constraints.py
    layout-specific bonuses    layouts/<layout>.bonus()

and keeps every individual contribution so the report can explain the total.
"""

from __future__ import annotations

from typing import List, Optional

from ..layouts.base import BaseLayout
from ..models.furniture import Furniture
from ..rules.circulation_rules import CirculationReport, analyse_circulation
from ..rules.context import PlacementContext, ScoreItem
from ..rules.soft_constraints import LayoutScore, placement_score, score_layout


class LayoutScorer:
    """Scores complete layouts, and individual placements during the search."""

    def __init__(self, layout: BaseLayout, expected_roles: Optional[List[str]] = None):
        self.layout = layout
        self.expected_roles = expected_roles or []

    # -- whole layout -------------------------------------------------------- #
    def score(
        self,
        ctx: PlacementContext,
        items: List[Furniture],
        report: Optional[CirculationReport] = None,
    ) -> LayoutScore:
        full_ctx = ctx.with_placed(items)
        report = report or analyse_circulation(full_ctx, items)
        extra: List[ScoreItem] = self.layout.bonus(full_ctx, items)
        return score_layout(ctx, items, expected=self.expected_roles, report=report, extra=extra)

    # -- single placement ---------------------------------------------------- #
    def score_placement(self, item: Furniture, ctx: PlacementContext, spec=None) -> float:
        """Local score used to rank candidates while building a layout."""
        points = placement_score(item, ctx)
        if spec is not None:
            points += self.layout.placement_bias(item, spec, ctx)
        return points

    # -- explanation --------------------------------------------------------- #
    @staticmethod
    def top_reasons(score: LayoutScore, limit: int = 8) -> List[str]:
        ordered = sorted(score.items, key=lambda s: -abs(s.points))
        return [s.message for s in ordered[:limit]]
