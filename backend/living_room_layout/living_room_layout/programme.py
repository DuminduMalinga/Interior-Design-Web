"""
The furniture programme: what the ten living-room rules *decide* before any
piece is placed.

    rule 5   furniture sizes that fit the room   -> a size tier for the floor area
    rule 7   the household's daily activities    -> which furniture is planned
    rule 3   zones when necessary                -> one area per activity (layouts/zones.py)
    rule 10  occupants' physical needs           -> wider clearances, no loose rug

`apply_programme(scenario)` works these out once, rewrites the scenario's
catalogue, furniture lists and clearances to match, and records every decision
so the rule report can say what was planned and why.  It is idempotent: the
API calls it up front (to adjust the plan per layout), the pipeline calls it
again and gets the same programme back.
"""

from __future__ import annotations

import copy
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .config import Config
from .models.furniture import FurnitureCatalogue
from .models.room import Room

#: the daily activities rule 7 knows how to furnish, in the order they are reported
ACTIVITIES = ("conversation", "tv", "reading", "work", "dining")
ACTIVITY_LABELS = {
    "conversation": "conversation",
    "tv": "watching TV",
    "reading": "reading",
    "work": "working",
    "dining": "dining",
}

#: the activities a stated purpose implies, when none are named
PURPOSE_ACTIVITIES: Dict[str, List[str]] = {
    "family_social": ["conversation", "tv"],
    "conversation": ["conversation"],
    "socializing": ["conversation"],
    "guests": ["conversation"],
    "entertaining": ["conversation"],
    "entertainment": ["tv", "conversation"],
    "tv": ["tv", "conversation"],
    "media": ["tv", "conversation"],
    "movie": ["tv", "conversation"],
    "reading": ["reading", "conversation"],
    "relaxation": ["reading", "conversation"],
    "quiet": ["reading", "conversation"],
    "study": ["reading", "work", "conversation"],
    "work": ["work", "conversation", "tv"],
    "home_office": ["work", "conversation", "tv"],
    "multi_function": ["tv", "reading", "work", "conversation"],
    "multifunctional": ["tv", "reading", "work", "conversation"],
}
DEFAULT_ACTIVITIES = ["conversation", "tv"]

#: a piece of furniture that only makes sense for one activity
FURNITURE_ACTIVITY = {
    "tv": "tv", "tv_console": "tv",
    "bookshelf": "reading", "reading_chair": "reading",
    "desk": "work", "desk_chair": "work",
    "dining_set": "dining",
}
#: the furniture an activity cannot do without, in placement order
ACTIVITY_FURNITURE: Dict[str, List[str]] = {
    "conversation": [],
    "tv": ["tv_console", "tv"],
    "reading": ["bookshelf", "reading_chair"],
    "work": ["desk", "desk_chair"],
    "dining": ["dining_set"],
}
#: placed when it fits
ACTIVITY_EXTRAS: Dict[str, List[str]] = {
    "conversation": ["chair", "side_table"],
    "tv": [],
    "reading": ["lamp"],
    "work": [],
    "dining": [],
}
#: every living room starts from a seating group
CORE_FURNITURE = ["sofa", "coffee_table"]
#: extra optional pieces once the floor area passes each threshold, so a large
#: room does not end up mostly empty
FURNITURE_BY_AREA_M2 = ((16.0, "rug"), (22.0, "lamp"), (30.0, "storage_cabinet"))

SOFA_TYPES = ("sofa", "l_sofa", "loveseat")

# --------------------------------------------------------------------------- #
# rule 5: sizes
# --------------------------------------------------------------------------- #
TIERS = ("compact", "standard", "generous")
#: catalogue overrides per tier; "standard" is the catalogue as written
TIER_SIZES: Dict[str, Dict[str, Dict]] = {
    "compact": {
        "sofa": {"width": 1800, "depth": 850},
        "loveseat": {"width": 1500, "depth": 850},
        "l_sofa": {"width": 2300, "depth": 1600, "leg_depth": 850},
        "chair": {"width": 700, "depth": 700},
        "reading_chair": {"width": 750, "depth": 750},
        "coffee_table": {"width": 900, "depth": 500},
        "side_table": {"width": 450, "depth": 450},
        "tv": {"width": 1000},
        "tv_console": {"width": 1200, "depth": 400},
        "bookshelf": {"width": 800},
        "storage_cabinet": {"width": 800, "depth": 400},
        "desk": {"width": 1000, "depth": 550},
        "rug": {"width": 1600, "depth": 1200},
        "dining_set": {"width": 1100, "depth": 1600, "seats": 4},
    },
    "standard": {},
    "generous": {
        "sofa": {"width": 2500, "depth": 950},
        "l_sofa": {"width": 3000, "depth": 2300, "leg_depth": 950},
        "coffee_table": {"width": 1300, "depth": 700},
        "tv": {"width": 1400},
        "tv_console": {"width": 2000},
        "rug": {"width": 3000, "depth": 2000},
        "dining_set": {"width": 1600, "depth": 1800, "seats": 6},
    },
}
#: a room narrower than this is furnished compactly whatever its area
COMPACT_SHORT_SIDE = 3000.0
#: a room has to be at least this wide to carry the generous sizes
GENEROUS_SHORT_SIDE = 4200.0

