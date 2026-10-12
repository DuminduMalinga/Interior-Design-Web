"""
Dining-area layout generation.

The search is deterministic - no learning, no randomness - and every step can
be replayed:

    1. rules 4 and 12 fix the number of seats, and with it the table, for the
       occupants or the floor area (`programme.py`);
    2. the table is tried at every position across the floor, lengthways both
       ways; its chairs follow from it. Positions that leave less than 700 mm
       behind a chair or reach into a door's swing are discarded, and the rest
       are scored against the rules that depend on the table alone;
    3. the best positions of every kind - one kind per part of the room and
       direction of the table - are finished: the sideboard is added on the
       wall that serves the table best while leaving every route open (rules 7
       and 11), the pendant is hung (rule 10), and the room is walked twice,
       with the chairs pushed in (rule 3) and with every chair occupied
       (rule 9);
    4. the best layout for each part of the room is returned, best first.

If the room cannot take the first-choice table with every clearance intact,
the search falls back to the next size down (rule 4).
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field, replace
from typing import Dict, List, Optional, Tuple

from .circulation import CirculationReport, Target, analyse, can_walk
from .config import Config
from .floorplan import InputError, Shell, build_shell
from .furniture import CHAIR, PENDANT_SIZE, SIDEBOARDS, TABLES, Item, Layout, TableSpec, Unplaced
from .geometry import Point, Rect, beyond, center, hits_any, intersects
from .programme import Programme, select_programme
from .room import OPPOSITE, WALLS
from .rules import RULE_BY_ID, RULES, SIDES, Evaluator, RuleResult, Walk, metres

AXIS_NAMES = {"ew": "east-west", "ns": "north-south"}
KITCHEN = re.compile(r"kitchen", re.I)


#: the highest total a layout is reported with: however well it does, none is called perfect
TOP_SCORE = 99.0


def reported(score: float) -> float:
    """A total as it is given out: to one decimal, and never the full hundred."""
    return round(min(score, TOP_SCORE), 1)


def find_kitchen(payload: Dict, shell: Shell, limit: float) -> Optional[Tuple[Point, str]]:
    """Rule 8: the point on this room's boundary nearest the kitchen - its door when there is one."""
    room = shell.room
    for door in shell.doors:
        if door.leads_to and KITCHEN.search(door.leads_to):
            return (door.center(room), "door")
    box = (payload.get("room") or {}).get("bbox") or {}
    try:
        left, right = sorted((float(box["x1"]), float(box["x2"])))
        top, bottom = sorted((float(box["y1"]), float(box["y2"])))
    except (KeyError, TypeError, ValueError):
        return None
    scale = shell.scale_mm_per_px
    best = None
    for other in payload.get("rooms") or []:
        if other.get("id") == (payload.get("room") or {}).get("id") or not KITCHEN.search(str(other.get("name", ""))):
            continue
        try:
            ox1, ox2 = sorted((float(other["bbox"]["x1"]), float(other["bbox"]["x2"])))
            oy1, oy2 = sorted((float(other["bbox"]["y1"]), float(other["bbox"]["y2"])))
        except (KeyError, TypeError, ValueError):
            continue
        dx = max(ox1 - right, left - ox2, 0.0)
        dy = max(oy1 - bottom, top - oy2, 0.0)
        gap = (dx * dx + dy * dy) ** 0.5 * scale
        if gap > limit or (best is not None and gap >= best[0]):
            continue
        cx, cy = (ox1 + ox2) / 2.0, (oy1 + oy2) / 2.0
        px, py = min(max(cx, left), right), min(max(cy, top), bottom)
        best = (gap, ((px - left) * scale, (bottom - py) * scale))
    return (best[1], "wall") if best else None


def spread(lo: float, hi: float, step: float) -> List[float]:
    """Positions from `lo` to `hi`: a regular grid, both ends and the middle."""
    if hi < lo - 1.0:
        return []
    hi = max(hi, lo)
    found = {round(lo, 1), round(hi, 1), round((lo + hi) / 2.0, 1)}
    k = 1
    while lo + k * step < hi:
        found.add(round(lo + k * step, 1))
        k += 1
    return sorted(found)


