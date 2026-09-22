"""
Layout base classes.

A layout is a *plan*, not a set of coordinates: it says which pieces belong to
the arrangement, in what order they should be placed, and how each piece
relates to the ones before it.  The candidate generator turns those relations
into concrete positions and the optimizer picks between them.

Adding a seventh layout means adding one module here and registering it in
`layouts/__init__.py` - no engine code changes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from ..models.furniture import FurnitureCatalogue
from ..rules.context import PlacementContext, ScoreItem

#: how a *requested-but-not-native* piece of furniture should be placed when a
#: layout has no spec of its own for it (used by `apply_requirements` below).
#: Without this a piece like a rug just goes to "wall, corner or centre" with
#: no idea where the seating group even is - which is how a rug and the sofa
#: used to end up landing on top of each other (harmless to the checker, since
#: a rug is overlap-exempt, but not a look anyone wants). `anchor="sofa"`
#: resolves to whichever role the layout's own sofa/l_sofa/loveseat actually
#: has; every entry still falls back to wall/corner/centre so it is never
#: less robust than the old default, only better-aimed when it can be.
FALLBACK_PLACEMENT: Dict[str, Tuple[List[str], Optional[str]]] = {
    # A rug is overlap-*exempt* (so ordinary furniture can stand on it), which
    # cuts both ways: "wall" and "corner" fallbacks are drawn to exactly the
    # spots a sofa already occupies (a corner sofa lives in a corner; most
    # sofas live against a wall), and since overlap is never checked for a
    # rug, a candidate sitting entirely underneath the sofa is just as "valid"
    # as one that isn't - it can win outright. Note "center" is *not* the
    # fix here despite the name: it samples the whole room with zero wall
    # margin, so it can still land flush in the same corner. "floating" is
    # the one that actually keeps a real margin off every wall - only it and
    # "in_front_of" (which explicitly starts clear of the anchor) are
    # offered; if neither fits, the rug is simply left unplaced (it is
    # optional) rather than dropped somewhere that reads as a mistake.
    "rug": (["in_front_of", "floating"], "sofa"),
    "lamp": (["beside", "near", "wall", "corner", "center"], "sofa"),
}


@dataclass
class PlacementSpec:
    """One piece of furniture in a layout plan, with its placement strategy."""

    role: str                                   # unique name inside the layout
    type: str                                   # furniture catalogue type
    required: bool = True                       # False = place only if it fits
    strategies: List[str] = field(default_factory=lambda: ["wall"])
    anchor: Optional[str] = None                # role this piece relates to
    walls: Optional[List[str]] = None           # restrict to these walls
    min_distance: Optional[float] = None
    max_distance: Optional[float] = None
    variants: Tuple[str, ...] = ("left",)       # for L-shaped pieces
    zone: Optional[object] = None               # Rect the piece must sit inside
    zone_name: str = ""                         # zone label for the explanation
    note: str = ""                              # why the layout wants this piece

    def label(self) -> str:
        return self.role or self.type


@dataclass
class Suitability:
    """How well a layout fits a room, with the reasoning behind the number."""

    layout: str
    score: float
    reasons: List[str] = field(default_factory=list)
    blockers: List[str] = field(default_factory=list)

    @property
    def feasible(self) -> bool:
        return not self.blockers

    def to_dict(self) -> Dict:
        return {
            "layout": self.layout,
            "score": round(self.score, 1),
            "feasible": self.feasible,
            "reasons": list(self.reasons),
            "blockers": list(self.blockers),
        }


class BaseLayout:
    """Interface every layout implements."""

    name: str = "base"
    title: str = "Base layout"
    best_for: List[str] = []
    purposes: List[str] = []

    # -- plan --------------------------------------------------------------- #
    def plan(self, analysis, requirements, catalogue: FurnitureCatalogue) -> List[PlacementSpec]:
        raise NotImplementedError

    # -- selection ---------------------------------------------------------- #
    def suitability(self, analysis, requirements) -> Suitability:
        raise NotImplementedError

    # -- layout-specific soft rules ----------------------------------------- #
    def bonus(self, ctx: PlacementContext, items) -> List[ScoreItem]:
        """Extra whole-layout score contributions specific to this layout."""
        return []

    def placement_bias(self, item, spec: PlacementSpec, ctx: PlacementContext) -> float:
        """Layout-specific nudge applied while ranking one candidate placement.

        The generic local score rewards wall alignment; a layout that wants the
        opposite (an open-centre island, say) expresses that here instead of
        having to fight the generic rule.
        """
        return 0.0

    # -- helpers shared by the concrete layouts ----------------------------- #
    @staticmethod
    def _purpose_match(requirements, purposes: List[str], points: float = 30.0) -> Tuple[float, List[str]]:
        if requirements.purpose in purposes:
            return points, ["User purpose '{}' matches this layout".format(requirements.purpose)]
        return 0.0, []

    @staticmethod
    def _requested(requirements, *types: str) -> bool:
        wanted = set(requirements.required_furniture) | set(requirements.optional_furniture)
        return bool(wanted & set(types))

    #: sofa variants are interchangeable - the user's choice replaces the
    #: layout's default rather than being placed alongside it
    SOFA_TYPES = ("sofa", "l_sofa", "loveseat")

    @staticmethod
    def apply_requirements(specs: List[PlacementSpec], requirements) -> List[PlacementSpec]:
        """Reconcile a layout's native roster with what the user asked for.

        * anything the user listed as required stays required;
        * a layout's own extras become optional (placed only when they fit);
        * anything the user excluded is dropped;
        * a requested type the layout does not know about is appended.
        """
        required = list(requirements.required_furniture)
        optional = set(requirements.optional_furniture)
        excluded = set(requirements.excluded_furniture)

        # a *required* sofa variant substitutes the layout's own sofa; an
        # optional one is only a suggestion and never displaces the default
        requested_sofa = next((t for t in required if t in BaseLayout.SOFA_TYPES), None)

        kept: List[PlacementSpec] = []
        seen_sofa = False
        for spec in specs:
            if spec.type in excluded:
                continue
            if spec.type in BaseLayout.SOFA_TYPES:
                if seen_sofa:
                    continue
                seen_sofa = True
                if requested_sofa and requested_sofa != spec.type:
                    spec.type = requested_sofa
                    spec.note = spec.note + " (using the {} the user asked for)".format(
                        requested_sofa.replace("_", " "))
            if required:
                spec.required = spec.type in required
            kept.append(spec)

        # the sofa's *role* varies by layout (l_shaped uses "l_sofa"); resolve
        # it once so a fallback piece can anchor to whichever it actually is
        sofa_role = next((s.role for s in kept if s.type in BaseLayout.SOFA_TYPES), None)

        known = {s.type for s in kept}
        for type_name in required + sorted(optional):
            if type_name in known or type_name in excluded:
                continue
            strategies, anchor = FALLBACK_PLACEMENT.get(type_name, (["wall", "corner", "center"], None))
            use_anchor = sofa_role if anchor == "sofa" and sofa_role else None
            if anchor == "sofa" and not use_anchor:
                # no sofa in this layout to anchor to - fall back to the walls
                strategies = ["wall", "corner", "center"]
            kept.append(
                PlacementSpec(
                    role=type_name,
                    type=type_name,
                    required=type_name in required,
                    strategies=strategies,
                    anchor=use_anchor,
                    note="Requested by the user; added to this layout's roster"
                    + (" near the seating group" if use_anchor else ""),
                )
            )
            known.add(type_name)
        return kept