PIECE_LABELS = {
    "sofa": "sofa", "l_sofa": "corner sofa", "loveseat": "loveseat", "chair": "armchair",
    "reading_chair": "reading chair", "coffee_table": "coffee table", "side_table": "side table",
    "tv": "TV", "tv_console": "TV unit", "bookshelf": "bookshelf", "storage_cabinet": "storage cabinet",
    "desk": "desk", "desk_chair": "desk chair", "lamp": "floor lamp", "rug": "rug",
    "dining_set": "dining table",
}

# --------------------------------------------------------------------------- #
# rule 10: accessibility
# --------------------------------------------------------------------------- #
#: clearances raised when an occupant has mobility needs (never lowered)
ACCESSIBLE_CLEARANCES = {
    "door_clearance_min": 1200.0,
    "door_clearance_preferred": 1500.0,
    "seating_circulation_min": 900.0,
}


def size_tier(room: Room, config: Config) -> str:
    """Rule 5: the furniture size class a room of this size carries."""
    short = min(room.width, room.length)
    if room.area_m2 < config.rooms.small_room_area or short < COMPACT_SHORT_SIDE:
        return "compact"
    if room.area_m2 >= config.rooms.large_room_area and short >= GENEROUS_SHORT_SIDE:
        return "generous"
    return "standard"


def catalogue_for(tier: str, overrides: Optional[Dict[str, Dict]] = None) -> FurnitureCatalogue:
    """The catalogue at one size tier; the caller's own overrides win."""
    merged: Dict[str, Dict] = copy.deepcopy(TIER_SIZES.get(tier, {}))
    for name, spec in (overrides or {}).items():
        merged.setdefault(name, {}).update(spec)
    return FurnitureCatalogue(merged)


@dataclass
class Programme:
    """What one living room is furnished for."""

    activities: List[str]
    activities_source: str            # "provided" | "inferred"
    accessible: bool
    accessible_source: str            # "provided" | "default"
    tier: str                         # the size tier in use (may have been stepped down)
    planned_tier: str                 # the tier the floor area called for
    area_m2: float
    required: List[str] = field(default_factory=list)
    optional: List[str] = field(default_factory=list)
    furniture_source: str = "provided"   # "provided" | "programme"
    notes: List[str] = field(default_factory=list)

    def smaller_tier(self) -> Optional[str]:
        index = TIERS.index(self.tier)
        return TIERS[index - 1] if index > 0 else None

    def at_tier(self, tier: str) -> "Programme":
        clone = copy.copy(self)
        clone.tier = tier
        clone.notes = list(self.notes)
        return clone

    def activity_text(self) -> str:
        names = [ACTIVITY_LABELS[a] for a in self.activities]
        return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]

    def summary(self, catalogue: FurnitureCatalogue) -> str:
        """e.g. "standard sizes for 20.0 m2: 2.2 m sofa, 1.2 m coffee table, 1.8 m TV unit"."""
        parts: List[str] = []
        for type_name in self.required:
            if type_name == "tv" or not catalogue.has(type_name):
                continue
            spec = catalogue.spec(type_name)
            label = PIECE_LABELS.get(type_name, type_name.replace("_", " "))
            if type_name == "dining_set":
                parts.append("dining table for {}".format(spec.seats))
            elif type_name in ("desk_chair", "reading_chair", "chair", "lamp"):
                parts.append(label)
            else:
                parts.append("{:.1f} m {}".format(spec.width / 1000.0, label))
        text = "{} sizes for {:.1f} m2: {}".format(self.tier.capitalize(), self.area_m2, ", ".join(parts))
        if self.accessible:
            text += "; planned for mobility needs"
        return text

    def to_dict(self, catalogue: Optional[FurnitureCatalogue] = None) -> Dict:
        data = {
            "activities": list(self.activities),
            "activities_source": self.activities_source,
            "accessible": self.accessible,
            "accessible_source": self.accessible_source,
            "size_tier": self.tier,
            "planned_size_tier": self.planned_tier,
            "required_furniture": list(self.required),
            "optional_furniture": list(self.optional),
            "furniture_source": self.furniture_source,
            "notes": list(self.notes),
        }
        if catalogue is not None:
            data["summary"] = self.summary(catalogue)
        return data