@dataclass
class Result:
    """A finished, scored layout."""

    layout: Layout
    rules: Dict[str, RuleResult]
    score: float
    report: CirculationReport
    violations: List[Dict] = field(default_factory=list)
    type: str = ""
    title: str = ""

    @property
    def valid(self) -> bool:
        return not self.violations


class Generator:
    """Builds, scores and ranks dining layouts for one room."""

    def __init__(self, shell: Shell, programme: Programme, config: Config,
                 kitchen: Optional[Tuple[Point, str]] = None):
        self.shell = shell
        self.room = shell.room
        self.doors = shell.doors
        self.windows = shell.windows
        self.programme = programme
        self.config = config
        self.c = config.clearances
        self.s = config.search
        self.ev = Evaluator(self.room, self.doors, self.windows, programme, config, kitchen)
        door = self.ev.main_door
        self.entry_zone = door.keep_clear(self.room, self.c.door_entry_depth) if door else None
        self.entry_point = door.center(self.room) if door else None
        self.stats = {"table_positions": 0, "positions_tried": 0, "layouts_scored": 0, "paths_walked": 0}
        self.elapsed = 0.0

    # ------------------------------------------------------------------ #
    def run(self) -> List[Result]:
        started = time.perf_counter()
        chosen: List[Result] = []
        for seats in self.programme.seat_options:
            results = self._search(TABLES[seats])
            if any(r.valid for r in results):
                chosen = [r for r in results if r.valid]
                break
            if results and not chosen:
                chosen = results
        selected = self._select(chosen)
        self.elapsed = time.perf_counter() - started
        return selected

    # ------------------------------------------------------------------ #
    # the table and its chairs (rules 2, 4, 5 and 6)
    # ------------------------------------------------------------------ #
    def _region(self, rect: Rect) -> str:
        cx, cy = center(rect)
        third = lambda value, size, names: names[0] if value < size / 3.0 else names[2] if value > 2 * size / 3.0 \
            else names[1]
        row = third(cy, self.room.length, ("south", "", "north"))
        col = third(cx, self.room.width, ("west", "", "east"))
        return "-".join(part for part in (row, col) if part) or "centre"

    def _chairs(self, spec: TableSpec, rect: Rect, sides: Tuple[str, ...],
                long_sides: Tuple[str, str]) -> Tuple[Item, ...]:
        """One pushed-in chair per seat along every side that has them."""
        c = self.c
        chairs: List[Item] = []
        for side in sides:
            along_x = side in ("north", "south")
            lo, hi = (rect[0], rect[2]) if along_x else (rect[1], rect[3])
            count = spec.per_side if side in long_sides else spec.ends
            for index in range(count):
                mid = lo + (hi - lo) * (index + 0.5) / count
                seat = (mid - CHAIR.width / 2.0, rect[1], mid + CHAIR.width / 2.0, rect[3]) if along_x \
                    else (rect[0], mid - CHAIR.width / 2.0, rect[2], mid + CHAIR.width / 2.0)
                chairs.append(Item(
                    "dining_chair_{}".format(len(chairs) + 1), "dining_chair", CHAIR.model,
                    beyond(seat, side, c.chair_tuck), side, OPPOSITE[side],
                    CHAIR.width, CHAIR.depth, CHAIR.height, "at:table", label=CHAIR.label))
        return tuple(chairs)

    def _tables(self, spec: TableSpec) -> List[Layout]:
        """Every legal table position, each with its chairs and its score as far as the table decides it."""
        room, c = self.room, self.c
        found: List[Layout] = []
        for axis in ("ew", "ns"):
            lx, ly = (spec.length, spec.width) if axis == "ew" else (spec.width, spec.length)
            long_sides = ("north", "south") if axis == "ew" else ("east", "west")
            end_sides = ("east", "west") if axis == "ew" else ("north", "south")
            sides = tuple(side for side in SIDES if side in long_sides or (spec.ends and side in end_sides))

            def starts(size: float, room_size: float, low_side: str, high_side: str) -> List[float]:
                top = room_size - size
                if low_side in sides:              # chairs at both of these edges
                    return spread(c.chair_pull_min, top - c.chair_pull_min, self.s.step)
                # no chairs here: the table end is against the wall, or far enough off it to walk past
                flush = [0.0, round(top, 1)] if top >= 0 else []
                return sorted(set(flush + spread(c.end_gap_min, top - c.end_gap_min, self.s.step)))

            xs = starts(lx, room.width, "west", "east")
            ys = starts(ly, room.length, "south", "north")
            for x0 in xs:
                for y0 in ys:
                    self.stats["table_positions"] += 1
                    rect = (x0, y0, x0 + lx, y0 + ly)
                    table = Item("dining_table_1", "dining_table", "{}-seat".format(spec.seats), rect,
                                 long_sides[1], long_sides[0], lx, ly, spec.height, "floor:free", label=spec.label)
                    lay = Layout(spec=spec, table=table, axis=axis, chair_sides=sides, chairs=(),
                                 region=self._region(rect))
                    if hits_any(self.ev.envelope(lay, c.chair_pull_min), self.ev.door_zones):
                        continue               # rule 6: never in a door's swing, chairs pulled out included
                    lay = replace(lay, chairs=self._chairs(spec, rect, sides, long_sides))
                    found.append(replace(lay, base_score=self._ceiling(lay)))
        return found

    def _ceiling(self, lay: Layout) -> float:
        """The best total a layout could still reach if everything decided later came out perfect."""
        self.stats["layouts_scored"] += 1
        results = self.ev.static(lay)
        results["R3"] = RuleResult(RULE_BY_ID["R3"], 1.0, self.ev.weights["R3"])
        if self.programme.sideboard:           # assume the sideboard will be placed, and placed well
            results["R7"] = RuleResult(RULE_BY_ID["R7"], 1.0, self.ev.weights["R7"])
            results["R11"] = RuleResult(RULE_BY_ID["R11"], 1.0, self.ev.weights["R11"])
        return self.ev.total(results)

    # ------------------------------------------------------------------ #
    # the sideboard (rules 7 and 11)
    # ------------------------------------------------------------------ #
    def _with_sideboard(self, lay: Layout) -> Layout:
        """Add the sideboard where it serves the table best and leaves every route open, or report it left out."""
        room, c, ev = self.room, self.c, self.ev
        table = lay.table.rect
        tried = False
        for spec in SIDEBOARDS:
            blocked = [band for window, band in ev.window_bands if spec.height > window.sill_height]
            options = []
            for wall in WALLS:
                wall_length = room.wall_length(wall)
                top = wall_length - spec.width
                if top < -1.0:
                    continue
                snaps = [0.0, max(top, 0.0), max(top, 0.0) / 2.0]
                for zone in ev.door_zones + blocked:
                    if room.out_from(wall, zone)[0] < spec.depth - 1.0:
                        lo, hi = room.along(wall, zone)
                        snaps += [hi, lo - spec.width]
                t_lo, t_hi = room.along(wall, table)
                snaps.append((t_lo + t_hi - spec.width) / 2.0)     # centred on the table
                starts = set(spread(0.0, top, 2 * self.s.step))
                starts.update(round(min(max(s, 0.0), max(top, 0.0)), 1) for s in snaps if -1.0 <= s <= top + 1.0)
                for t in sorted(starts):
                    self.stats["positions_tried"] += 1
                    rect = room.band(wall, t, t + spec.width, spec.depth)
                    if intersects(rect, table) or hits_any(rect, ev.door_zones) or hits_any(rect, blocked):
                        continue
                    board = Item("sideboard_1", "sideboard", spec.model, rect, wall, OPPOSITE[wall],
                                 spec.width, spec.depth, spec.height, "wall:{}".format(wall), label=spec.label)
                    option = replace(lay, sideboard=board,
                                     sideboard_front=room.band(wall, t, t + spec.width, 500.0, offset=spec.depth))
                    gap, least = ev.sideboard_gap(option)
                    if gap < least - 1.0:
                        continue               # rule 7
                    tried = True
                    options.append((-round(ev.total(ev.static(option)), 3), round(gap), wall, t, option))
            options.sort(key=lambda entry: entry[:4])
            for entry in options[:10]:
                if self._passable(entry[4]):
                    return entry[4]
        reason = ("Every free position would block the way round the table." if tried
                  else "No wall has room for it clear of the table, the chairs and the doors.")
        return replace(lay, unplaced=lay.unplaced + (Unplaced("sideboard", SIDEBOARDS[-1].label, False, (reason,)),))

    # ------------------------------------------------------------------ #
    # walking the room (rules 1, 3 and 9)
    # ------------------------------------------------------------------ #
    def _targets(self, lay: Layout) -> List[Target]:
        """Chairs pushed in: every side with chairs, the sideboard and any other door must be reachable."""
        out = [Target(name, zone) for name, zone in self.ev.seat_zones(lay)]
        out += self._through(lay)
        return out

    def _through(self, lay: Layout) -> List[Target]:
        """The places the main route leads to: the sideboard and the other doors."""
        out = [Target("the sideboard", lay.sideboard_front)] if lay.sideboard is not None else []
        out += [Target("door {}".format(d.id), d.keep_clear(self.room, self.c.door_entry_depth))
                for d in self.doors if not d.is_main]
        return out

    def _passable(self, lay: Layout) -> bool:
        if self.entry_zone is None:
            return True
        self.stats["paths_walked"] += 1
        return can_walk(self.room.rect, self.entry_zone, self.entry_point, [i.rect for i in lay.solids],
                        self._targets(lay), self.c.path_min)

    def _walk(self, lay: Layout) -> Tuple[CirculationReport, Walk]:
        c, ev, bounds = self.c, self.ev, self.room.rect
        walk = Walk()
        if self.entry_zone is None:
            return CirculationReport(valid=True, checked=False), walk
        self.stats["paths_walked"] += 1
        targets = self._targets(lay)
        targets += [Target("window {}".format(w.id), band, essential=False) for w, band in ev.window_bands]
        report = analyse(bounds, self.entry_zone, self.entry_point, [i.rect for i in lay.solids], targets,
                         c.path_widths)
        through = self._through(lay)
        walk.route_targets = len(through)
        if report.valid and through:           # rule 9: the same walk with a person on every chair
            self.stats["paths_walked"] += 1
            seated = [ev.envelope(lay, c.chair_occupied)]
            seated += [lay.sideboard.rect] if lay.sideboard is not None else []
            walk.occupied_ok = can_walk(bounds, self.entry_zone, self.entry_point, seated, through, c.route_width)
        return report, walk

    def _lights(self, lay: Layout) -> Tuple[Item, ...]:
        """Rule 10: a pendant centred over the table - two over a long one."""
        c, spec = self.c, lay.spec
        x0, y0, x1, y1 = lay.table.rect
        count = 2 if spec.length >= c.two_pendants_from else 1
        half = PENDANT_SIZE / 2.0
        lights = []
        for index in range(count):
            share = (index + 0.5) / count
            cx, cy = (x0 + (x1 - x0) * share, (y0 + y1) / 2.0) if lay.axis == "ew" \
                else ((x0 + x1) / 2.0, y0 + (y1 - y0) * share)
            lights.append(Item(
                "pendant_light_{}".format(index + 1), "pendant_light", "pendant",
                (cx - half, cy - half, cx + half, cy + half), lay.table.wall, lay.table.facing,
                PENDANT_SIZE, PENDANT_SIZE, 0.0, "over:table", mounted="ceiling",
                mount_height=c.table_height + c.pendant_drop, label="pendant light"))
        return tuple(lights)

    def _finish(self, lay: Layout) -> Optional[Result]:
        ev = self.ev
        if self.programme.sideboard:
            lay = self._with_sideboard(lay)
        lay = replace(lay, lights=self._lights(lay))
        report, walk = self._walk(lay)
        if report.checked and not report.valid:
            return None                # rule 3: a table nobody can get round is no layout
        rules = ev.static(lay, explain=True, walk=walk)
        rules["R3"] = ev.path_result(lay, report)
        ordered = {rule.id: rules[rule.id] for rule in RULES}
        return Result(lay, ordered, ev.total(ordered), report, ev.violations(lay, report))

    def _search(self, spec: TableSpec) -> List[Result]:
        """The best finished layout for every (part of the room, direction of the table)."""
        variants: Dict[Tuple[str, str], List[Layout]] = {}
        for lay in self._tables(spec):
            variants.setdefault((lay.region, lay.axis), []).append(lay)

        results: List[Result] = []
        for key in sorted(variants):
            ranked = sorted(enumerate(variants[key]), key=lambda entry: (-entry[1].base_score, entry[0]))
            best: Optional[Result] = None
            for _, lay in ranked[: self.s.finalists]:
                if best is not None and lay.base_score <= best.score + 1e-9:
                    break              # nothing left in this variant can beat what is already scored
                result = self._finish(lay)
                if result is not None and (best is None or (result.valid, result.score) > (best.valid, best.score)):
                    best = result
            if best is not None:
                results.append(best)
        return results

    # ------------------------------------------------------------------ #
    # choosing and naming the alternatives
    # ------------------------------------------------------------------ #
    def _select(self, results: List[Result]) -> List[Result]:
        order = lambda r: (not r.valid, -r.score, r.layout.region, r.layout.axis)
        primary: Dict[str, Result] = {}
        for result in sorted(results, key=order):
            primary.setdefault(result.layout.region, result)
        chosen = sorted(primary.values(), key=order)[: self.s.max_layouts]
        for result in sorted(results, key=order):     # the table turned the other way fills the slots left over
            if len(chosen) >= self.s.max_layouts:
                break
            if not any(result is c for c in chosen):
                chosen.append(result)
        chosen.sort(key=order)

        for result in chosen:
            lay = result.layout
            region = lay.region
            result.type = "table_{}_{}".format(region.replace("-", "_"), lay.axis)
            if region == "centre":
                result.title = "Table in the centre of the room"
            elif "-" in region:
                result.title = "Table towards the {} corner".format(region)
            else:
                result.title = "Table on the {} side".format(region)
            if result is not primary[region]:
                result.title += ", running {}".format(AXIS_NAMES[lay.axis])
        return chosen

    # ------------------------------------------------------------------ #
    # serialisation - the shape the plan viewer already draws
    # ------------------------------------------------------------------ #
    def summary(self, lay: Layout) -> str:
        where = "in the centre of the room" if lay.region == "centre" else \
            "towards the {} corner".format(lay.region) if "-" in lay.region else "on the {} side".format(lay.region)
        text = "{} {}".format(lay.spec.label, where)
        if lay.spec.length != lay.spec.width:
            text += ", running {}".format(AXIS_NAMES[lay.axis])
        text += ", with {} chairs".format(len(lay.chairs))
        if lay.sideboard is not None:
            text += "; {} on the {} wall".format(lay.sideboard.label, lay.sideboard.wall)
        return text[0].upper() + text[1:] + "."

    def _item_reasons(self, result: Result, item: Item) -> List[str]:
        rules = result.rules
        cite = lambda *ids: [
            "Rule {}: {}".format(rule_id[1:], rules[rule_id].detail)
            for rule_id in ids if rules[rule_id].applicable and rules[rule_id].detail
        ]
        size = "{} x {}".format(metres(item.width), metres(item.depth))
        if item.type == "dining_table":
            return ["{} ({}).".format(item.label.capitalize(), size)] + cite("R1", "R4", "R6", "R8", "R9")
        if item.type == "dining_chair":
            return ["Dining chair on the {} side of the table, drawn pushed in.".format(item.wall)] + cite("R2", "R5")
        if item.type == "sideboard":
            return ["{} ({}) against the {} wall.".format(item.label.capitalize(), size, item.wall)] \
                + cite("R7", "R11")
        return ["Pendant light, {} above the floor.".format(metres(item.mount_height))] + cite("R10")

    def to_dict(self, result: Result, ranking: List[Dict]) -> Dict:
        lay, room, c, report = result.layout, self.room, self.c, result.report
        rules = list(result.rules.values())
        applicable = sum(r.weight for r in rules if r.applicable) or 1.0
        scale = 100.0 / applicable           # so the per-rule points add up to the 0-100 total
        # ... and the points earned still add up to the total once it has been held to the top score
        earned = scale * min(1.0, TOP_SCORE / result.score) if result.score > 0 else scale
        checks = {v["check"] for v in result.violations}

        explanation = ["Furniture (rules 4 and 12): {}, {} chairs{}.".format(
            lay.spec.label, len(lay.chairs), ", sideboard" if lay.sideboard is not None else "")]
        explanation += [
            "Rule {} - {}: {} [{}]".format(
                r.rule.id[1:], r.rule.title, r.detail,
                "not applicable" if not r.applicable else "{:.1f} of {:.1f} points".format(
                    r.points * earned, r.weight * scale))
            for r in rules
        ]
        explanation += list(lay.compromises)
        explanation += ["Not placed - {}: {}".format(u.label, " ".join(u.reasons)) for u in lay.unplaced]

        lead = ("R2", "R3")
        reason = [self.summary(lay)]
        reason += [result.rules[rule_id].detail for rule_id in lead if result.rules[rule_id].applicable]
        weakest = min((r for r in rules if r.applicable and r.rule.id not in lead),
                      key=lambda r: r.score, default=None)
        if weakest is not None and weakest.score < 0.7:
            reason.append("Trade-off - {}: {}".format(weakest.rule.title.lower(), weakest.detail))

        furniture = []
        for item in lay.items:
            entry = item.to_dict()
            entry["reasons"] = self._item_reasons(result, item)
            furniture.append(entry)

        clear = self.ev.clearances(lay)
        return {
            "room": room.to_dict(),
            "layout": {
                "type": result.type,
                "title": result.title,
                "score": reported(result.score),
                "suitability_score": reported(lay.base_score),
            },
            "furniture": furniture,
            "validation": {
                "valid": result.valid,
                "inside_room_boundary": "boundary" not in checks,
                "furniture_overlap": "overlap" in checks,
                "door_blocked": "door" in checks,
                "door_swing_blocked": "door" in checks,
                "window_blocked": "window" in checks,
                "circulation_valid": report.valid,
                "circulation": report.to_dict() if report.checked else None,
                "hard_constraint_violations": result.violations,
                "notes": [v["message"] for v in result.violations] + list(lay.compromises),
                "unplaced_required_furniture": [u.to_dict() for u in lay.unplaced if u.required],
            },
            "explanation": explanation,
            "selected_layout": result.type,
            "reason": reason,
            "unplaced_furniture": [u.to_dict() for u in lay.unplaced],
            "scoring": {
                "total": reported(result.score),
                "max": 100,
                "components": {r.rule.key: round(r.points * earned, 1) for r in rules if r.applicable},
                "contributions": [
                    {"rule": r.rule.key, "points": round(r.points * earned, 2), "message": r.detail}
                    for r in rules if r.applicable
                ],
            },
            "rules": [
                {
                    "id": r.rule.id,
                    "key": r.rule.key,
                    "title": r.rule.title,
                    "rule": r.rule.text,
                    "status": r.status,
                    "score": round(r.score, 3),
                    "points": round(r.points * earned, 1),
                    "max_points": round(r.weight * scale, 1) if r.applicable else 0.0,
                    "detail": r.detail,
                }
                for r in rules
            ],
            "layout_selection": {"ranking": ranking},
            "openings": {
                "doors": [d.to_dict(room, c.door_entry_depth) for d in self.doors],
                "windows": [w.to_dict(room, c.window_access_depth) for w in self.windows],
            },
            "table": {
                "seats": lay.spec.seats,
                "axis": lay.axis,
                "region": lay.region,
                "clearance_mm": {side: round(clear[side], 1) for side in SIDES},
                "chair_sides": list(lay.chair_sides),
            },
            "lighting": {
                "pendants": len(lay.lights),
                "height_above_floor_mm": c.table_height + c.pendant_drop,
                "height_above_table_mm": c.pendant_drop,
            },
            "kitchen": ({"point": [round(v, 1) for v in self.ev.kitchen[0]], "via": self.ev.kitchen[1]}
                        if self.ev.kitchen else None),
            "programme": self.programme.to_dict(),
        }


