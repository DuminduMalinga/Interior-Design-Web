"""
Furniture Layout Generation and Scoring Algorithm
---------------------------------------------------
Matches SDS Section 5.2.3 (Layout Generation Component) and
5.2.4 (Layout Scoring and Optimization Component).

Pipeline:
    Room + StructuralElements + Furniture catalog
        -> generate_layouts()   [rule-based candidate generation]
        -> score_layout()       [weighted scoring]
        -> rank + return top N (default 5, per Objective #3)
"""

from dataclasses import dataclass, field
from itertools import product
import math


# ---------------------------------------------------------------------
# 1. DATA MODEL  (mirrors your ER diagram: Room, StructuralElement,
#    Furniture, Layout, FurnitureLayout)
# ---------------------------------------------------------------------

@dataclass
class Rect:
    x: float
    y: float
    w: float
    h: float
    rotation: int = 0  # 0 or 90 degrees for this simplified engine

    @property
    def footprint(self):
        """Returns (width, height) after rotation."""
        return (self.h, self.w) if self.rotation == 90 else (self.w, self.h)

    def bounds(self):
        w, h = self.footprint
        return (self.x, self.y, self.x + w, self.y + h)

    def overlaps(self, other: "Rect") -> bool:
        ax1, ay1, ax2, ay2 = self.bounds()
        bx1, by1, bx2, by2 = other.bounds()
        return not (ax2 <= bx1 or bx2 <= ax1 or ay2 <= by1 or by2 <= ay1)

    def distance_to(self, other: "Rect") -> float:
        ax1, ay1, ax2, ay2 = self.bounds()
        bx1, by1, bx2, by2 = other.bounds()
        dx = max(bx1 - ax2, ax1 - bx2, 0)
        dy = max(by1 - ay2, ay1 - by2, 0)
        return math.hypot(dx, dy)


@dataclass
class StructuralElement:
    element_type: str      # "door" | "window" | "wall"
    x: float
    y: float
    width: float
    wall: str               # "north" | "south" | "east" | "west"


@dataclass
class Room:
    width: float             # feet
    length: float            # feet
    room_type: str = "Bedroom"   # "Bedroom" | "Living Room" | ... drives catalog choice
    elements: list = field(default_factory=list)  # list[StructuralElement]

    def door_clear_zone(self, depth=3.0) -> list[Rect]:
        """Returns rectangles in front of every door that must stay clear."""
        zones = []
        for el in self.elements:
            if el.element_type != "door":
                continue
            if el.wall in ("north", "south"):
                zones.append(Rect(el.x, 0 if el.wall == "north" else self.length - depth,
                                   el.width, depth))
            else:
                zones.append(Rect(0 if el.wall == "west" else self.width - depth,
                                   el.y, depth, el.width))
        return zones


@dataclass
class FurnitureItem:
    name: str
    category: str            # "bed" | "sofa" | "coffee_table" | "tv_unit" ...
    width: float
    length: float
    required: bool = True     # must appear in every layout
    prefers_wall: bool = True
    # Relative placement: if set, this item is NOT placed against a wall.
    # Instead it's placed facing outward from the named category, at
    # `anchor_offset` feet away (e.g. coffee table anchored to "sofa").
    # IMPORTANT: in the catalog list, an anchored item must come AFTER
    # the item it anchors to, since placement is resolved in order.
    anchor_to: str | None = None
    anchor_offset: float = 1.3


# ---------------------------------------------------------------------
# 2. RULE-BASED CANDIDATE GENERATION
# ---------------------------------------------------------------------

# Anchor points along each wall, expressed as fractions of wall length.
# This is the "rule" part: furniture is proposed at ergonomically sensible
# anchor positions instead of random placement, which keeps the search
# space small and every candidate layout physically plausible.
WALL_ANCHORS = [0.0, 0.25, 0.5, 0.75]


def _wall_position(room: Room, wall: str, item: FurnitureItem, frac: float) -> Rect:
    w, h = item.width, item.length
    if wall == "north":
        return Rect(frac * (room.width - w), 0, w, h, rotation=0)
    if wall == "south":
        return Rect(frac * (room.width - w), room.length - h, w, h, rotation=0)
    if wall == "west":
        return Rect(0, frac * (room.length - h), w, h, rotation=90)
    if wall == "east":
        return Rect(room.width - h, frac * (room.length - w), w, h, rotation=90)
    raise ValueError(wall)


def _is_valid_placement(rect: Rect, room: Room, placed: list[Rect]) -> bool:
    bx1, by1, bx2, by2 = rect.bounds()
    if bx1 < 0 or by1 < 0 or bx2 > room.width or by2 > room.length:
        return False
    if any(rect.overlaps(p) for p in placed):
        return False
    if any(rect.overlaps(z) for z in room.door_clear_zone()):
        return False
    return True