def _unique(values: List[str]) -> List[str]:
    seen, out = set(), []
    for value in values:
        if value not in seen:
            seen.add(value)
            out.append(value)
    return out


def resolve_activities(requirements, room_name: str = "") -> List[str]:
    """Rule 7: the activities to furnish for, when the household did not name them."""
    named = list(requirements.required_furniture) + list(requirements.optional_furniture)
    if named:
        # the caller chose the furniture: read the activities off it
        found = ["conversation"] + [FURNITURE_ACTIVITY[t] for t in named if t in FURNITURE_ACTIVITY]
    else:
        found = list(PURPOSE_ACTIVITIES.get(str(requirements.purpose).strip().lower(), DEFAULT_ACTIVITIES))
        if re.search(r"din(?:ing|e|ner)", room_name or "", re.IGNORECASE):
            found.append("dining")       # a "Living / Dining" room
    return [a for a in ACTIVITIES if a in found]


def apply_programme(scenario) -> Programme:
    """Work out the programme for a scenario and shape the scenario to it."""
    if getattr(scenario, "programme", None) is not None:
        return scenario.programme

    from .io_json import InputError  # local: io_json must stay importable on its own

    requirements = scenario.requirements
    room: Room = scenario.room
    notes: List[str] = []

    # -- rule 7: activities ------------------------------------------------ #
    unknown = [a for a in requirements.activities if a not in ACTIVITIES]
    if unknown:
        raise InputError("unknown activit{}: {}. Known activities: {}".format(
            "y" if len(unknown) == 1 else "ies", ", ".join(unknown), ", ".join(ACTIVITIES)))
    if requirements.activities:
        activities = [a for a in ACTIVITIES if a in requirements.activities]
        activities_source = "provided"
    else:
        activities = resolve_activities(requirements, room.name)
        activities_source = "inferred"

    # -- rule 10: accessibility --------------------------------------------- #
    accessible = bool(requirements.accessible)
    accessible_source = "default" if requirements.accessible is None else "provided"
    if accessible:
        clearances = scenario.config.clearances
        for key, value in ACCESSIBLE_CLEARANCES.items():
            setattr(clearances, key, max(getattr(clearances, key), value))
        notes.append("Mobility needs: {:.0f} mm kept clear inside every door, and a seat is either against "
                     "a wall or has {:.0f} mm behind it".format(
                         clearances.door_clearance_min, clearances.seating_circulation_min))

    # -- rule 5: sizes ------------------------------------------------------- #
    tier = size_tier(room, scenario.config)
    scenario.catalogue = catalogue_for(tier, scenario.furniture_overrides)
    catalogue = scenario.catalogue

    # -- rule 7: the furniture those activities need -------------------------- #
    excluded = set(requirements.excluded_furniture)
    furniture_source = "provided"
    if not requirements.required_furniture:
        furniture_source = "programme"
        required = list(CORE_FURNITURE)
        optional = list(requirements.optional_furniture)
        extras_wanted = not optional
        for activity in activities:
            required += ACTIVITY_FURNITURE[activity]
            if extras_wanted:
                optional += ACTIVITY_EXTRAS[activity]
        if extras_wanted:
            optional += [name for area, name in FURNITURE_BY_AREA_M2 if room.area_m2 >= area]
    else:
        required = list(requirements.required_furniture)
        optional = list(requirements.optional_furniture)
        if activities_source == "provided":
            # the household named an activity the furniture list does not cover
            for activity in activities:
                required += [t for t in ACTIVITY_FURNITURE[activity] if t not in required + optional]

    if accessible and "rug" in optional:
        optional.remove("rug")
        notes.append("No loose rug: an edge to trip on or to catch a wheel")

    required = [t for t in _unique(required) if t not in excluded and catalogue.has(t)]
    optional = [t for t in _unique(optional) if t not in excluded and t not in required and catalogue.has(t)]
    requirements.required_furniture = required
    requirements.optional_furniture = optional
    requirements.activities = list(activities)

    programme = Programme(
        activities=activities, activities_source=activities_source,
        accessible=accessible, accessible_source=accessible_source,
        tier=tier, planned_tier=tier, area_m2=room.area_m2,
        required=required, optional=optional, furniture_source=furniture_source, notes=notes,
    )
    scenario.programme = programme
    return programme
