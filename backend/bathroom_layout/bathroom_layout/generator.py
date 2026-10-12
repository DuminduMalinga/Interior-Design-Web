"""
Bathroom layout generation.

The search is deterministic - no learning, no randomness - and every step can
be replayed:

    1. the fixture sizes are fixed for the floor area and the user's mobility
       needs (`programme.py`);
    2. the shower is tried in every corner, turned both ways, with its way in
       on every open side (rule 3);
    3. for each shower the toilet is tried at every position along every wall;
       positions that break a hard limit are discarded and the best on each
       wall are kept (rule 2);
    4. for each of those the basin is tried at every position along every wall
       and the best on each wall are kept (rules 1, 5 and 9);
    5. the most promising arrangements of every kind - one kind per (shower
       corner, toilet wall, basin wall) - are finished: the storage cabinet is
       added where it leaves every route open (rules 6 and 7), the mirror,
       towels, drain and grab bars are fixed (rules 8-10, 14, 15), the room is
       walked (rules 4, 7, 11, 13) and the layout is scored against all fifteen
       rules;
    6. the best layout for each shower corner is returned, best first, with
       other toilet and basin walls filling any slots left over.

If the room cannot take the first-choice fixtures with every clearance intact,
the search falls back to the next size down. When wheelchair access is asked
for and the room cannot give it, the best layout without it is returned and
reported as compromised, never passed off as valid.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field, replace
from typing import Dict, Iterable, List, Optional, Tuple

from .circulation import CirculationReport, Target, analyse, can_walk, open_square
from .config import Config
from .fitout import fit_out
from .fixtures import BASINS, CABINET, SHOWERS, TOILETS, Item, Layout, Level, Unplaced
from .floorplan import Shell, build_shell
from .geometry import Rect, beyond, contains, distance, hits_any, point_gap
from .programme import Programme, select_programme
from .room import OPPOSITE, WALLS
from .rules import RULE_BY_ID, RULES, Evaluator, RuleResult, Walk, metres

#: two positions of one fixture on one wall closer than this are the same alternative
SPACING = 300.0
SHORT = {"north-west": "nw", "north-east": "ne", "south-west": "sw", "south-east": "se"}


#: the highest total a layout is reported with: however well it does, none is called perfect
TOP_SCORE = 99.0


def reported(score: float) -> float:
    """A total as it is given out: to one decimal, and never the full hundred."""
    return round(min(score, TOP_SCORE), 1)


def positions(length: float, size: float, step: float, snaps: Iterable[float] = ()) -> List[float]:
    """Start positions for a piece `size` long on a wall `length` long.

    A regular grid, both ends, and the snap points - the places that put the
    piece flush against a neighbour or centre it, which a grid alone would miss.
    """
    top = length - size
    if top < -1.0:
        return []
    top = max(top, 0.0)
    found = {0.0, round(top, 1)}
    k = 1
    while k * step < top:
        found.add(float(k * step))
        k += 1
    for snap in snaps:
        if -1.0 <= snap <= top + 1.0:
            found.add(round(min(max(snap, 0.0), top), 1))
    return sorted(found)


@dataclass
class Result:
    """A finished, scored layout."""

    layout: Layout
    rules: Dict[str, RuleResult]
    score: float
    report: CirculationReport
    walk: Walk
    violations: List[Dict] = field(default_factory=list)
    type: str = ""
    title: str = ""

    @property
    def valid(self) -> bool:
        return not self.violations


class Generator:
    """Builds, scores and ranks bathroom layouts for one room."""

    def __init__(self, shell: Shell, programme: Programme, config: Config):
        self.shell = shell
        self.room = shell.room
        self.doors = shell.doors
        self.windows = shell.windows
        self.programme = programme
        self.config = config
        self.c = config.clearances
        self.a = config.access
        self.s = config.search
        self.ev = Evaluator(self.room, self.doors, self.windows, programme, config)
        door = self.ev.main_door
        self.entry_zone = door.keep_clear(self.room, self.c.door_entry_depth) if door else None
        self.entry_point = door.center(self.room) if door else None
        self.stats = {"shower_positions": 0, "positions_tried": 0, "layouts_scored": 0, "paths_walked": 0}
        self.elapsed = 0.0
        self.level_used: Optional[Level] = None
        self.door_note = ""            # set when the layouts depend on a door being rehung

    # ------------------------------------------------------------------ #
    def run(self) -> List[Result]:
        started = time.perf_counter()
        programme = self.programme
        attempts = [
            (level, strict, with_shower)
            for with_shower in ((True, False) if programme.shower else (False,))
            for strict in ((True, False) if programme.accessible else (False,))
            for level in programme.levels
        ]
        chosen: List[Result] = []
        for level, strict, with_shower in attempts:
            results = self._search(level, strict, with_shower)
            if not results:
                continue
            if any(r.valid for r in results):
                chosen = [r for r in results if r.valid]
                self.level_used = level
                break
            if not chosen:                 # nothing valid yet: remember the first compromise found
                chosen, self.level_used = results, level
        selected = self._select(chosen)
        self.elapsed = time.perf_counter() - started
        return selected

    # ------------------------------------------------------------------ #
    # the shower (rule 3)
    # ------------------------------------------------------------------ #
    def _showers(self, level: Level) -> List[Layout]:
        """The shower in every corner, both ways round, with its way in on every open side."""
        spec, room, c, t = SHOWERS[level.shower], self.room, self.c, self.config.rooms
        width, length = room.width, room.length
        opening = self.a.shower_opening if self.programme.accessible else c.shower_opening
        seen = set()
        found: List[Layout] = []
        for sx, sy in sorted({(spec.width, spec.depth), (spec.depth, spec.width)}):
            if 1.0 < width - sx < t.alcove_stretch:
                sx = width                 # nearly wall to wall: made to fit, as an alcove
            if 1.0 < length - sy < t.alcove_stretch:
                sy = length
            if sx > width + 1.0 or sy > length + 1.0:
                continue
            sx, sy = min(sx, width), min(sy, length)
            for ns in ("north", "south"):
                for we in ("west", "east"):
                    x0 = 0.0 if we == "west" else width - sx
                    y0 = 0.0 if ns == "south" else length - sy
                    rect = (x0, y0, x0 + sx, y0 + sy)
                    self.stats["shower_positions"] += 1
                    if hits_any(rect, self.ev.door_zones):
                        continue
                    open_sides = [side for side, is_open in (
                        ("east", rect[2] < width - 1.0), ("west", rect[0] > 1.0),
                        ("north", rect[3] < length - 1.0), ("south", rect[1] > 1.0)) if is_open]
                    for side in open_sides:
                        lo, hi = (rect[1], rect[3]) if side in ("east", "west") else (rect[0], rect[2])
                        gap = min(opening, hi - lo)
                        spans = [(lo, lo + gap)] + ([(hi - gap, hi)] if hi - lo - gap > 150.0 else [])
                        for span in spans:
                            key = (rect, side, span)
                            if key in seen:
                                continue
                            seen.add(key)
                            wall = OPPOSITE[side]
                            item = Item("shower_1", "shower", spec.model, rect, wall, side,
                                        sx if wall in ("north", "south") else sy,
                                        sy if wall in ("north", "south") else sx, spec.height,
                                        "corner:{}-{}".format(ns, we), label=spec.label)
                            partial = Layout(
                                level=level, toilet=None, toilet_zone=None, toilet_stand=None,
                                shower=item, corner="{}-{}".format(ns, we), shower_walls=4 - len(open_sides),
                                entry_side=side, entry_span=span)
                            exit_zone = beyond(self.ev.opening(partial), side, c.shower_exit_min)
                            if contains(room.rect, exit_zone):
                                found.append(replace(partial, shower_exit=exit_zone))
        return found

    # ------------------------------------------------------------------ #
    # the toilet (rule 2)
    # ------------------------------------------------------------------ #
    def _toilets(self, level: Level, strict: bool, base: Layout) -> List[Layout]:
        """The best toilet positions on every wall around one shower position."""
        spec, room, c = TOILETS[level.toilet], self.room, self.c
        half = max(spec.width / 2.0, c.toilet_side_min)
        front = self.a.toilet_front if strict else c.toilet_front_min
        reach = spec.depth + front
        extents = [("", half, half)]
        if strict:                         # rule 13: one side of the pan is kept clear to transfer from a chair
            wide = spec.width / 2.0 + self.a.transfer_width
            extents = [("lo", wide, half), ("hi", half, wide)]
        fixed = [f.rect for f in base.fixtures]
        keep = [base.shower_exit] if base.shower_exit is not None else []
        blockers = fixed + keep + self.ev.door_zones
        door = self.entry_point

        chosen: List[Layout] = []
        for wall in WALLS:
            wall_length = room.wall_length(wall)
            if reach > room.depth_from(wall) + 1.0:
                continue
            scored = []
            for transfer, low, high in extents:
                span = low + high
                snaps = [c.toilet_side_preferred - low, wall_length - c.toilet_side_preferred - low]
                for blocker in blockers:
                    if room.out_from(wall, blocker)[0] < reach - 1.0:
                        b_lo, b_hi = room.along(wall, blocker)
                        snaps += [b_hi, b_lo - span]
                for t in positions(wall_length, span, self.s.step, snaps):
                    self.stats["positions_tried"] += 1
                    mid = t + low
                    rect = room.band(wall, mid - spec.width / 2.0, mid + spec.width / 2.0, spec.depth)
                    if hits_any(rect, self.ev.door_zones) or hits_any(rect, fixed) or hits_any(rect, keep):
                        continue
                    zone = room.band(wall, t, t + span, reach)
                    if hits_any(zone, fixed):
                        continue
                    item = Item("toilet_1", "toilet", spec.model, rect, wall, OPPOSITE[wall],
                                spec.width, spec.depth, spec.height, "wall:{}".format(wall), label=spec.label)
                    lay = replace(base, toilet=item, toilet_zone=zone, transfer=transfer,
                                  toilet_stand=room.band(wall, t, t + span, front, offset=spec.depth))
                    mark = self.ev._toilet_space(lay, False).score
                    away = point_gap(door, rect) if door else 0.0
                    scored.append((-round(mark, 3), -round(away), mid, lay))
            scored.sort(key=lambda entry: entry[:3])
            picked: List[float] = []
            for _, _, mid, lay in scored:
                if len(picked) >= self.s.toilets_per_wall:
                    break
                if all(abs(mid - p) >= SPACING for p in picked):
                    picked.append(mid)
                    chosen.append(lay)
        return chosen

    # ------------------------------------------------------------------ #
    # the basin (rules 1, 5 and 9)
    # ------------------------------------------------------------------ #
    def _basins(self, level: Level, strict: bool, base: Layout) -> List[Layout]:
        """The best basin positions on every wall around one shower and toilet position."""
        spec, room, c, ev = BASINS[level.basin], self.room, self.c, self.ev
        span = max(spec.width, c.basin_zone_width)
        front = self.a.basin_front if strict else c.basin_front_min
        reach = spec.depth + front
        fixed = [f.rect for f in base.fixtures]
        keep = [zone for _, zone in base.zones]
        blockers = fixed + keep + ev.door_zones

        chosen: List[Layout] = []
        for wall in WALLS:
            wall_length = room.wall_length(wall)
            if reach > room.depth_from(wall) + 1.0:
                continue
            snaps = [(wall_length - span) / 2.0]
            for blocker in blockers:
                if room.out_from(wall, blocker)[0] < reach - 1.0:
                    b_lo, b_hi = room.along(wall, blocker)
                    snaps += [b_hi, b_lo - span]
            for window in self.windows:        # rule 9: just clear of a window, so the mirror can go above
                if window.wall == wall:
                    snaps += [window.end - (span - spec.width) / 2.0,
                              window.start - span + (span - spec.width) / 2.0]
            scored = []
            for t in positions(wall_length, span, self.s.basin_step, snaps):
                self.stats["positions_tried"] += 1
                mid = t + span / 2.0
                rect = room.band(wall, mid - spec.width / 2.0, mid + spec.width / 2.0, spec.depth)
                if hits_any(rect, ev.door_zones) or hits_any(rect, fixed) or hits_any(rect, keep):
                    continue
                zone = room.band(wall, t, t + span, reach)
                if hits_any(zone, fixed):
                    continue
                item = Item("washbasin_1", "washbasin", spec.model, rect, wall, OPPOSITE[wall],
                            spec.width, spec.depth, spec.height, "wall:{}".format(wall), label=spec.label)
                lay = replace(base, basin=item, basin_zone=zone,
                              basin_stand=room.band(wall, t, t + span, front, offset=spec.depth))
                quick = (ev._basin_entrance(lay, False).points + ev._basin_standing(lay, False).points
                         + ev._mirror(lay, False).points)
                scored.append((-round(quick, 3), mid, lay))
            scored.sort(key=lambda entry: entry[:2])
            picked: List[float] = []
            for _, mid, lay in scored:
                if len(picked) >= self.s.basins_per_wall:
                    break
                if all(abs(mid - p) >= SPACING for p in picked):
                    picked.append(mid)
                    chosen.append(replace(lay, base_score=self._ceiling(lay)))
        return chosen

    def _ceiling(self, lay: Layout) -> float:
        """The best total a layout could still reach if everything decided later came out perfect."""
        self.stats["layouts_scored"] += 1
        results = self.ev.static(lay)
        if self.ev.main_door is not None:
            results["R4"] = RuleResult(RULE_BY_ID["R4"], 1.0, self.ev.weights["R4"])
        return self.ev.total(results)

    # ------------------------------------------------------------------ #
    # the storage cabinet (rules 6 and 7)
    # ------------------------------------------------------------------ #
    def _with_cabinet(self, lay: Layout) -> Layout:
        """Add the cabinet at the best position that leaves every route open, or report it left out."""
        spec, room, c, ev = CABINET, self.room, self.c, self.ev
        fixed = [f.rect for f in lay.fixtures]
        zones = [zone for _, zone in lay.zones] + ev.door_zones
        windows = [band for window, band in ev.window_bands if spec.height > window.sill_height]
        leaf_depth = min(spec.width, c.cabinet_leaf_max)
        options = []
        for wall in WALLS:
            wall_length = room.wall_length(wall)
            if spec.depth + leaf_depth > room.depth_from(wall) + 1.0:
                continue
            snaps: List[float] = []
            for blocker in fixed + zones + windows:
                if room.out_from(wall, blocker)[0] < spec.depth - 1.0:
                    b_lo, b_hi = room.along(wall, blocker)
                    snaps += [b_hi, b_lo - spec.width]
            for t in positions(wall_length, spec.width, self.s.step, snaps):
                self.stats["positions_tried"] += 1
                rect = room.band(wall, t, t + spec.width, spec.depth)
                if hits_any(rect, fixed) or hits_any(rect, zones) or hits_any(rect, windows):
                    continue
                leaf = room.band(wall, t, t + spec.width, leaf_depth, offset=spec.depth)
                if hits_any(leaf, fixed):
                    continue           # rule 7: the door must be able to open
                item = Item("bathroom_cabinet_1", "bathroom_cabinet", spec.model, rect, wall, OPPOSITE[wall],
                            spec.width, spec.depth, spec.height, "wall:{}".format(wall), label=spec.label)
                option = replace(lay, cabinet=item, cabinet_leaf=leaf)
                mark = ev._cabinet_position(option, False).score - (0.25 if hits_any(leaf, ev.door_zones) else 0.0)
                options.append((-round(mark, 3), round(distance(lay.basin_stand, rect)), wall, t, option))
        options.sort(key=lambda entry: entry[:4])
        for entry in options[:12]:
            if self._passable(entry[4]):
                return entry[4]
        reason = ("Every free position would block the way to a fixture." if options
                  else "No wall has room for it clear of the fixtures, the door and the floor they need.")
        return replace(lay, unplaced=lay.unplaced + (Unplaced(spec.type, spec.label, False, (reason,)),))

    # ------------------------------------------------------------------ #
    # walking the room (rules 4, 7, 11 and 13)
    # ------------------------------------------------------------------ #
    def _targets(self, lay: Layout) -> List[Tuple[Target, Optional[Item]]]:
        """The places the walking path must reach, each with the fixture it serves."""
        out = [(Target(name, stand), owner) for name, stand, owner in self.ev.stands(lay)]
        if lay.cabinet is not None:
            out.append((Target("the cabinet", lay.cabinet_leaf), lay.cabinet))
        out += [(Target("door {}".format(d.id), d.keep_clear(self.room, self.c.door_entry_depth)), None)
                for d in self.doors if not d.is_main]
        return out

    def _passable(self, lay: Layout, extra: Optional[Rect] = None, skip: Optional[Item] = None,
                  width: Optional[float] = None) -> bool:
        """Can every fixture still be walked to from the entrance?"""
        if self.entry_zone is None:
            return True
        self.stats["paths_walked"] += 1
        obstacles = [f.rect for f in lay.fixtures] + ([extra] if extra is not None else [])
        targets = [target for target, owner in self._targets(lay) if skip is None or owner is not skip]
        return can_walk(self.room.rect, self.entry_zone, self.entry_point, obstacles, targets,
                        self.c.path_min if width is None else width)

    def _walk(self, lay: Layout, strict: bool) -> Tuple[CirculationReport, Walk]:
        c, ev, bounds = self.c, self.ev, self.room.rect
        obstacles = [f.rect for f in lay.fixtures]
        level = lay.shower is not None and SHOWERS[lay.shower.model].level
        walk = Walk(
            open_side=open_square(bounds, obstacles),
            turning=open_square(bounds, [f.rect for f in lay.fixtures if not (level and f is lay.shower)]),
        )
        leaves = ev.leaves(lay)
        if self.entry_zone is None:
            walk.leaves = [(name, True, hits_any(leaf, ev.door_zones)) for name, leaf in leaves]
            return CirculationReport(valid=True, checked=False), walk

        self.stats["paths_walked"] += 1
        targets = [target for target, _ in self._targets(lay)]
        targets += [Target("window {}".format(w.id), band, essential=False) for w, band in ev.window_bands]
        widths = (self.a.path_width,) if strict else c.path_widths
        report = analyse(bounds, self.entry_zone, self.entry_point, obstacles, targets, widths)
        walk.path_width = report.width
        if not report.valid:
            return report, walk

        if lay.shower is not None:         # rule 11: can the basin and the toilet be reached on dry floor?
            self.stats["paths_walked"] += 1
            splash = beyond(ev.opening(lay), lay.entry_side, c.splash_depth)
            dry = [Target(name, stand) for name, stand, owner in ev.stands(lay) if owner is not lay.shower]
            walk.dry_route = can_walk(bounds, self.entry_zone, self.entry_point, obstacles + [splash], dry, c.path_min)
        for name, leaf in leaves:          # rule 7: each cabinet door opened in turn
            owner = lay.cabinet if leaf is lay.cabinet_leaf else lay.basin
            walk.leaves.append((name, self._passable(lay, leaf, owner, c.open_door_path),
                                hits_any(leaf, ev.door_zones)))
        return report, walk

    def _finish(self, lay: Layout, strict: bool) -> Optional[Result]:
        ev = self.ev
        if self.programme.cabinet:
            lay = self._with_cabinet(lay)
        lay = replace(lay, fitout=fit_out(ev, lay))
        report, walk = self._walk(lay, strict)
        if report.checked and not report.valid:
            return None                # rule 4: a layout nobody can walk through is no layout
        rules = ev.static(lay, explain=True, walk=walk)
        rules["R4"] = ev.path_result(lay, report)
        ordered = {rule.id: rules[rule.id] for rule in RULES}
        violations = ev.violations(lay, report, walk)
        if strict and violations:
            return None                # the wheelchair limits are hard on this pass
        return Result(lay, ordered, ev.total(ordered), report, walk, violations)

    def _search(self, level: Level, strict: bool, with_shower: bool) -> List[Result]:
        """The best finished layout for every (shower corner, toilet wall, basin wall) the room allows."""
        if with_shower:
            starts = self._showers(level)
        else:
            missing: Tuple[Unplaced, ...] = ()
            if self.programme.shower:
                missing = (Unplaced("shower", SHOWERS[self.programme.levels[-1].shower].label,
                                    self.programme.shower_required,
                                    ("No corner has room for it with the toilet, the basin and the floor each "
                                     "needs.",)),)
            starts = [Layout(level=Level(level.name, None, level.toilet, level.basin),
                             toilet=None, toilet_zone=None, toilet_stand=None, unplaced=missing)]

        variants: Dict[Tuple[str, str, str], List[Layout]] = {}
        for start in starts:
            for partial in self._toilets(level, strict, start):
                for lay in self._basins(level, strict, partial):
                    variants.setdefault((lay.corner, lay.toilet.wall, lay.basin.wall), []).append(lay)

        ranked_keys = sorted(variants, key=lambda key: (-max(lay.base_score for lay in variants[key]), key))
        results: List[Result] = []
        per_group: Dict[str, int] = {}
        for key in ranked_keys:
            group = key[0] or key[1]
            if per_group.get(group, 0) >= self.s.variants_per_corner:
                continue
            ranked = sorted(enumerate(variants[key]), key=lambda entry: (-entry[1].base_score, entry[0]))
            best: Optional[Result] = None
            for _, lay in ranked[: self.s.finalists]:
                if best is not None and lay.base_score <= best.score + 1e-9:
                    break              # nothing left in this variant can beat what is already scored
                result = self._finish(lay, strict)
                if result is not None and (best is None or (result.valid, result.score) > (best.valid, best.score)):
                    best = result
            if best is not None:
                results.append(best)
                per_group[group] = per_group.get(group, 0) + 1
        return results

    # ------------------------------------------------------------------ #
    # choosing and naming the alternatives
    # ------------------------------------------------------------------ #
    def _select(self, results: List[Result]) -> List[Result]:
        group = lambda r: r.layout.corner or r.layout.toilet.wall
        order = lambda r: (not r.valid, -r.score, group(r), r.layout.toilet.wall, r.layout.basin.wall)
        primary: Dict[str, Result] = {}
        for result in sorted(results, key=order):
            primary.setdefault(group(result), result)
        chosen = sorted(primary.values(), key=order)[: self.s.max_layouts]
        for result in sorted(results, key=order):     # other toilet / basin walls fill the slots left over
            if len(chosen) >= self.s.max_layouts:
                break
            if not any(result is c for c in chosen):
                chosen.append(result)
        chosen.sort(key=order)

        for result in chosen:
            lay = result.layout
            where = "toilet on the {} wall, basin on the {} wall".format(lay.toilet.wall, lay.basin.wall)
            if lay.shower is not None:
                result.type = "shower_{}_toilet_{}_basin_{}".format(SHORT[lay.corner], lay.toilet.wall, lay.basin.wall)
                result.title = "Shower in the {} corner".format(lay.corner)
                if result is not primary[group(result)]:
                    result.title += ", " + where
            else:
                result.type = "toilet_{}_basin_{}".format(lay.toilet.wall, lay.basin.wall)
                result.title = where.capitalize()
        return chosen

    # ------------------------------------------------------------------ #
    # serialisation - the shape the plan viewer already draws
    # ------------------------------------------------------------------ #
    def summary(self, lay: Layout) -> str:
        parts = []
        if lay.shower is not None:
            parts.append("{} in the {} corner, entered from the {}".format(
                SHOWERS[lay.shower.model].label, lay.corner, lay.entry_side))
        parts.append("{} on the {} wall".format(TOILETS[lay.toilet.model].label, lay.toilet.wall))
        parts.append("{} on the {} wall".format(BASINS[lay.basin.model].label, lay.basin.wall))
        if lay.cabinet is not None:
            parts.append("{} on the {} wall".format(CABINET.label, lay.cabinet.wall))
        text = "; ".join(parts) + "."
        return text[0].upper() + text[1:]

    def _item_reasons(self, result: Result, item: Item) -> List[str]:
        rules, lay = result.rules, result.layout
        cite = lambda *ids: [
            "Rule {}: {}".format(rule_id[1:], rules[rule_id].detail)
            for rule_id in ids if rules[rule_id].applicable and rules[rule_id].detail
        ]
        size = "{} x {}".format(metres(item.width), metres(item.depth))
        name = (item.label or item.type).capitalize()
        if item.type == "shower":
            return ["{} ({}) in the {} corner.".format(name, size, lay.corner)] + cite("R3", "R11", "R14")
        if item.type == "toilet":
            return ["{} ({}) against the {} wall.".format(name, size, item.wall)] + cite("R2", "R15")
        if item.type == "washbasin":
            return ["{} ({}) against the {} wall.".format(name, size, item.wall)] + cite("R1", "R5", "R9")
        if item.type == "bathroom_cabinet":
            return ["{} ({}) against the {} wall.".format(name, size, item.wall)] + cite("R6", "R7")
        if item.type == "mirror":
            return ["{} on the {} wall.".format(name, item.wall)] + cite("R9", "R10")
        if item.type in ("towel_rail", "towel_ring"):
            return ["{} on the {} wall, {} above the floor.".format(name, item.wall, metres(item.mount_height))] \
                + cite("R8")
        if item.type == "grab_bar":
            return ["{} on the {} wall, {} above the floor.".format(name, item.wall, metres(item.mount_height))] \
                + cite("R15")
        return ["Floor drain; the floor falls {} towards it.".format(self.c.floor_fall)] + cite("R14")

    def to_dict(self, result: Result, ranking: List[Dict]) -> Dict:
        lay, room, c, report = result.layout, self.room, self.c, result.report
        rules = list(result.rules.values())
        applicable = sum(r.weight for r in rules if r.applicable) or 1.0
        scale = 100.0 / applicable           # so the per-rule points add up to the 0-100 total
        # ... and the points earned still add up to the total once it has been held to the top score
        earned = scale * min(1.0, TOP_SCORE / result.score) if result.score > 0 else scale
        checks = {v["check"] for v in result.violations}
        fit = lay.fitout

        explanation = ["Fixtures: {}{}.".format(
            lay.level.describe(lay.cabinet is not None),
            " - planned for a user with mobility needs" if self.programme.accessible else "")]
        explanation += [
            "Rule {} - {}: {} [{}]".format(
                r.rule.id[1:], r.rule.title, r.detail,
                "not applicable" if not r.applicable else "{:.1f} of {:.1f} points".format(
                    r.points * earned, r.weight * scale))
            for r in rules
        ]
        compromises = list(lay.compromises) + ([self.door_note] if self.door_note else [])
        explanation += compromises
        explanation += ["Not placed - {}: {}".format(u.label, " ".join(u.reasons)) for u in lay.unplaced]

        lead = ("R1", "R4")
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

        in_shower = fit.drain_in_shower
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
                "notes": [v["message"] for v in result.violations] + compromises,
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
            "floor": {
                "finish": "non-slip tiles",
                "slip_rating": "R11 (wet barefoot) in the shower, R10 elsewhere" if in_shower else "R11 (wet barefoot)",
                "fall": c.floor_fall,
                "drain": [round(fit.drain[0], 1), round(fit.drain[1], 1)],
                "drain_in_shower": in_shower,
                "longest_run_mm": round(self.ev.drain_run(fit.drain), 1),
            },
            "fittings": {
                "mirror": fit.mirror,
                "towel_rail_reach_mm": fit.towel_rail_reach,
                "towel_ring_reach_mm": fit.towel_ring_reach,
                "paper_holder": fit.roll_holder,
                "toilet_grab_bar": fit.toilet_bar or None,
                "shower_grab_bar": fit.shower_bar,
            },
            "clear_square_mm": round(result.walk.turning, 1),
            "programme": self.programme.to_dict(),
        }


def rule_catalogue() -> List[Dict]:
    """The fifteen rules as written, and how the engine applies each one."""
    weights = Config().weights
    return [
        {"id": rule.id, "key": rule.key, "title": rule.title, "rule": rule.text, "method": rule.method,
         "weight": getattr(weights, rule.key)}
        for rule in RULES
    ]


def generate_bathroom_layouts(
    payload: Dict,
    default_mm_per_px: float = 20.0,
    margin_ratio: float = 0.08,
    margin_min: float = 10.0,
    margin_max: float = 60.0,
) -> Dict:
    """Request (room box + plan detections, in pixels) -> every bathroom layout, best first.

    Raises `floorplan.InputError` when the request cannot be made sense of.
    """
    config = Config.from_dict(payload.get("config"))
    if payload.get("max_layouts"):
        config.search.max_layouts = max(1, int(payload["max_layouts"]))
    shell = build_shell(payload, default_mm_per_px, margin_ratio, margin_min, margin_max)
    programme = select_programme(
        shell.room, config,
        accessible=payload.get("accessible"),
        shower=payload.get("shower"),
        storage_cabinet=payload.get("storage_cabinet"),
        fixture_size=payload.get("fixture_size"),
    )
    generator = Generator(shell, programme, config)
    results = generator.run()

    notes = shell.notes + programme.notes
    assumed = [d for d in shell.doors if d.swing == "inward" and not d.swing_known]
    if assumed and not any(r.valid for r in results):
        # The plan does not say which way the doors open and inward leaves no room: a bathroom door
        # can be hung to open outwards, so plan for that and say so.
        rehung = replace(shell, doors=[replace(d, swing="outward") if d in assumed else d for d in shell.doors])
        second = Generator(rehung, programme, config)
        second_results = second.run()
        if any(r.valid for r in second_results):
            names = ", ".join(d.id for d in assumed)
            second.door_note = (
                "With {0} {1} opening inwards the fixtures do not fit; this layout needs {0} {1} to open "
                "outwards or slide.".format("doors" if len(assumed) > 1 else "door", names))
            second.stats = {k: v + generator.stats[k] for k, v in second.stats.items()}
            second.elapsed += generator.elapsed
            notes.append(second.door_note.replace("this layout needs", "the layouts below need"))
            generator, results, shell = second, second_results, rehung
    used = generator.level_used
    if results and used is not None and used.name != programme.levels[0].name:
        notes.append("The room could not take the {} fixtures with every clearance intact; the {} set was "
                     "used instead.".format(programme.levels[0].name.replace("_", " "), used.name.replace("_", " ")))
    if results and programme.accessible and not any(r.valid for r in results):
        notes.append("Full wheelchair access does not fit this room; the layouts below come as close as the "
                     "walls allow and list what is missing.")

    ranking = [
        {"layout": r.type, "title": r.title, "score": reported(r.score), "feasible": r.valid,
         "reasons": [generator.summary(r.layout)]}
        for r in results
    ]
    layouts = [generator.to_dict(r, ranking) for r in results]
    if not layouts:
        layouts = [{
            "layout": {"type": "bathroom", "title": "Bathroom layout", "score": 0, "suitability_score": 0},
            "error": "The room ({} x {}) is too small for a toilet and a basin with the clearances the rules "
                     "require.".format(metres(shell.room.width), metres(shell.room.length)),
        }]

    return {
        "roomId": (payload.get("room") or {}).get("id"),
        "roomType": "bathroom",
        "scaleSource": shell.scale_source,
        "scaleMmPerPx": round(shell.scale_mm_per_px, 3),
        "doorsUsed": shell.doors_used,
        "windowsUsed": shell.windows_used,
        "notes": notes,
        "accessible": programme.accessible,
        "accessibleSource": programme.accessible_source,
        "programme": programme.to_dict(),
        "layouts": layouts,
        "bestLayout": results[0].type if results else None,
        "search": dict(generator.stats, elapsed_seconds=round(generator.elapsed, 3)),
    }