def rule_catalogue() -> List[Dict]:
    """The twelve rules as written, and how the engine applies each one."""
    weights = Config().weights
    return [
        {"id": rule.id, "key": rule.key, "title": rule.title, "rule": rule.text, "method": rule.method,
         "weight": getattr(weights, rule.key)}
        for rule in RULES
    ]


def generate_dining_layouts(
    payload: Dict,
    default_mm_per_px: float = 20.0,
    margin_ratio: float = 0.08,
    margin_min: float = 10.0,
    margin_max: float = 60.0,
) -> Dict:
    """Request (room box + plan detections, in pixels) -> every dining layout, best first.

    Raises `floorplan.InputError` when the request cannot be made sense of.
    """
    if not isinstance(payload, dict):
        raise InputError("the request must be a JSON object")
    config = Config.from_dict(payload.get("config"))
    if payload.get("max_layouts"):
        config.search.max_layouts = max(1, int(payload["max_layouts"]))
    shell = build_shell(payload, default_mm_per_px, margin_ratio, margin_min, margin_max)
    programme = select_programme(
        shell.room, config,
        seats=payload.get("seats"),
        occupants=payload.get("occupants"),
        sideboard=payload.get("sideboard"),
        use=payload.get("use"),
    )
    kitchen = find_kitchen(payload, shell, config.clearances.kitchen_adjacent)
    generator = Generator(shell, programme, config, kitchen)
    results = generator.run()

    notes = shell.notes + programme.notes
    if results and results[0].layout.spec.seats < programme.seats:
        notes.append("A table for {} does not fit this room with {} behind every chair; a table for {} was "
                     "used instead.".format(programme.seats, metres(config.clearances.chair_pull_min),
                                            results[0].layout.spec.seats))

    ranking = [
        {"layout": r.type, "title": r.title, "score": reported(r.score), "feasible": r.valid,
         "reasons": [generator.summary(r.layout)]}
        for r in results
    ]
    layouts = [generator.to_dict(r, ranking) for r in results]
    if not layouts:
        layouts = [{
            "layout": {"type": "dining", "title": "Dining layout", "score": 0, "suitability_score": 0},
            "error": "The room ({} x {}) is too small for a table for two with {} behind each chair and the "
                     "doors left clear.".format(metres(shell.room.width), metres(shell.room.length),
                                                metres(config.clearances.chair_pull_min)),
        }]

    return {
        "roomId": (payload.get("room") or {}).get("id"),
        "roomType": "dining",
        "scaleSource": shell.scale_source,
        "scaleMmPerPx": round(shell.scale_mm_per_px, 3),
        "doorsUsed": shell.doors_used,
        "windowsUsed": shell.windows_used,
        "notes": notes,
        "seats": programme.seats,
        "seatsSource": programme.seats_source,
        "programme": programme.to_dict(),
        "layouts": layouts,
        "bestLayout": results[0].type if results else None,
        "search": dict(generator.stats, elapsed_seconds=round(generator.elapsed, 3)),
    }
