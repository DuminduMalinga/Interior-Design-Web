"""
Master-bedroom layout generation.

The search is deterministic - no learning, no randomness - and every step can
be replayed:

    1. rules 11 and 14 fix the furniture list for the room size, the occupants
       and what they asked for (`programme.py`);
    2. the bed is tried at every position along every wall; positions that break
       a hard limit are discarded and the rest are ranked by the rules that
       concern the bed alone (1, 2 and 4). Bedside tables are attached as the bed is
       placed, so rule 4 holds by construction;
    3. the best bed positions on each wall are each grown into complete layouts:
       the wardrobe, then the desk and chair, then the dressing table - every piece at
       every legal position on every wall. A partial layout is kept only while
       everything in it can still be walked to from the door (rules 3 and 15), and the
       few best survive each step. If that order leaves a piece out, desk and
       dressing table are tried the other way round;
    4. each finished layout is fitted with its lights (rule 13) and scored
       against all fifteen rules, including how wide the route between bed,
       wardrobe, bathroom door and exit is, and whether a pulled-out desk chair
       spoils the way to the bed (rules 3, 9 and 15);
    5. the best layout for each distinct bed position is returned, best first,
       with wardrobe-wall variants filling any slots left over.

If the room cannot take the first-choice bed with every clearance intact, the
search falls back to the next size down, and only then to a layout that gives
up access on one side of a shared bed - reported as compromised, never passed
off as valid.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field, replace
from typing import Callable, Dict, Iterable, List, Optional, Tuple

from .circulation import CirculationReport, Target, analyse, can_walk, open_square
from .config import Config
from .floorplan import Shell, build_shell
from .furniture import (
    BEDS,
    BEDSIDE_TABLE,
    DESK,
    DESK_CHAIR,
    DRESSER,
    STOOL,
    WARDROBES,
    Item,
    Layout,
    Unplaced,
)
from .geometry import Rect, distance, hits_any, intersects
from .programme import Programme, select_programme
from .room import OPPOSITE, WALL_ENDS, WALLS
from .rules import RULES, Evaluator, RuleResult, metres

#: compass name of the corner at each end of each wall
CORNERS = {
    ("north", "lo"): "north-west", ("north", "hi"): "north-east",
    ("south", "lo"): "south-west", ("south", "hi"): "south-east",
    ("west", "lo"): "south-west", ("west", "hi"): "north-west",
    ("east", "lo"): "south-east", ("east", "hi"): "north-east",
}
#: side of the square a light is drawn as on the plan
LIGHT_SIZE = 250.0
#: two bed positions on one wall closer than this are the same alternative
BED_SPACING = 400.0


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
    violations: List[Dict] = field(default_factory=list)
    type: str = ""
    title: str = ""

    @property
    def valid(self) -> bool:
        return not self.violations


class Generator:
    """Builds, scores and ranks master-bedroom layouts for one room."""

    def __init__(self, shell: Shell, programme: Programme, config: Config):
        self.shell = shell
        self.room = shell.room
        self.doors = shell.doors
        self.windows = shell.windows
        self.programme = programme
        self.config = config
        self.c = config.clearances
        self.s = config.search
        self.ev = Evaluator(self.room, self.doors, self.windows, programme, config)
        door = self.ev.main_door
        self.entry_zone = door.keep_clear(self.room, self.c.door_entry_depth) if door else None
        self.entry_point = door.center(self.room) if door else None
        self.stats = {"bed_positions": 0, "positions_tried": 0, "layouts_scored": 0, "paths_walked": 0}
        self.elapsed = 0.0

    # ------------------------------------------------------------------ #
    def run(self) -> List[Result]:
        started = time.perf_counter()
        attempts = [(size, False) for size in self.programme.bed_sizes]
        if self.programme.occupants >= 2:
            attempts += [(size, True) for size in self.programme.bed_sizes]

        chosen: List[Result] = []
        for size, relaxed in attempts:
            results = self._search(size, relaxed)
            valid = [r for r in results if r.valid]
            if valid:
                chosen = valid
                break
            if results and (not chosen or max(r.score for r in results) > max(r.score for r in chosen)):
                chosen = results
        selected = self._select(chosen)
        self.elapsed = time.perf_counter() - started
        return selected

    # ------------------------------------------------------------------ #
    # the bed (rules 1-6)
    # ------------------------------------------------------------------ #
    def _bed_at(self, size: str, wall: str, t: float, relaxed: bool) -> Optional[Layout]:
        """The bed with its headboard on `wall` at `t`, plus its bedside tables - or None if illegal."""
        spec, room, c = BEDS[size], self.room, self.c
        gap = {"lo": t, "hi": room.wall_length(wall) - t - spec.width}
        if any(1.0 < g < c.bed_side_min - 1.0 for g in gap.values()):
            return None                    # a sliver beside the bed that nobody can use
        open_sides = tuple(side for side in ("lo", "hi") if gap[side] >= c.bed_side_min - 1.0)
        need = 2 if self.programme.occupants >= 2 else 1
        if not open_sides or (len(open_sides) < need and not relaxed):
            return None                    # rule 2: every sleeper needs a side to get in by

        rect = room.band(wall, t, t + spec.width, spec.depth)
        if hits_any(rect, self.ev.door_zones):
            return None                    # rule 1: never in the door's sweep or on its landing
        for window, band in self.ev.window_bands:
            if window.sill_height <= c.floor_window_sill and intersects(rect, band):
                return None                # rule 1: never in front of full-height glazing
        bed = Item("bed_1", "bed", size, rect, wall, OPPOSITE[wall], spec.width, spec.depth, spec.height,
                   "headboard:{}_wall".format(wall))

        # rule 4: a table touching the bed at the pillow end of every side someone sleeps on
        table = BEDSIDE_TABLE
        door = self.ev.main_door.opening(room) if self.ev.main_door else None

        def table_rect(side: str) -> Rect:
            start = t - table.width if side == "lo" else t + spec.width
            return room.band(wall, start, start + table.width, table.depth)

        def preference(side: str):         # the roomier side first, then the one away from the door
            return (-round(gap[side]), -(distance(table_rect(side), door) if door else 0.0), side)

        tables: List[Item] = []
        table_sides: List[str] = []
        for side in sorted(open_sides, key=preference):
            if len(tables) >= self.programme.bedside_tables:
                break
            spot = table_rect(side)
            if hits_any(spot, self.ev.door_zones):
                continue
            tables.append(Item("bedside_table_{}".format(len(tables) + 1), "bedside_table", table.model, spot,
                               wall, OPPOSITE[wall], table.width, table.depth, table.height, "beside:bed"))
            table_sides.append(side)

        # rule 2: the strip an occupant gets in and out by is kept clear for good
        if need == 2:
            access = open_sides
        else:
            access = (table_sides[0],) if table_sides else (max(open_sides, key=lambda side: gap[side]),)
        keep = []
        for side in access:
            inset = table.depth if side in table_sides else 0.0
            start = t - c.bed_side_min if side == "lo" else t + spec.width
            keep.append((
                "the {} side of the bed".format(WALL_ENDS[wall][0 if side == "lo" else 1]),
                room.band(wall, start, start + c.bed_side_min, spec.depth - inset, offset=inset),
            ))

        compromises: Tuple[str, ...] = ()
        if len(open_sides) < need:
            compromises = (
                "The room is too narrow to leave {:.0f} mm on both sides of the bed, so only one side can be "
                "used to get in and out.".format(c.bed_side_min),)
        anchor = "corner_lo" if gap["lo"] <= 1.0 else "corner_hi" if gap["hi"] <= 1.0 else "open"
        return Layout(bed=bed, bed_size=size, anchor=anchor, open_sides=open_sides, access_sides=tuple(access),
                      tables=tuple(tables), keep_clear=tuple(keep), compromises=compromises)

    def _beds(self, size: str, relaxed: bool) -> List[Layout]:
        """The best few bed positions on every wall, ranked by the rules that concern the bed alone."""
        spec, room, c = BEDS[size], self.room, self.c
        chosen: List[Layout] = []
        for wall in WALLS:
            wall_length = room.wall_length(wall)
            if spec.width > wall_length + 1.0 or spec.depth > room.depth_from(wall) + 1.0:
                continue
            top = wall_length - spec.width
            snaps = [top / 2.0, c.bed_side_min, top - c.bed_side_min]
            for zone in self.ev.door_zones:
                if room.out_from(wall, zone)[0] < spec.depth - 1.0:     # the zone reaches where the bed would stand
                    lo, hi = room.along(wall, zone)
                    snaps += [hi, lo - spec.width]

            scored = []
            for t in positions(wall_length, spec.width, self.s.bed_step, snaps):
                self.stats["bed_positions"] += 1
                lay = self._bed_at(size, wall, t, relaxed)
                if lay is not None:
                    lay = replace(lay, bed_score=self.ev.total(self.ev.static(lay)))
                    scored.append((-round(lay.bed_score, 3), abs(t - top / 2.0), t, lay))
            scored.sort(key=lambda entry: entry[:3])

            picked: List[Tuple[float, Layout]] = []
            walkable: Dict[float, bool] = {}

            def take(anchor: Optional[str]) -> None:
                """The best walkable position of one kind that is not next to one already picked."""
                for _, _, t, lay in scored:
                    if anchor is not None and lay.anchor != anchor:
                        continue
                    if any(abs(t - p) < BED_SPACING for p, _ in picked):
                        continue
                    if t not in walkable:
                        walkable[t] = self._passable(lay)
                    if walkable[t]:
                        picked.append((t, lay))
                        return

            for anchor in (None, "corner_lo", "corner_hi", "open"):   # the best overall, then the best of each kind
                if len(picked) < self.s.beds_per_wall:
                    take(anchor)
            while len(picked) < self.s.beds_per_wall:                 # then the next best, spaced apart
                before = len(picked)
                take(None)
                if len(picked) == before:
                    break
            chosen += [lay for _, lay in picked]
        return chosen

    # ------------------------------------------------------------------ #
    # pieces that stand with their back to a wall (rules 7, 9, 10)
    # ------------------------------------------------------------------ #
    def _blocks_window(self, rect: Rect, height: float) -> bool:
        """Rule 10: tall furniture, or anything taller than the sill, in front of a window."""
        for window, band in self.ev.window_bands:
            if intersects(rect, band) and (height >= self.c.tall_furniture_height or height > window.sill_height):
                return True
        return False

    def _spots(self, lay: Layout, spec, front_min: float) -> List[Tuple[str, float, Rect, Rect]]:
        """Every legal (wall, position, footprint, front zone) for a piece standing against a wall."""
        room = self.room
        footprints = [i.rect for i in lay.items]
        zones = [zone for _, zone in lay.keep_clear] + self.ev.door_zones
        tall = spec.height >= self.c.tall_furniture_height
        blockers = footprints + zones + [
            band for window, band in self.ev.window_bands if tall or spec.height > window.sill_height
        ]
        spots = []
        for wall in WALLS:
            wall_length = room.wall_length(wall)
            if spec.width > wall_length + 1.0 or spec.depth + front_min > room.depth_from(wall) + 1.0:
                continue
            snaps: List[float] = []
            for blocker in blockers:
                if room.out_from(wall, blocker)[0] < spec.depth - 1.0:   # it reaches into this strip of wall
                    lo, hi = room.along(wall, blocker)
                    snaps += [hi, lo - spec.width]
            if tall:                                                     # rule 6: or a clear margin off a window
                margin = self.c.window_margin_preferred
                for window in self.windows:
                    if window.wall == wall:
                        snaps += [window.end + margin, window.start - margin - spec.width]
            for t in positions(wall_length, spec.width, self.s.item_step, snaps):
                self.stats["positions_tried"] += 1
                rect = room.band(wall, t, t + spec.width, spec.depth)
                if hits_any(rect, footprints) or hits_any(rect, zones) or self._blocks_window(rect, spec.height):
                    continue
                front = room.band(wall, t, t + spec.width, front_min, offset=spec.depth)
                if hits_any(front, footprints):
                    continue           # rules 5 and 8: the standing room in front must be free
                spots.append((wall, t, rect, front))
        return spots

    def _wardrobe_options(self, lay: Layout, size: str) -> List[Layout]:
        spec = WARDROBES[size]
        return [
            replace(
                lay,
                wardrobe=Item("wardrobe_1", "wardrobe", size, rect, wall, OPPOSITE[wall],
                              spec.width, spec.depth, spec.height, "wall:{}".format(wall)),
                keep_clear=lay.keep_clear + (("the wardrobe", front),),
            )
            for wall, _, rect, front in self._spots(lay, spec, self.c.wardrobe_front_min)
        ]

    def _dresser_options(self, lay: Layout) -> List[Layout]:
        spec = DRESSER
        return [
            replace(
                lay,
                dresser=Item("dressing_table_1", "dressing_table", spec.model, rect, wall, OPPOSITE[wall],
                             spec.width, spec.depth, spec.height, "wall:{}".format(wall)),
                keep_clear=lay.keep_clear + (("the dressing table", front),),
            )
            for wall, _, rect, front in self._spots(lay, spec, self.c.drawer_front_min)
        ]

    def _desk_options(self, lay: Layout) -> List[Layout]:
        """Rule 9: the desk against a wall, its chair in front, and floor to pull the chair out."""
        room, c, chair = self.room, self.c, DESK_CHAIR
        footprints = [i.rect for i in lay.items]
        zones = [zone for _, zone in lay.keep_clear] + self.ev.door_zones
        options = []
        for wall, t, rect, _ in self._spots(lay, DESK, chair.depth):
            if DESK.depth + c.chair_pullout_depth > room.depth_from(wall) + 1.0:
                continue
            mid = t + DESK.width / 2.0
            seat = room.band(wall, mid - chair.width / 2.0, mid + chair.width / 2.0, chair.depth, offset=DESK.depth)
            pullout = room.band(wall, mid - c.chair_pullout_width / 2.0, mid + c.chair_pullout_width / 2.0,
                                c.chair_pullout_depth, offset=DESK.depth)
            if hits_any(seat, zones) or hits_any(pullout, footprints) or hits_any(pullout, self.ev.door_zones):
                continue
            options.append(replace(
                lay,
                desk=Item("desk_1", "desk", DESK.model, rect, wall, OPPOSITE[wall],
                          DESK.width, DESK.depth, DESK.height, "wall:{}".format(wall)),
                chair=Item("desk_chair_1", "desk_chair", chair.model, seat, wall, wall,
                           chair.width, chair.depth, chair.height, "at:desk"),
                pullout=pullout,
            ))
        return options

    # ------------------------------------------------------------------ #
    # growing a bed position into complete layouts
    # ------------------------------------------------------------------ #
    def _ranked(self, options: List[Layout], tie: Callable[[Layout], float]) -> List[Layout]:
        """Best first by the static rules; `tie` (smaller wins) settles equal scores."""
        scored = []
        for index, option in enumerate(options):
            self.stats["layouts_scored"] += 1
            scored.append((-round(self.ev.total(self.ev.static(option)), 3), tie(option), index, option))
        scored.sort(key=lambda entry: entry[:3])
        return [entry[3] for entry in scored]

    def _route(self, lay: Layout) -> List[Target]:
        """Rule 8: the places the walking path must reach - the bed, the storage, any other door."""
        route = [Target(name, zone) for name, zone in lay.keep_clear]
        route += [Target("door {}".format(d.id), d.keep_clear(self.room, self.c.door_entry_depth))
                  for d in self.doors if not d.is_main]
        return route

    def _passable(self, lay: Layout) -> bool:
        """Rule 8 while building: can everything placed so far still be walked to from the entrance?"""
        if self.entry_zone is None:
            return True
        self.stats["paths_walked"] += 1
        targets = self._route(lay)
        if lay.pullout is not None:
            targets.append(Target("the desk", lay.pullout))
        return can_walk(self.room.rect, self.entry_zone, self.entry_point,
                        [i.rect for i in lay.items], targets, self.c.path_min)

    def _choose(self, ranked: List[Layout], group: Callable[[Layout], str], keep: int) -> List[Layout]:
        """The best walkable option of every group first, then the next best, up to `keep`."""
        kept: List[Layout] = []
        seen = set()
        walkable: Dict[int, bool] = {}

        def passes(option: Layout) -> bool:
            if id(option) not in walkable:
                walkable[id(option)] = self._passable(option)
            return walkable[id(option)]

        for option in ranked:
            if len(kept) >= keep:
                break
            if group(option) not in seen and passes(option):
                seen.add(group(option))
                kept.append(option)
        for option in ranked:
            if len(kept) >= keep:
                break
            if not any(option is k for k in kept) and passes(option):
                kept.append(option)
        return kept

    def _door_gap(self, piece: Callable[[Layout], Item]) -> Callable[[Layout], float]:
        """Tie-break for storage: nearer the entrance leaves the far end of the room free."""
        door = self.ev.main_door.opening(self.room) if self.ev.main_door else None
        return lambda lay: distance(piece(lay).rect, door) if door else 0.0

    def _daylight(self, lay: Layout) -> float:
        """Tie-break for the desk: nearer a window is better."""
        return min((distance(lay.desk.rect, band) for _, band in self.ev.window_bands), default=0.0)

    @staticmethod
    def _without(lay: Layout, kind: str, name: str, required: bool, reason: str) -> Layout:
        return replace(lay, unplaced=lay.unplaced + (Unplaced(kind, name, required, (reason,)),))

    def _add(self, start: Layout, stages: List[Tuple]) -> List[Layout]:
        """Add the optional pieces to one partial layout, in the order given."""
        blocked = "Every free position would block the way to the bed or the storage."
        partials = [start]
        for spec, options_for, piece, tie, reason in stages:
            grown: List[Layout] = []
            for partial in partials:
                options = options_for(partial)
                chosen = self._choose(self._ranked(options, tie), lambda lay: piece(lay).wall, self.s.branch)
                if not chosen:
                    chosen = [self._without(partial, spec.type, spec.label, False, blocked if options else reason)]
                grown += chosen
            partials = grown
        return partials

    def _grow(self, bed: Layout) -> List[Layout]:
        """Every promising complete layout around one bed position."""
        programme, c = self.programme, self.c
        starts = [bed]
        if programme.wardrobe_sizes:
            starts, fits = [], False
            for size in programme.wardrobe_sizes:       # largest first; a size down when nothing works
                options = self._wardrobe_options(bed, size)
                fits = fits or bool(options)
                ranked = self._ranked(options, self._door_gap(lambda lay: lay.wardrobe))
                starts = self._choose(ranked, lambda lay: lay.wardrobe.wall, len(WALLS))
                if starts:
                    break
            if not starts:
                starts = [self._without(
                    bed, "wardrobe", WARDROBES[programme.wardrobe_sizes[-1]].label, programme.wardrobe_required,
                    "Every free position would block the way to the bed." if fits else
                    "No wall has room for it with {} of standing space in front.".format(
                        metres(c.wardrobe_front_min)))]

        # the desk first: with its chair it needs the most floor, so it is the hardest to fit
        stages = []
        if programme.desk:
            stages.append((DESK, self._desk_options, lambda lay: lay.desk, self._daylight,
                           "No wall has room for the desk and the floor its chair needs."))
        if programme.dresser:
            stages.append((DRESSER, self._dresser_options, lambda lay: lay.dresser,
                           self._door_gap(lambda lay: lay.dresser),
                           "No wall has room for it with {} of standing space in front.".format(
                               metres(c.drawer_front_min))))
        if not stages:
            return starts

        finished: List[Layout] = []
        for start in starts:
            grown = self._add(start, stages)
            if len(stages) > 1 and all(len(lay.unplaced) > len(start.unplaced) for lay in grown):
                grown += self._add(start, stages[::-1])     # something was left out: try the other order too
            finished += self._ranked(grown, lambda lay: 0.0)[: self.s.beam]
        return finished

    # ------------------------------------------------------------------ #
    # finishing: the walking path (rules 8 and 9) and the final score
    # ------------------------------------------------------------------ #
    def _walk(self, lay: Layout) -> CirculationReport:
        """Rules 8 and 9 on a finished layout: how wide the route is, and whether the chair spoils it."""
        if self.entry_zone is None:
            return CirculationReport(valid=True, checked=False)
        self.stats["paths_walked"] += 1
        c, bounds = self.c, self.room.rect
        obstacles = [i.rect for i in lay.items]
        route = self._route(lay)
        targets = list(route)
        if lay.pullout is not None:
            targets.append(Target("the desk", lay.pullout))     # a desk nobody can get to is no use
        targets += [Target("window {}".format(w.id), band, essential=False) for w, band in self.ev.window_bands]

        report = analyse(bounds, self.entry_zone, self.entry_point, obstacles, targets, c.path_widths)
        if report.valid and lay.pullout is not None:
            report.chair_clear = can_walk(
                bounds, self.entry_zone, self.entry_point, obstacles + [lay.pullout], route, c.path_min)
        return report

    def _ceiling(self, lay: Layout, static: Dict[str, RuleResult]) -> float:
        """The best total a layout could still reach if the walk came out perfect (`static` assumes it does)."""
        return self.ev.total(static)

    def _finish(self, lay: Layout) -> Optional[Result]:
        report = self._walk(lay)
        if report.checked and not report.valid:
            return None                # rules 3 and 15: a layout nobody can walk through is no layout
        rules = self.ev.static(lay, explain=True, report=report,
                               open_side=open_square(self.room.rect, [i.rect for i in lay.items]))
        ordered = {rule.id: rules[rule.id] for rule in RULES}
        return Result(lay, ordered, self.ev.total(ordered), report, self.ev.violations(lay, report))

    def _search(self, size: str, relaxed: bool) -> List[Result]:
        """The best finished layout for every (bed wall, bed kind, wardrobe wall) the room allows."""
        variants: Dict[Tuple[str, str, str], List[Layout]] = {}
        for bed in self._beds(size, relaxed):
            for lay in self._grow(bed):
                key = (lay.bed.wall, lay.anchor, lay.wardrobe.wall if lay.wardrobe else "")
                variants.setdefault(key, []).append(lay)

        results: List[Result] = []
        for key in sorted(variants):
            ranked = sorted(
                ((self._ceiling(lay, self.ev.static(lay)), index, lay) for index, lay in enumerate(variants[key])),
                key=lambda entry: (-entry[0], entry[1]),
            )
            best: Optional[Result] = None
            for ceiling, _, lay in ranked[: self.s.finalists]:
                if best is not None and ceiling <= best.score + 1e-9:
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
        order = lambda r: (not r.valid, -r.score, r.layout.bed.wall, r.layout.anchor)
        primary: Dict[Tuple[str, str], Result] = {}
        for result in sorted(results, key=order):
            primary.setdefault((result.layout.bed.wall, result.layout.anchor), result)
        chosen = sorted(primary.values(), key=order)[: self.s.max_layouts]
        for result in sorted(results, key=order):     # wardrobe-wall variants fill the slots left over
            if len(chosen) >= self.s.max_layouts:
                break
            if not any(result is c for c in chosen):
                chosen.append(result)
        chosen.sort(key=order)

        for result in chosen:
            lay = result.layout
            wall, anchor = lay.bed.wall, lay.anchor
            result.type = "bed_{}_{}".format(wall, anchor)
            if anchor == "open":
                result.title = "Bed on the {} wall".format(wall)
            else:
                result.title = "Corner bed on the {} wall ({} corner)".format(wall, CORNERS[(wall, anchor[-2:])])
            if result is not primary[(wall, anchor)]:     # same bed position, the wardrobe somewhere else
                where = lay.wardrobe.wall if lay.wardrobe is not None else None
                result.type += "_wardrobe_{}".format(where or "none")
                result.title += ", wardrobe on the {} wall".format(where) if where else ", no wardrobe"
        return chosen

    # ------------------------------------------------------------------ #
    # serialisation - the shape the plan viewer already draws
    # ------------------------------------------------------------------ #
    def summary(self, lay: Layout) -> str:
        bed = "{} with its headboard on the {} wall".format(BEDS[lay.bed_size].label.capitalize(), lay.bed.wall)
        if lay.anchor != "open":
            bed += ", tucked into the {} corner".format(CORNERS[(lay.bed.wall, lay.anchor[-2:])])
        if lay.tables:
            bed += " and {} bedside table{}".format(len(lay.tables), "" if len(lay.tables) == 1 else "s")
        parts = [bed]
        if lay.wardrobe is not None:
            parts.append("{} on the {} wall".format(WARDROBES[lay.wardrobe.model].label, lay.wardrobe.wall))
        if lay.dresser is not None:
            parts.append("dressing table on the {} wall".format(lay.dresser.wall))
        if lay.desk is not None:
            parts.append("desk on the {} wall".format(lay.desk.wall))
        return "; ".join(parts) + "."

    def _item_reasons(self, result: Result, item: Item) -> List[str]:
        rules, c = result.rules, self.c
        cite = lambda *ids: [
            "Rule {}: {}".format(rule_id[1:], rules[rule_id].detail)
            for rule_id in ids if rules[rule_id].applicable and rules[rule_id].detail
        ]
        size = "{} x {}".format(metres(item.width), metres(item.depth))
        if item.type == "bed":
            return ["{} ({}), headboard against the {} wall.".format(
                BEDS[item.model].label.capitalize(), size, item.wall)] + cite("R1", "R2", "R3")
        if item.type == "bedside_table":
            return ["Bedside table ({}) set against the bed at the pillow end.".format(size)] + cite("R4", "R10", "R13")
        if item.type == "wardrobe":
            return ["{} ({}) against the {} wall.".format(
                WARDROBES[item.model].label.capitalize(), size, item.wall)] + cite("R5", "R6", "R15")
        if item.type == "dressing_table":
            return ["Dressing table with mirror ({}) against the {} wall.".format(size, item.wall)] + cite("R7", "R8")
        if item.type == "desk":
            return ["Study desk ({}) against the {} wall.".format(size, item.wall)] + cite("R9")
        return ["Desk chair, tucked in at the desk; it needs {} x {} of floor when someone sits at it.".format(
            metres(c.chair_pullout_width), metres(c.chair_pullout_depth))] + cite("R9")

    def _extras(self, result: Result) -> List[Dict]:
        """The dressing stool and the lights (rule 13): drawn on the plan, but nothing is measured from them."""
        lay, room = result.layout, self.room
        cite = lambda rule_id: ["Rule {}: {}".format(rule_id[1:], result.rules[rule_id].detail)]
        out: List[Dict] = []
        if lay.dresser is not None:
            table = lay.dresser
            lo, hi = room.along(table.wall, table.rect)
            mid = (lo + hi) / 2.0
            rect = room.band(table.wall, mid - STOOL.width / 2.0, mid + STOOL.width / 2.0, STOOL.depth,
                             offset=table.depth + 50.0)
            entry = Item("stool_1", "stool", STOOL.model, rect, table.wall, table.wall,
                         STOOL.width, STOOL.depth, STOOL.height, "at:dressing_table").to_dict()
            entry.update(mounted="floor", movable=True,
                         reasons=["Dressing stool; it tucks under the table when not in use."] + cite("R8"))
            out.append(entry)
        counts: Dict[str, int] = {}
        for kind, name, (x, y), mount, height in self.ev.lighting(lay):
            counts[kind] = counts.get(kind, 0) + 1
            half = LIGHT_SIZE / 2.0
            entry = Item("{}_{}".format(kind, counts[kind]), kind, name, (x - half, y - half, x + half, y + half),
                         lay.bed.wall, lay.bed.facing, LIGHT_SIZE, LIGHT_SIZE, 0.0, "light").to_dict()
            entry.update(mounted=mount, mount_height=height,
                         reasons=["{}, {} above the floor.".format(name.capitalize(), metres(height))] + cite("R13"))
            out.append(entry)
        return out

    def to_dict(self, result: Result, ranking: List[Dict]) -> Dict:
        lay, room, c, report = result.layout, self.room, self.c, result.report
        rules = list(result.rules.values())
        applicable = sum(r.weight for r in rules if r.applicable) or 1.0
        scale = 100.0 / applicable           # so the per-rule points add up to the 0-100 total
        checks = {v["check"] for v in result.violations}

        programme = self.programme
        explanation = [
            "Furniture list (rules 11 and 14): {} for {}.".format(
                programme.describe(),
                "two occupants" if programme.occupants >= 2 else "one occupant"),
        ]
        explanation += [
            "Rule {} - {}: {} [{}]".format(
                r.rule.id[1:], r.rule.title, r.detail,
                "not applicable" if not r.applicable else "{:.1f} of {:.1f} points".format(
                    r.points * scale, r.weight * scale))
            for r in rules
        ]
        explanation += list(lay.compromises)
        explanation += ["Not placed - {}: {}".format(u.label, " ".join(u.reasons)) for u in lay.unplaced]

        reason = [self.summary(lay)]
        reason += [result.rules[rule_id].detail for rule_id in ("R2", "R15") if result.rules[rule_id].applicable]
        weakest = min((r for r in rules if r.applicable and r.rule.id not in ("R2", "R15")),
                      key=lambda r: r.score, default=None)
        if weakest is not None and weakest.score < 0.7:
            reason.append("Trade-off - {}: {}".format(weakest.rule.title.lower(), weakest.detail))

        furniture = []
        for item in lay.items:
            entry = item.to_dict()
            entry["mounted"] = "floor"
            entry["reasons"] = self._item_reasons(result, item)
            furniture.append(entry)
        furniture += self._extras(result)

        return {
            "room": room.to_dict(),
            "layout": {
                "type": result.type,
                "title": result.title,
                "score": round(result.score, 1),
                "suitability_score": round(lay.bed_score, 1),
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
                "total": round(result.score, 1),
                "max": 100,
                "components": {r.rule.key: round(r.points * scale, 1) for r in rules if r.applicable},
                "contributions": [
                    {"rule": r.rule.key, "points": round(r.points * scale, 2), "message": r.detail}
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
                    "points": round(r.points * scale, 1),
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
            "programme": programme.to_dict(),
        }


def rule_catalogue() -> List[Dict]:
    """The fifteen rules as written, and how the engine applies each one."""
    weights = Config().weights
    return [
        {"id": rule.id, "key": rule.key, "title": rule.title, "rule": rule.text, "method": rule.method,
         "weight": getattr(weights, rule.key)}
        for rule in RULES
    ]


def generate_master_bedroom_layouts(
    payload: Dict,
    default_mm_per_px: float = 20.0,
    margin_ratio: float = 0.08,
    margin_min: float = 10.0,
    margin_max: float = 60.0,
) -> Dict:
    """Request (room box + plan detections, in pixels) -> every master-bedroom layout, best first.

    Raises `floorplan.InputError` when the request cannot be made sense of.
    """
    config = Config.from_dict(payload.get("config"))
    if payload.get("max_layouts"):
        config.search.max_layouts = max(1, int(payload["max_layouts"]))
    shell = build_shell(payload, default_mm_per_px, margin_ratio, margin_min, margin_max)
    programme = select_programme(
        shell.room, config,
        occupants=payload.get("occupants"),
        bed_size=payload.get("bed_size"),
        required=payload.get("required_furniture"),
        optional=payload.get("optional_furniture"),
        excluded=payload.get("excluded_furniture"),
    )
    generator = Generator(shell, programme, config)
    results = generator.run()

    ranking = [
        {"layout": r.type, "title": r.title, "score": round(r.score, 1), "feasible": r.valid,
         "reasons": [generator.summary(r.layout)]}
        for r in results
    ]
    layouts = [generator.to_dict(r, ranking) for r in results]
    if not layouts:
        layouts = [{
            "layout": {"type": "master_bedroom", "title": "Master bedroom layout", "score": 0, "suitability_score": 0},
            "error": "The room ({} x {}) is too small for a {} with the clearances the rules require.".format(
                metres(shell.room.width), metres(shell.room.length), BEDS[programme.bed_sizes[-1]].label),
        }]

    return {
        "roomId": (payload.get("room") or {}).get("id"),
        "roomType": "master_bedroom",
        "scaleSource": shell.scale_source,
        "scaleMmPerPx": round(shell.scale_mm_per_px, 3),
        "doorsUsed": shell.doors_used,
        "windowsUsed": shell.windows_used,
        "notes": shell.notes + programme.notes,
        "occupants": programme.occupants,
        "occupantsSource": programme.occupants_source,
        "programme": programme.to_dict(),
        "layouts": layouts,
        "bestLayout": results[0].type if results else None,
        "search": dict(generator.stats, elapsed_seconds=round(generator.elapsed, 3)),
    }