def _relative_position(anchor_rect: Rect, item: FurnitureItem, room: Room) -> Rect | None:
    """
    Places `item` facing outward from `anchor_rect` (e.g. a coffee table
    in front of a sofa), offset by item.anchor_offset feet. Only works
    when the anchor item is itself against a wall, so we know which
    direction is "into the room".
    """
    ax1, ay1, ax2, ay2 = anchor_rect.bounds()
    cx, cy = (ax1 + ax2) / 2, (ay1 + ay2) / 2
    w, h = item.width, item.length

    if ay1 <= 0.1:                      # anchor against north wall -> place below it
        return Rect(cx - w / 2, ay2 + item.anchor_offset, w, h, rotation=0)
    if ay2 >= room.length - 0.1:        # anchor against south wall -> place above it
        return Rect(cx - w / 2, ay1 - item.anchor_offset - h, w, h, rotation=0)
    if ax1 <= 0.1:                      # anchor against west wall -> place to its right
        return Rect(ax2 + item.anchor_offset, cy - h / 2, h, w, rotation=90)
    if ax2 >= room.width - 0.1:         # anchor against east wall -> place to its left
        return Rect(ax1 - item.anchor_offset - w, cy - h / 2, h, w, rotation=90)
    return None  # anchor isn't against a wall — can't tell which way it faces


def _candidate_rects_for_item(room: Room, item: FurnitureItem, limit: int) -> list[Rect]:
    """
    Independently finds valid wall-anchored spots for one item (ignoring
    other furniture — that's checked later at combine time), then evenly
    samples down to `limit` so a required item like a sofa contributes
    real variety without exploding the combination count.
    """
    walls = ["north", "south", "east", "west"]
    found = []
    for wall, frac in product(walls, WALL_ANCHORS):
        rect = _wall_position(room, wall, item, frac)
        bx1, by1, bx2, by2 = rect.bounds()
        if bx1 < 0 or by1 < 0 or bx2 > room.width or by2 > room.length:
            continue
        if any(rect.overlaps(z) for z in room.door_clear_zone()):
            continue
        found.append(rect)

    if len(found) <= limit:
        return found
    step = len(found) / limit
    return [found[int(i * step)] for i in range(limit)]


def generate_layouts(room: Room, catalog: list[FurnitureItem], max_layouts: int = 6):
    """
    Generates multiple candidate layouts. Each item is placed one of two
    ways:
      - wall-anchored (default): sampled at several anchor points along
        the walls, independently per item
      - relative (item.anchor_to is set): placed facing outward from an
        already-placed item of that category (e.g. coffee table -> sofa)

    Strategy: gather a handful of candidate spots per item, then combine
    them and keep only combinations that pass hard constraints (no
    overlap, no door/window blocking, stays in bounds). Sampling per-item
    first (rather than a single deep backtrack) guarantees required
    furniture like a sofa or bed actually appears in different positions
    across the returned layouts, not just filler items.
    Objective #2 in your SDS: "multiple valid room layouts".
    """
    wall_items = [it for it in catalog if not it.anchor_to]
    anchor_items = [it for it in catalog if it.anchor_to]

    per_item_candidates = [
        _candidate_rects_for_item(room, it, limit=4 if it.required else 2)
        for it in wall_items
    ]

    pool_size = max(max_layouts * 5, 25)
    results = []
    seen_signatures = set()

    for combo in product(*per_item_candidates):
        placed, layout, placed_by_category = [], [], {}
        ok = True
        for item, rect in zip(wall_items, combo):
            if any(rect.overlaps(p) for p in placed):
                ok = False
                break
            placed.append(rect)
            placed_by_category[item.category] = rect
            layout.append((item, rect))
        if not ok:
            continue

        for item in anchor_items:
            anchor_rect = placed_by_category.get(item.anchor_to)
            if anchor_rect is None:
                continue  # anchor target not in this combo — skip filler item
            rect = _relative_position(anchor_rect, item, room)
            if rect and _is_valid_placement(rect, room, placed):
                placed.append(rect)
                placed_by_category[item.category] = rect
                layout.append((item, rect))

        sig = tuple((round(r.x * 2), round(r.y * 2)) for _, r in layout)
        if sig in seen_signatures:
            continue
        seen_signatures.add(sig)
        results.append(layout)
        if len(results) >= pool_size:
            break

    return results


# ---------------------------------------------------------------------
# 3. SCORING ALGORITHM  (Objective #3 / Section 5.2.4)
# ---------------------------------------------------------------------

WEIGHTS = {
    "space": 0.35,        # free-floor-area utilization
    "access": 0.35,       # walking clearance around each item
    "ergonomics": 0.30,   # placement quality (near window/wall, bed not blocking door, etc.)
}


def _space_score(room: Room, layout) -> float:
    room_area = room.width * room.length
    used = sum(w * h for _, r in layout for w, h in [r.footprint])
    free_ratio = 1 - (used / room_area)
    # Sweet spot: not empty, not cramped. Best around 55-70% free floor.
    ideal = 0.62
    return max(0.0, 1 - abs(free_ratio - ideal) / ideal)


