"""
Rules 5, 7 and 10 - what the living room gets, decided before anything is placed.

* Rule 7: the household's daily activities decide the furniture. Conversation
  is always provided for; a TV, a dining table, a desk and a reading chair come
  with the activity that needs them. When the request names no activities they
  are assumed from the room's name and size, and the result says so.
* Rule 5: the floor area picks one of three furniture size classes. The search
  falls back to a smaller class when the first choice does not fit.
* Rule 10: an occupant with mobility needs gets wider paths and no loose rug.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .config import Config
from .furniture import TIER_ORDER, TIERS
from .room import Room

ACTIVITIES = ("conversation", "tv", "reading", "work", "dining")
#: the activities that need a zone of their own (rule 3)
ZONE_ACTIVITIES = ("dining", "work", "reading")
ALIASES = {
    "talk": "conversation", "talking": "conversation", "entertaining": "conversation", "guests": "conversation",
    "television": "tv", "watching_tv": "tv", "movies": "tv", "entertainment": "tv",
    "read": "reading", "books": "reading",
    "working": "work", "study": "work", "office": "work", "homework": "work",
    "eating": "dining", "meals": "dining", "dine": "dining",
}
DINING_NAME = re.compile(r"din", re.I)
WORK_NAME = re.compile(r"study|office|work", re.I)


@dataclass
class Programme:
    """The furniture list for one living room."""

    activities: List[str]
    activities_source: str              # "provided" | "inferred"
    accessible: bool
    accessible_source: str              # "provided" | "default"
    occupants: Optional[int]
    tier: str                           # the size class wanted for the floor area
    tier_options: List[str]             # in order of preference: `tier`, then every class down
    chairs: int                         # armchairs wanted beside the sofa
    notes: List[str] = field(default_factory=list)

    @property
    def tv(self) -> bool:
        return "tv" in self.activities

    @property
    def zones(self) -> List[str]:
        return [name for name in ZONE_ACTIVITIES if name in self.activities]

    def describe(self) -> str:
        tier = TIERS[self.tier]
        parts = [tier.sofa.label]
        if self.chairs:
            parts.append("{} armchair{}".format(self.chairs, "" if self.chairs == 1 else "s"))
        parts.append(tier.coffee.label)
        if self.tv:
            parts.append(tier.console.label)
        if "dining" in self.activities:
            parts.append(tier.dining.label)
        if "work" in self.activities:
            parts.append("desk")
        if "reading" in self.activities:
            parts.append("reading chair and lamp")
        return "{} sizes for {}: {}".format(self.tier.capitalize(), " + ".join(self.activities), ", ".join(parts))

    def to_dict(self) -> Dict:
        return {
            "activities": list(self.activities),
            "activities_source": self.activities_source,
            "accessible": self.accessible,
            "accessible_source": self.accessible_source,
            "occupants": self.occupants,
            "size_tier": self.tier,
            "armchairs": self.chairs,
            "zones": ["living"] + self.zones,
            "summary": self.describe(),
        }


def _flag(value) -> Optional[bool]:
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


def select_programme(room: Room, config: Config, activities=None, occupants=None, accessible=None) -> Programme:
    """Decide the activities, the furniture size class and the number of seats."""
    t = config.rooms
    notes: List[str] = []
    area = room.area_m2

    chosen: List[str] = []
    if isinstance(activities, str):
        activities = [part for part in re.split(r"[,;/]", activities) if part.strip()]
    for raw in activities or []:
        name = str(raw).strip().lower().replace(" ", "_").replace("-", "_")
        name = ALIASES.get(name, name)
        if name not in ACTIVITIES:
            notes.append("'{}' is not an activity this engine knows ({}); it was left out.".format(
                raw, ", ".join(ACTIVITIES)))
        elif name not in chosen:
            chosen.append(name)
    source = "provided" if chosen else "inferred"
    if not chosen:
        chosen = ["conversation", "tv"]
        if DINING_NAME.search(room.name):
            chosen.append("dining")
        if WORK_NAME.search(room.name):
            chosen.append("work")
        if area >= t.reading_area and len(chosen) == 2:
            chosen.append("reading")
        notes.append("No daily activities were given; {} {} assumed from the room's name and its {:.1f} m2.".format(
            " and ".join(chosen) if len(chosen) < 3 else ", ".join(chosen[:-1]) + " and " + chosen[-1],
            "was" if len(chosen) == 1 else "were", area))
    elif "conversation" not in chosen:
        chosen.insert(0, "conversation")        # rule 1 holds whatever else the room is used for
    chosen.sort(key=ACTIVITIES.index)

    tier = "compact" if area < t.standard_area else "standard" if area < t.generous_area else "generous"
    spec = TIERS[tier]

    people: Optional[int] = None
    try:
        people = int(occupants) if occupants is not None else None
    except (TypeError, ValueError):
        people = None
    if people is not None and people <= 0:
        people = None
    if people is None:
        chairs = spec.max_chairs
    else:
        chairs = min(max(people - spec.sofa.seats, 0), spec.max_chairs)
        most = spec.sofa.seats + spec.max_chairs
        if people > most:
            notes.append("{} occupants were given; the {} furniture for a {:.1f} m2 room seats {}.".format(
                people, tier, area, most))

    need = _flag(accessible)
    return Programme(
        activities=chosen,
        activities_source=source,
        accessible=bool(need),
        accessible_source="default" if need is None else "provided",
        occupants=people,
        tier=tier,
        tier_options=list(TIER_ORDER[TIER_ORDER.index(tier):]),
        chairs=chairs,
        notes=notes,
    )
