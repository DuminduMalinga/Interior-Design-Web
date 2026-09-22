"""
Constraint checking with rejection bookkeeping (specification 11 and 14).

The checker is a thin wrapper around `rules.hard_constraints`, but it also
remembers *why* candidate placements were thrown away.  That record is what
turns the output from "here is a layout" into "here is a layout, and here is
why the bookshelf is not by the window".

Rejections are aggregated per (piece, rule) with a few worked examples, so the
report stays readable even though the search discards thousands of candidates.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from ..models.furniture import Furniture
from ..rules.context import PlacementContext, Violation
from ..rules.hard_constraints import check_item, check_item_all, check_layout


@dataclass
class RejectionGroup:
    """All candidate placements of one piece rejected by one rule."""

    role: str
    furniture_type: str
    rule: str
    count: int = 0
    message: str = ""
    examples: List[Dict] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return {
            "furniture": self.role or self.furniture_type,
            "type": self.furniture_type,
            "rule": self.rule,
            "rejected_positions": self.count,
            "reason": self.message,
            "examples": self.examples,
        }


class ConstraintChecker:
    """Validates placements and records the reasons for rejection."""

    def __init__(self, config, max_examples: int = 3):
        self.config = config
        self.max_examples = max_examples
        self.groups: Dict[Tuple[str, str], RejectionGroup] = {}
        self.checked = 0
        self.accepted = 0

    # ------------------------------------------------------------------ #
    def validate(self, item: Furniture, ctx: PlacementContext, record: bool = True) -> Optional[Violation]:
        """None when the placement is legal, otherwise the first violation."""
        self.checked += 1
        violation = check_item(item, ctx)
        if violation is None:
            self.accepted += 1
            return None
        if record:
            self._record(item, violation)
        return violation

    def explain(self, item: Furniture, ctx: PlacementContext) -> List[Violation]:
        """Every violation of one placement (for diagnostics, not the search)."""
        return check_item_all(item, ctx)

    def validate_layout(self, ctx: PlacementContext, items: List[Furniture]) -> List[Violation]:
        return check_layout(ctx, items)

    # ------------------------------------------------------------------ #
    def _record(self, item: Furniture, violation: Violation) -> None:
        key = (item.role or item.type, violation.rule)
        group = self.groups.get(key)
        if group is None:
            group = RejectionGroup(
                role=item.role, furniture_type=item.type, rule=violation.rule, message=violation.message
            )
            self.groups[key] = group
        group.count += 1
        if len(group.examples) < self.max_examples:
            group.examples.append(
                {
                    "position": [round(item.x), round(item.y)],
                    "rotation": item.rotation,
                    "strategy": item.strategy,
                    "reason": violation.message,
                }
            )

    # ------------------------------------------------------------------ #
    def report(self, limit: int = 40) -> List[Dict]:
        """Rejected placements, most frequent rule first."""
        groups = sorted(self.groups.values(), key=lambda g: -g.count)
        return [g.to_dict() for g in groups[:limit]]

    def flat_report(self, limit: int = 25) -> List[Dict]:
        """The specification's simpler shape: one entry per example position."""
        out: List[Dict] = []
        for group in sorted(self.groups.values(), key=lambda g: -g.count):
            for example in group.examples:
                out.append(
                    {
                        "furniture": group.role or group.furniture_type,
                        "position": example["position"],
                        "rotation": example["rotation"],
                        "reason": example["reason"],
                        "rule": group.rule,
                    }
                )
                if len(out) >= limit:
                    return out
        return out

    def statistics(self) -> Dict:
        return {
            "candidates_tested": self.checked,
            "candidates_accepted": self.accepted,
            "candidates_rejected": self.checked - self.accepted,
            "rejections_by_rule": {
                rule: sum(g.count for g in self.groups.values() if g.rule == rule)
                for rule in sorted({g.rule for g in self.groups.values()})
            },
        }

    def reset(self) -> None:
        self.groups.clear()
        self.checked = 0
        self.accepted = 0