def _access_score(room: Room, layout) -> float:
    min_clear = 0.75  # feet, minimum comfortable walking clearance
    penalties = 0
    rects = [r for _, r in layout]
    for i, r1 in enumerate(rects):
        for r2 in rects[i + 1:]:
            if r1.distance_to(r2) < min_clear:
                penalties += 1
    return max(0.0, 1 - penalties * 0.15)


def _ergonomics_score(room: Room, layout) -> float:
    score = 1.0
    centers = {}
    for item, rect in layout:
        bx1, by1, bx2, by2 = rect.bounds()
        against_wall = bx1 <= 0.1 or by1 <= 0.1 or bx2 >= room.width - 0.1 or by2 >= room.length - 0.1
        if item.prefers_wall and not against_wall:
            score -= 0.1
        if item.category == "bed":
            # bonus: bed centered on a wall reads as more "balanced"
            wall_len = room.width if by1 <= 0.1 or by2 >= room.length - 0.1 else room.length
            center_offset = abs((bx1 + bx2) / 2 - wall_len / 2) if by1 <= 0.1 or by2 >= room.length - 0.1 \
                else abs((by1 + by2) / 2 - wall_len / 2)
            score -= min(0.15, center_offset / wall_len)
        centers[item.category] = ((bx1 + bx2) / 2, (by1 + by2) / 2)

    # Living-room-specific: TV should be at a comfortable viewing distance
    # from the sofa (roughly 6-12 ft), not jammed right next to it or
    # across a huge room. This is what actually differentiates layouts
    # in a spacious room where every item is already against a wall.
    if "tv_unit" in centers and "sofa" in centers:
        tx, ty = centers["tv_unit"]
        sx, sy = centers["sofa"]
        dist = math.hypot(tx - sx, ty - sy)
        ideal_min, ideal_max = 6.0, 12.0
        if dist < ideal_min:
            score -= min(0.2, (ideal_min - dist) / ideal_min * 0.2)
        elif dist > ideal_max:
            score -= min(0.2, (dist - ideal_max) / ideal_max * 0.2)

    return max(0.0, score)


def score_layout(room: Room, layout) -> dict:
    space = _space_score(room, layout)
    access = _access_score(room, layout)
    ergo = _ergonomics_score(room, layout)
    total = (space * WEIGHTS["space"] + access * WEIGHTS["access"] + ergo * WEIGHTS["ergonomics"]) * 100
    return {
        "total": round(total, 1),
        "breakdown": {
            "space": round(space * 100),
            "access": round(access * 100),
            "ergonomics": round(ergo * 100),
        },
    }


def generate_and_score(room: Room, catalog: list[FurnitureItem], top_n: int = 5):
    """Full pipeline: generate -> score -> rank -> return top N layouts."""
    candidates = generate_layouts(room, catalog, max_layouts=top_n + 3)
    scored = []
    for layout in candidates:
        result = score_layout(room, layout)
        scored.append({
            "layout": [
                {"name": item.name, "x": r.x, "y": r.y,
                 "rotation": r.rotation, "w": r.footprint[0], "h": r.footprint[1]}
                for item, r in layout
            ],
            "score": result["total"],
            "breakdown": result["breakdown"],
        })
    scored.sort(key=lambda s: s["score"], reverse=True)
    return scored[:top_n]


# ---------------------------------------------------------------------
# 4. EXAMPLE USAGE (matches Figure 3.5 style output: 6 scored layouts)
# ---------------------------------------------------------------------

if __name__ == "__main__":
    living_room = Room(
        width=18, length=14, room_type="Living Room",
        elements=[
            StructuralElement("door", x=6, y=0, width=3, wall="north"),
            StructuralElement("window", x=3, y=0, width=5, wall="south"),
        ],
    )

    living_catalog = [
        FurnitureItem("Sofa", "sofa", width=7, length=3),
        FurnitureItem("TV Unit", "tv_unit", width=5, length=1.5),
        # anchor_to="sofa" -> placed facing outward from the sofa, not a wall.
        # Must come AFTER "Sofa" in this list.
        FurnitureItem("Coffee Table", "coffee_table", width=3.5, length=2,
                       required=False, prefers_wall=False, anchor_to="sofa"),
        FurnitureItem("Armchair", "armchair", width=2.5, length=2.5, required=False),
    ]

    results = generate_and_score(living_room, living_catalog, top_n=5)
    print(f"Generated {len(results)} living room layouts:\n")
    for i, r in enumerate(results, 1):
        print(f"Layout {chr(64+i)}  Score: {r['score']}/100  {r['breakdown']}")
        for f in r["layout"]:
            print(f"   - {f['name']}: pos=({f['x']:.1f},{f['y']:.1f}) size=({f['w']}x{f['h']})")
