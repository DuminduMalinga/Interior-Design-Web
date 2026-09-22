"""
Automatic layout selection (specification 8).

Rather than an if/else chain, every layout scores itself against the analysed
room and the user's brief, and the highest feasible score wins.  Each layout
also reports *blockers* - conditions under which it simply cannot work (no
solid wall for a bookshelf, no corner for an L-sofa, a room too small to walk
around a floating group) - and a blocked layout is never selected.

A user's `preferred_layout` is honoured unless it is blocked, in which case the
selector says so explicitly and falls back to the best feasible alternative.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from ..layouts import ALL_LAYOUTS, BaseLayout, get_layout
from ..layouts.base import Suitability


@dataclass
class LayoutDecision:
    """The chosen layout plus the full ranking that produced it."""

    layout: BaseLayout
    suitability: Suitability
    ranking: List[Suitability] = field(default_factory=list)
    reasons: List[str] = field(default_factory=list)
    rejected: List[Dict] = field(default_factory=list)
    user_preference: Optional[str] = None
    preference_honoured: bool = True

    def to_dict(self) -> Dict:
        return {
            "selected_layout": self.layout.name,
            "title": self.layout.title,
            "score": round(self.suitability.score, 1),
            "user_preference": self.user_preference,
            "preference_honoured": self.preference_honoured,
            "reason": list(self.reasons),
            "ranking": [s.to_dict() for s in self.ranking],
            "rejected_layouts": list(self.rejected),
        }


class LayoutSelector:
    """Scores every layout for the room and picks the best feasible one."""

    def __init__(self, layouts: Optional[List[BaseLayout]] = None):
        self.layouts = layouts or ALL_LAYOUTS

    def select(self, analysis, requirements) -> LayoutDecision:
        ranking: List[Suitability] = []
        for layout in self.layouts:
            try:
                ranking.append(layout.suitability(analysis, requirements))
            except Exception as error:  # a broken layout must not kill the run
                ranking.append(
                    Suitability(layout.name, -999.0, [], ["layout raised an error: {}".format(error)])
                )
        ranking.sort(key=lambda s: -s.score)
        by_name = {s.layout: s for s in ranking}
        feasible = [s for s in ranking if s.feasible]

        reasons: List[str] = []
        rejected = [
            {
                "layout": s.layout,
                "score": round(s.score, 1),
                "reason": s.blockers[0] if s.blockers else "Scored lower than the selected layout",
                "details": s.blockers or s.reasons[:2],
            }
            for s in ranking
        ]

        # 1. user preference wins when it can work
        preference = requirements.preferred_layout
        preferred_layout = get_layout(preference) if preference else None
        if preference and preferred_layout is None:
            reasons.append(
                "Requested layout '{}' is not one of the six supported layouts; falling back to automatic "
                "selection".format(preference)
            )
        elif preferred_layout is not None:
            suitability = by_name[preferred_layout.name]
            if suitability.feasible:
                reasons.append("User requested the {} layout and the room can support it".format(preference))
                reasons.extend(suitability.reasons[:4])
                chosen = preferred_layout
                return LayoutDecision(
                    layout=chosen,
                    suitability=suitability,
                    ranking=ranking,
                    reasons=reasons,
                    rejected=[r for r in rejected if r["layout"] != chosen.name],
                    user_preference=preference,
                    preference_honoured=True,
                )
            reasons.append(
                "User requested the {} layout, but it cannot satisfy the hard constraints: {}".format(
                    preference, suitability.blockers[0]
                )
            )

        # 2. otherwise the best feasible score wins
        best = feasible[0] if feasible else ranking[0]
        chosen = next(l for l in self.layouts if l.name == best.layout)
        if not feasible:
            reasons.append(
                "No layout is a clean fit for this room; using the least constrained option"
            )
        reasons.extend(best.reasons[:5])
        runner_up = next((s for s in ranking if s.layout != best.layout and s.feasible), None)
        if runner_up is not None:
            reasons.append(
                "Chosen over the {} layout ({:.0f} vs {:.0f} suitability points)".format(
                    runner_up.layout, best.score, runner_up.score
                )
            )
        return LayoutDecision(
            layout=chosen,
            suitability=best,
            ranking=ranking,
            reasons=reasons,
            rejected=[r for r in rejected if r["layout"] != chosen.name],
            user_preference=preference,
            preference_honoured=preference is None,
        )
