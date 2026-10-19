"""
Tests for the bedroom layout engine (standard library only - no pytest needed).

    cd backend/bedroom_layout
    python -m unittest bedroom_layout.tests.test_engine -v

Five levels are covered:

1. geometry    - the exact walkability map and the open-floor measure
2. floor plan  - which detections belong to a room, the scale, the entrance
3. rules       - every returned layout is re-checked against the hard limits of
                 the twelve rules with geometry written here, independently of
                 the engine's own checks, and the scored rules move the right way
4. behaviour   - furniture list per room size / head count, fall-backs,
                 determinism, speed
5. service     - the API wrapper (run with the service's venv; skipped without FastAPI)
"""

from __future__ import annotations

import copy
import os
import sys
import time
import unittest

if __package__ in (None, ""):  # allow running the file directly
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from bedroom_layout import RULES, InputError, generate_bedroom_layouts, rule_catalogue
from bedroom_layout.circulation import Target, can_walk, open_square
from bedroom_layout.floorplan import build_shell
from bedroom_layout.rules import furniture_mark

PX = 10.0                 # millimetres per pixel used by the test plans
LEFT, TOP = 200.0, 150.0  # where the room sits on the imaginary image


# --------------------------------------------------------------------------- #
# building requests: rooms are written in millimetres and converted to the
# pixel boxes the wall detector would report, so the whole pipeline is tested
# --------------------------------------------------------------------------- #
def plan(width, length, doors=(), windows=(), **extra):
    """doors / windows: (wall, position_mm, width_mm[, extra detection keys])."""
    right, bottom = LEFT + width / PX, TOP + length / PX

    def box(wall, position, size, thick):
        a, b = position / PX, (position + size) / PX
        if wall == "north":
            return {"x1": LEFT + a, "x2": LEFT + b, "y1": TOP - thick, "y2": TOP}
        if wall == "south":
            return {"x1": LEFT + a, "x2": LEFT + b, "y1": bottom, "y2": bottom + thick}
        if wall == "west":
            return {"x1": LEFT - thick, "x2": LEFT, "y1": bottom - b, "y2": bottom - a}
        return {"x1": right, "x2": right + thick, "y1": bottom - b, "y2": bottom - a}

    detections = []
    for index, door in enumerate(doors):
        detection = {"id": "door-%d" % (index + 1), "class": "Door", "bbox": box(door[0], door[1], door[2], 6)}
        if len(door) > 3:
            detection.update(door[3])
        detections.append(detection)
    for index, window in enumerate(windows):
        detections.append(
            {"id": "win-%d" % (index + 1), "class": "Window", "bbox": box(window[0], window[1], window[2], 14)})
    payload = {
        "room": {"id": "room-1", "name": "Bedroom", "bbox": {"x1": LEFT, "y1": TOP, "x2": right, "y2": bottom}},
        "detections": detections,
        "scale_m_per_px": PX / 1000.0,
    }
    payload.update(extra)
    return payload


ROOMS = {
    "medium_double": plan(3800, 4500, doors=[("west", 100, 900)], windows=[("north", 750, 2300)]),
    "medium_single": plan(3800, 4500, doors=[("west", 100, 900)], windows=[("north", 750, 2300)], occupants=1),
    "small_single": plan(2700, 3200, doors=[("south", 150, 800)], windows=[("north", 800, 1200)]),
    "box_room": plan(2200, 2800, doors=[("east", 100, 800)], windows=[("west", 900, 1000)]),
    "narrow": plan(2400, 4200, doors=[("south", 800, 800)], windows=[("north", 600, 1200)]),
    "large_master": plan(5000, 4600, doors=[("south", 3800, 900), ("east", 600, 800)],
                         windows=[("north", 1200, 2400), ("west", 1500, 1500)]),
    "square_two_windows": plan(3600, 3600, doors=[("east", 2500, 900)],
                               windows=[("north", 900, 1500), ("west", 1000, 1500)]),
    "door_mid_wall": plan(4000, 3500, doors=[("south", 1550, 900)], windows=[("north", 1000, 2000)]),
    "long_window_wall": plan(4200, 3200, doors=[("east", 150, 900)], windows=[("south", 300, 3400)]),
    "outward_door": plan(3000, 3400, doors=[("south", 200, 900, {"swing": "outward"})],
                         windows=[("north", 800, 1400)]),
    "wide_door": plan(3600, 4000, doors=[("south", 300, 1200)], windows=[("east", 1200, 1500)]),
}


def layouts_of(result):
    return [entry for entry in result["layouts"] if "error" not in entry]


# --------------------------------------------------------------------------- #
# independent geometry - deliberately not imported from the engine
# --------------------------------------------------------------------------- #
def band(room, wall, start, end, depth, offset=0.0):
    width, length = room["width"], room["length"]
    if wall == "south":
        return (start, offset, end, offset + depth)
    if wall == "north":
        return (start, length - offset - depth, end, length - offset)
    if wall == "west":
        return (offset, start, offset + depth, end)
    return (width - offset - depth, start, width - offset, end)


def overlap(a, b, tol=1.0):
    return a[0] < b[2] - tol and b[0] < a[2] - tol and a[1] < b[3] - tol and b[1] < a[3] - tol


def along(wall, r):
    return (r[0], r[2]) if wall in ("north", "south") else (r[1], r[3])


def out_from(room, wall, r):
    if wall == "south":
        return (r[1], r[3])
    if wall == "north":
        return (room["length"] - r[3], room["length"] - r[1])
    if wall == "west":
        return (r[0], r[2])
    return (room["width"] - r[2], room["width"] - r[0])


def door_zone(room, door):
    depth = max(900.0, door["width"]) if door["swing"] == "inward" else 900.0
    return band(room, door["wall"], door["position"], door["position"] + door["width"], depth)


def clear_in_front(layout, item, limit=3000.0):
    """Clear floor straight in front of a piece standing against its wall."""
    room, wall = layout["room"], item["wall"]
    lo, hi = along(wall, item["bbox"])
    far = out_from(room, wall, item["bbox"])[1]
    room_depth = room["length"] if wall in ("north", "south") else room["width"]
    clear = min(limit, room_depth - far)
    front = band(room, wall, lo, hi, clear, offset=far)
    for other in layout["furniture"]:
        if other["id"] != item["id"] and overlap(front, other["bbox"]):
            clear = min(clear, out_from(room, wall, other["bbox"])[0] - far)
    return clear


def beside_bed(layout):
    """Clear floor on each side of the bed, measured past the bedside tables."""
    room = layout["room"]
    bed = next(f for f in layout["furniture"] if f["type"] == "bed")
    wall = bed["wall"]
    lo, hi = along(wall, bed["bbox"])
    wall_length = room["width"] if wall in ("north", "south") else room["length"]
    bed_length = out_from(room, wall, bed["bbox"])[1]
    clear = {}
    for side in ("lo", "hi"):
        gap = lo if side == "lo" else wall_length - hi
        start, end = (0.0, lo) if side == "lo" else (hi, wall_length)
        tables = [f for f in layout["furniture"] if f["type"] == "bedside_table"
                  and (along(wall, f["bbox"])[1] <= lo + 1 if side == "lo" else along(wall, f["bbox"])[0] >= hi - 1)]
        inset = max((out_from(room, wall, t["bbox"])[1] for t in tables), default=0.0)
        strip = band(room, wall, start, end, bed_length - inset, offset=inset)
        for other in layout["furniture"]:
            if other["type"] in ("bed", "bedside_table") or not overlap(strip, other["bbox"]):
                continue
            o_lo, o_hi = along(wall, other["bbox"])
            gap = min(gap, lo - o_hi if side == "lo" else o_lo - hi)
        clear[side] = gap
    return bed, clear


def raster_walk(layout, width=600.0, cell=50.0):
    """Flood fill on a plain pixel grid - a second opinion on the engine's exact walkability map.

    One cell of slack is given away, so anything the engine calls walkable must
    be walkable here too; a layout that fails here was accepted wrongly.
    """
    room = layout["room"]
    reach = width / 2.0 - cell
    nx, ny = int(room["width"] // cell) + 1, int(room["length"] // cell) + 1
    grown = [(f["bbox"][0] - reach, f["bbox"][1] - reach, f["bbox"][2] + reach, f["bbox"][3] + reach)
             for f in layout["furniture"]]

    def standable(ix, iy):
        x, y = (ix + 0.5) * cell, (iy + 0.5) * cell
        if x < reach or y < reach or x > room["width"] - reach or y > room["length"] - reach:
            return False
        return not any(g[0] < x < g[2] and g[1] < y < g[3] for g in grown)

    main = next(d for d in layout["openings"]["doors"] if d["is_main"])
    zone = door_zone(room, main)
    stack = [(ix, iy) for ix in range(nx) for iy in range(ny)
             if zone[0] <= (ix + 0.5) * cell <= zone[2] and zone[1] <= (iy + 0.5) * cell <= zone[3]
             and standable(ix, iy)]
    seen = set(stack)
    while stack:
        ix, iy = stack.pop()
        for jx, jy in ((ix - 1, iy), (ix + 1, iy), (ix, iy - 1), (ix, iy + 1)):
            if 0 <= jx < nx and 0 <= jy < ny and (jx, jy) not in seen and standable(jx, jy):
                seen.add((jx, jy))
                stack.append((jx, jy))
    return lambda r: any(r[0] <= (ix + 0.5) * cell <= r[2] and r[1] <= (iy + 0.5) * cell <= r[3] for ix, iy in seen)


# --------------------------------------------------------------------------- #
# 1. geometry
# --------------------------------------------------------------------------- #
class WalkabilityTests(unittest.TestCase):
    ROOM = (0.0, 0.0, 3000.0, 3000.0)
    DOOR = (0.0, 0.0, 900.0, 900.0)
    FAR = [Target("far corner", (2400.0, 2400.0, 3000.0, 3000.0))]

    def walk(self, obstacles, width=600.0):
        return can_walk(self.ROOM, self.DOOR, (450.0, 0.0), obstacles, self.FAR, width)

    def test_empty_room_is_walkable(self):
        self.assertTrue(self.walk([]))

    def test_gap_exactly_as_wide_as_the_walker_passes(self):
        wall = [(0.0, 1500.0, 2400.0, 1700.0)]             # leaves a 600 mm gap at the east wall
        self.assertTrue(self.walk(wall))

    def test_gap_narrower_than_the_walker_blocks(self):
        wall = [(0.0, 1500.0, 2410.0, 1700.0)]             # leaves 590 mm
        self.assertFalse(self.walk(wall))
        self.assertTrue(self.walk(wall, width=580.0))

    def test_two_corners_almost_touching_block(self):
        # the only way through is a 200 mm slot between two pieces set corner to corner
        pieces = [(0.0, 1500.0, 1500.0, 1700.0), (1500.0, 1300.0, 3000.0, 1500.0)]
        self.assertFalse(self.walk(pieces))

    def test_a_walled_off_target_is_unreachable(self):
        box = [(2300.0, 2300.0, 3000.0, 2400.0), (2300.0, 2300.0, 2400.0, 3000.0)]
        self.assertFalse(self.walk(box))

    def test_open_square(self):
        self.assertAlmostEqual(open_square(self.ROOM, []), 3000.0)
        self.assertAlmostEqual(open_square(self.ROOM, [(0.0, 0.0, 3000.0, 1000.0)]), 2000.0)
        # a piece in the middle leaves the 1000 mm margin round it, and the corners
        self.assertAlmostEqual(open_square(self.ROOM, [(1000.0, 1000.0, 2000.0, 2000.0)]), 1000.0)


# --------------------------------------------------------------------------- #
# 2. floor plan -> room
# --------------------------------------------------------------------------- #
class FloorPlanTests(unittest.TestCase):
    def test_room_size_and_openings_convert_to_millimetres(self):
        shell = build_shell(ROOMS["medium_double"])
        self.assertAlmostEqual(shell.room.width, 3800.0, delta=1)
        self.assertAlmostEqual(shell.room.length, 4500.0, delta=1)
        self.assertEqual(shell.scale_source, "provided")
        (door,), (window,) = shell.doors, shell.windows
        self.assertEqual((door.wall, round(door.position), round(door.width)), ("west", 100, 900))
        self.assertEqual((window.wall, round(window.position), round(window.width)), ("north", 750, 2300))
        self.assertTrue(door.is_main)

    def test_image_y_runs_down_so_the_top_edge_is_north(self):
        shell = build_shell(plan(3000, 4000, doors=[("east", 2800, 900)]))
        door = shell.doors[0]
        self.assertEqual(door.wall, "east")
        self.assertAlmostEqual(door.position, 2800.0, delta=1)      # measured from the south end

    def test_scale_is_recovered_from_the_doors_when_none_is_given(self):
        payload = plan(3600, 4000, doors=[("south", 300, 900)])
        payload["scale_m_per_px"] = None
        shell = build_shell(payload)
        self.assertEqual(shell.scale_source, "door")
        self.assertAlmostEqual(shell.room.width, 3600.0, delta=5)

    def test_default_scale_when_there_is_nothing_to_measure(self):
        payload = plan(3600, 4000)
        payload["scale_m_per_px"] = None
        shell = build_shell(payload, default_mm_per_px=20.0)
        self.assertEqual(shell.scale_source, "default")
        self.assertAlmostEqual(shell.room.width, 7200.0, delta=1)

    def test_a_door_of_the_room_next_door_is_not_picked_up(self):
        payload = plan(3800, 4500, doors=[("west", 100, 900)])
        right, bottom = LEFT + 380, TOP + 450
        # a door standing at right angles to the south wall, 20 px below it: it belongs to another room
        payload["detections"].append({
            "id": "stray", "class": "Door",
            "bbox": {"x1": LEFT + 60, "x2": LEFT + 66, "y1": bottom + 20, "y2": bottom + 110}})
        # and one on a wall well outside this room
        payload["detections"].append(
            {"id": "far", "class": "Door", "bbox": {"x1": right + 150, "x2": right + 240, "y1": TOP, "y2": TOP + 6}})
        shell = build_shell(payload)
        self.assertEqual([d.id for d in shell.doors], ["door-1"])

    def test_the_entrance_is_not_the_door_to_the_bathroom(self):
        payload = plan(4000, 4000, doors=[("east", 500, 900), ("west", 500, 900)])
        right, bottom = LEFT + 400, TOP + 400
        payload["rooms"] = [
            {"id": "room-1", "name": "Bedroom", "bbox": payload["room"]["bbox"]},
            {"id": "room-2", "name": "Bathroom", "bbox": {"x1": right + 6, "y1": TOP, "x2": right + 200, "y2": bottom}},
            {"id": "room-3", "name": "Hall", "bbox": {"x1": LEFT - 200, "y1": TOP, "x2": LEFT - 6, "y2": bottom}},
        ]
        shell = build_shell(payload)
        by_wall = {d.wall: d for d in shell.doors}
        self.assertEqual(by_wall["east"].leads_to, "Bathroom")
        self.assertTrue(by_wall["west"].is_main)
        self.assertFalse(by_wall["east"].is_main)

    def test_bad_requests_are_rejected(self):
        with self.assertRaises(InputError):
            build_shell({})
        with self.assertRaises(InputError):
            build_shell({"room": {"bbox": {"x1": 10, "y1": 10, "x2": 10, "y2": 50}}})
        with self.assertRaises(InputError):
            build_shell({"room": {"bbox": {"x1": "a", "y1": 0, "x2": 1, "y2": 1}}})


# --------------------------------------------------------------------------- #
# 3. the twelve rules, re-checked on every layout of every room
# --------------------------------------------------------------------------- #
class RuleComplianceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.results = {name: generate_bedroom_layouts(copy.deepcopy(payload)) for name, payload in ROOMS.items()}

    def each_valid_layout(self):
        for name, result in self.results.items():
            layouts = [l for l in layouts_of(result) if l["validation"]["valid"]]
            self.assertTrue(layouts, "{}: no valid layout".format(name))
            for layout in layouts:
                yield name, result, layout

    def test_every_room_gets_layouts_and_a_best_one(self):
        for name, result in self.results.items():
            layouts = layouts_of(result)
            self.assertGreaterEqual(len(layouts), 1, name)
            self.assertLessEqual(len(layouts), 6, name)
            self.assertEqual(result["bestLayout"], layouts[0]["layout"]["type"], name)
            types = [l["layout"]["type"] for l in layouts]
            self.assertEqual(len(types), len(set(types)), "{}: duplicate layout types".format(name))

    def test_furniture_stays_inside_the_room_and_never_overlaps(self):
        for name, _, layout in self.each_valid_layout():
            room, items = layout["room"], layout["furniture"]
            for index, item in enumerate(items):
                x0, y0, x1, y1 = item["bbox"]
                self.assertTrue(-1 <= x0 and -1 <= y0 and x1 <= room["width"] + 1 and y1 <= room["length"] + 1,
                                "{}: {} outside the room".format(name, item["id"]))
                for other in items[index + 1:]:
                    self.assertFalse(overlap(item["bbox"], other["bbox"]),
                                     "{}: {} overlaps {}".format(name, item["id"], other["id"]))

    def test_rule_3_nothing_stands_in_a_door_sweep_or_on_its_landing(self):
        for name, _, layout in self.each_valid_layout():
            for door in layout["openings"]["doors"]:
                zone = door_zone(layout["room"], door)
                for item in layout["furniture"]:
                    self.assertFalse(overlap(zone, item["bbox"]),
                                     "{}: {} blocks door {}".format(name, item["id"], door["id"]))

    def test_rule_3_a_wide_inward_door_sweeps_its_full_width(self):
        layout = layouts_of(self.results["wide_door"])[0]
        door = layout["openings"]["doors"][0]
        self.assertAlmostEqual(door["width"], 1200.0, delta=1)
        zone = door["clearance_zone"]
        self.assertAlmostEqual(zone[3] - zone[1], 1200.0, delta=1)       # not just the 900 mm landing

    def test_rule_5_enough_sides_of_the_bed_have_600_mm(self):
        for name, result, layout in self.each_valid_layout():
            _, clear = beside_bed(layout)
            usable = [side for side in ("lo", "hi") if clear[side] >= 599]
            self.assertGreaterEqual(len(usable), result["occupants"],
                                    "{}: {} side(s) usable for {} occupant(s): {}".format(
                                        name, len(usable), result["occupants"], clear))

    def test_rule_6_bedside_tables_touch_the_bed_at_the_pillow_end(self):
        for name, result, layout in self.each_valid_layout():
            bed = next(f for f in layout["furniture"] if f["type"] == "bed")
            tables = [f for f in layout["furniture"] if f["type"] == "bedside_table"]
            self.assertLessEqual(len(tables), result["occupants"], name)
            lo, hi = along(bed["wall"], bed["bbox"])
            for table in tables:
                self.assertEqual(table["wall"], bed["wall"], name)
                self.assertAlmostEqual(out_from(layout["room"], table["wall"], table["bbox"])[0], 0.0, delta=1)
                t_lo, t_hi = along(table["wall"], table["bbox"])
                self.assertTrue(abs(t_hi - lo) <= 1 or abs(t_lo - hi) <= 1,
                                "{}: {} does not touch the bed".format(name, table["id"]))

    def test_rule_7_storage_has_its_standing_room(self):
        for name, _, layout in self.each_valid_layout():
            for item in layout["furniture"]:
                if item["type"] == "wardrobe":
                    self.assertGreaterEqual(clear_in_front(layout, item), 749, "{}: wardrobe".format(name))
                if item["type"] == "dresser":
                    self.assertGreaterEqual(clear_in_front(layout, item), 699, "{}: drawers".format(name))

    def test_rule_8_the_bed_and_the_storage_can_be_walked_to(self):
        for name, _, layout in self.each_valid_layout():
            room = layout["room"]
            reached = raster_walk(layout)
            bed, clear = beside_bed(layout)
            wall = bed["wall"]
            lo, hi = along(wall, bed["bbox"])
            bed_length = out_from(room, wall, bed["bbox"])[1]
            sides = {"lo": band(room, wall, lo - 600, lo, bed_length), "hi": band(room, wall, hi, hi + 600, bed_length)}
            walkable = [side for side in ("lo", "hi") if clear[side] >= 599 and reached(sides[side])]
            self.assertTrue(walkable, "{}: no side of the bed can be walked to".format(name))
            for item in layout["furniture"]:
                if item["type"] in ("wardrobe", "dresser"):
                    i_lo, i_hi = along(item["wall"], item["bbox"])
                    depth = out_from(room, item["wall"], item["bbox"])[1]
                    front = band(room, item["wall"], i_lo, i_hi, 700, offset=depth)
                    self.assertTrue(reached(front), "{}: the {} cannot be walked to".format(name, item["type"]))
            self.assertTrue(layout["validation"]["circulation"]["valid"], name)
            self.assertGreaterEqual(layout["validation"]["circulation"]["corridor_width_mm"], 600, name)

    def test_rule_9_the_desk_keeps_its_chair_and_can_be_reached(self):
        seen_a_desk = False
        for name, _, layout in self.each_valid_layout():
            desks = [f for f in layout["furniture"] if f["type"] == "desk"]
            chairs = [f for f in layout["furniture"] if f["type"] == "desk_chair"]
            self.assertEqual(len(desks), len(chairs), name)
            for desk, chair in zip(desks, chairs):
                seen_a_desk = True
                room = layout["room"]
                self.assertAlmostEqual(out_from(room, desk["wall"], chair["bbox"])[0],
                                       out_from(room, desk["wall"], desk["bbox"])[1], delta=1,
                                       msg="{}: the chair is not at the desk".format(name))
                d_lo, d_hi = along(desk["wall"], desk["bbox"])
                behind = band(room, desk["wall"], d_lo, d_hi, 900, offset=out_from(room, desk["wall"], desk["bbox"])[1])
                self.assertTrue(raster_walk(layout)(behind), "{}: the desk cannot be walked to".format(name))
        self.assertTrue(seen_a_desk, "no test room produced a desk")

    def test_rule_10_nothing_tall_stands_in_front_of_a_window(self):
        for name, _, layout in self.each_valid_layout():
            for window in layout["openings"]["windows"]:
                front = band(layout["room"], window["wall"], window["position"],
                             window["position"] + window["width"], 600)
                for item in layout["furniture"]:
                    if item["height"] >= 1100 or item["height"] > window["sill_height"]:
                        self.assertFalse(overlap(front, item["bbox"]),
                                         "{}: {} blocks window {}".format(name, item["id"], window["id"]))

    def test_scores_are_reported_rule_by_rule_and_add_up(self):
        # the twelve rules keep their weights (100 in all) and a rule that does not apply leaves
        # the others at theirs; the rules total is converted to 90 and the extra rule, last, adds 10
        weights = {r["id"]: r["weight"] for r in rule_catalogue()}
        self.assertEqual(sum(weights[rule.id] for rule in RULES), 100)
        for name, _, layout in self.each_valid_layout():
            rules, scoring = layout["rules"], layout["scoring"]
            self.assertEqual([r["id"] for r in rules], [rule.id for rule in RULES] + ["R13"], name)
            self.assertEqual([r["extra"] for r in rules], [False] * len(RULES) + [True], name)
            score = layout["layout"]["score"]
            self.assertTrue(0 <= score <= 100, name)
            applies = [r for r in rules if r["status"] != "not_applicable"]
            for r in applies:
                self.assertAlmostEqual(r["max_points"], weights[r["id"]], delta=0.05, msg=name)
            # every figure on show is worked from the ones above it, so they add up exactly
            arranged = [r for r in applies if not r["extra"]]
            earned, possible = sum(r["points"] for r in arranged), sum(r["max_points"] for r in arranged)
            self.assertAlmostEqual(scoring["rules_earned"], earned, delta=1e-6, msg=name)
            self.assertAlmostEqual(scoring["rules_possible"], possible, delta=1e-6, msg=name)
            self.assertAlmostEqual(scoring["rules_score"], 100.0 * earned / possible, delta=0.05, msg=name)
            self.assertEqual(scoring["rules_max"], 90.0, name)
            self.assertAlmostEqual(scoring["rules_points"], 90.0 * earned / possible, delta=0.05, msg=name)
            self.assertAlmostEqual(scoring["rules_points"] + rules[-1]["points"], score, delta=1e-6, msg=name)
            self.assertEqual(scoring["total"], score, name)
            for rule in rules:
                self.assertTrue(rule["detail"], "{}: {} has no explanation".format(name, rule["id"]))
                self.assertLessEqual(rule["points"], rule["max_points"] + 0.05, name)

    def test_the_extra_rule_gives_10_for_the_most_furniture_and_5_for_one_piece_fewer(self):
        two_short = False
        for name, result in self.results.items():
            layouts = [l for l in layouts_of(result) if "rules" in l]
            if not layouts:
                continue
            most = max(len(l["furniture"]) for l in layouts)
            for layout in layouts:
                extra, count = layout["rules"][-1], len(layout["furniture"])
                self.assertEqual(extra["max_points"], 10.0, name)
                # below one piece fewer the points fall evenly, to 0 with no furniture
                expected = 10.0 if count == most else 5.0 * count / (most - 1)
                self.assertAlmostEqual(extra["points"], expected, delta=0.05, msg=name)
                two_short = two_short or count < most - 1
        self.assertTrue(two_short, "no test room has a layout two or more pieces short of the fullest")

    def test_the_furniture_mark_halves_for_one_piece_fewer_then_falls_evenly_to_nothing(self):
        self.assertEqual(furniture_mark(7, 7), 1.0)
        self.assertEqual(furniture_mark(6, 7), 0.5)
        self.assertAlmostEqual(furniture_mark(3, 7), 0.25)
        self.assertEqual(furniture_mark(0, 7), 0.0)
        self.assertEqual(furniture_mark(1, 1), 1.0)
        self.assertEqual(furniture_mark(0, 1), 0.0)

    def test_layouts_come_best_first(self):
        for name, result in self.results.items():
            scores = [l["layout"]["score"] for l in layouts_of(result) if l["validation"]["valid"]]
            self.assertEqual(scores, sorted(scores, reverse=True), name)

    # -- the scored rules move the right way ----------------------------------- #
    def by_wall(self, name):
        """The best layout for each headboard wall."""
        found = {}
        for layout in layouts_of(self.results[name]):
            bed = next(f for f in layout["furniture"] if f["type"] == "bed")
            found.setdefault(bed["wall"], layout)
        return found

    @staticmethod
    def rule(layout, rule_id):
        return next(r for r in layout["rules"] if r["id"] == rule_id)

    def test_rule_1_a_bed_facing_the_door_beats_one_with_the_door_behind_it(self):
        walls = self.by_wall("medium_double")       # the door is at the south end of the west wall
        self.assertGreater(self.rule(walls["east"], "R1")["score"], 0.9)
        self.assertLess(self.rule(walls["west"], "R1")["score"], 0.6)

    def test_rule_2_the_bed_beside_the_door_scores_lower_on_distance(self):
        walls = self.by_wall("medium_double")
        self.assertGreater(self.rule(walls["east"], "R2")["score"], self.rule(walls["west"], "R2")["score"])

    def test_rule_4_a_headboard_under_the_window_is_marked_down(self):
        walls = self.by_wall("medium_double")       # the window is on the north wall
        self.assertEqual(self.rule(walls["east"], "R4")["score"], 1.0)
        self.assertLess(self.rule(walls["north"], "R4")["score"], 0.6)
        self.assertEqual(self.results["medium_double"]["layouts"][0]["layout"]["type"], "bed_east_open")

    def test_rule_8_a_bed_that_cuts_the_room_in_two_is_marked_down(self):
        # across a 2.4 m room a 2 m bed leaves 400 mm at its foot: the far end of the room is lost
        across = [l for l in layouts_of(self.results["narrow"])
                  if l["validation"]["circulation"]["walkable_reached_ratio"] < 0.9]
        whole = [l for l in layouts_of(self.results["narrow"])
                 if l["validation"]["circulation"]["walkable_reached_ratio"] > 0.99]
        self.assertTrue(whole)
        for layout in across:
            self.assertLess(self.rule(layout, "R8")["score"], 0.8)
            self.assertLess(layout["layout"]["score"], whole[0]["layout"]["score"])


# --------------------------------------------------------------------------- #
# 4. behaviour
# --------------------------------------------------------------------------- #
class BehaviourTests(unittest.TestCase):
    def bed_of(self, result):
        return next(f for f in layouts_of(result)[0]["furniture"] if f["type"] == "bed")

    def test_rule_11_head_count_is_inferred_from_the_room_size(self):
        self.assertEqual(generate_bedroom_layouts(ROOMS["small_single"])["occupants"], 1)
        result = generate_bedroom_layouts(ROOMS["medium_double"])
        self.assertEqual((result["occupants"], result["occupantsSource"]), (2, "inferred"))

    def test_rule_11_bed_and_tables_follow_the_head_count(self):
        two = generate_bedroom_layouts(ROOMS["medium_double"])
        one = generate_bedroom_layouts(ROOMS["medium_single"])
        self.assertEqual(one["occupantsSource"], "provided")
        self.assertEqual(self.bed_of(two)["model"], "queen")
        self.assertEqual(self.bed_of(one)["model"], "double")
        count = lambda result: sum(f["type"] == "bedside_table" for f in layouts_of(result)[0]["furniture"])
        self.assertEqual((count(two), count(one)), (2, 1))

    def test_rule_11_a_small_room_gets_a_small_programme(self):
        result = generate_bedroom_layouts(ROOMS["box_room"])
        types = {f["type"] for f in layouts_of(result)[0]["furniture"]}
        self.assertEqual(self.bed_of(result)["model"], "single")
        self.assertNotIn("desk", types)
        self.assertNotIn("dresser", types)

    def test_rule_11_a_bigger_room_gets_a_bigger_bed(self):
        self.assertEqual(self.bed_of(generate_bedroom_layouts(ROOMS["large_master"]))["model"], "king")

    def test_furniture_can_be_excluded_or_asked_for(self):
        without = generate_bedroom_layouts(dict(ROOMS["medium_double"], excluded_furniture=["desk", "dresser"]))
        for layout in layouts_of(without):
            self.assertFalse({"desk", "desk_chair", "dresser"} & {f["type"] for f in layout["furniture"]})
        asked = generate_bedroom_layouts(dict(ROOMS["small_single"], optional_furniture=["desk"]))
        self.assertTrue(asked["programme"]["desk"])

    def test_bed_size_can_be_asked_for(self):
        result = generate_bedroom_layouts(dict(ROOMS["medium_double"], bed_size="double"))
        self.assertEqual(self.bed_of(result)["model"], "double")

    def test_two_people_in_a_room_too_small_is_reported_as_compromised(self):
        result = generate_bedroom_layouts(dict(ROOMS["small_single"], occupants=2))
        layouts = layouts_of(result)
        self.assertTrue(layouts)
        for layout in layouts:
            self.assertFalse(layout["validation"]["valid"])
            self.assertTrue(layout["validation"]["hard_constraint_violations"])

    def test_a_room_too_small_for_any_bed_gives_an_explained_error(self):
        result = generate_bedroom_layouts(plan(1800, 2100, doors=[("south", 100, 800)]))
        self.assertIsNone(result["bestLayout"])
        self.assertEqual(len(result["layouts"]), 1)
        self.assertIn("too small", result["layouts"][0]["error"])

    def test_a_room_with_no_door_skips_the_entrance_rules(self):
        result = generate_bedroom_layouts(plan(3200, 3600, windows=[("north", 800, 1500)]))
        layout = layouts_of(result)[0]
        status = {r["id"]: r["status"] for r in layout["rules"]}
        for rule_id in ("R1", "R2", "R3", "R8"):
            self.assertEqual(status[rule_id], "not_applicable")
        self.assertIsNone(layout["validation"]["circulation"])
        self.assertTrue(any("No door" in note for note in result["notes"]))

    def test_a_room_with_no_window_skips_the_window_rules(self):
        result = generate_bedroom_layouts(plan(3200, 3600, doors=[("south", 200, 900)]))
        status = {r["id"]: r["status"] for r in layouts_of(result)[0]["rules"]}
        self.assertEqual((status["R4"], status["R10"]), ("not_applicable", "not_applicable"))

    def test_the_same_request_always_gives_the_same_answer(self):
        def strip(result):
            result = copy.deepcopy(result)
            result["search"].pop("elapsed_seconds")
            return result
        for name in ("medium_double", "narrow", "large_master"):
            first = generate_bedroom_layouts(copy.deepcopy(ROOMS[name]))
            second = generate_bedroom_layouts(copy.deepcopy(ROOMS[name]))
            self.assertEqual(strip(first), strip(second), name)

    def test_generation_is_quick(self):
        for name, payload in ROOMS.items():
            started = time.perf_counter()
            generate_bedroom_layouts(payload)
            self.assertLess(time.perf_counter() - started, 5.0, name)

    def test_the_rule_catalogue_lists_all_twelve_and_the_furniture_rule(self):
        catalogue = rule_catalogue()
        self.assertEqual([r["id"] for r in catalogue], ["R%d" % n for n in range(1, 14)])
        self.assertEqual(sum(r["weight"] for r in catalogue[:12]), 100.0)
        self.assertEqual(catalogue[-1]["weight"], 10.0)
        self.assertEqual([r["extra"] for r in catalogue], [False] * 12 + [True])

    def test_the_result_has_the_shape_the_plan_viewer_draws(self):
        result = generate_bedroom_layouts(ROOMS["medium_double"])
        for key in ("roomId", "scaleSource", "doorsUsed", "windowsUsed", "notes", "layouts", "bestLayout"):
            self.assertIn(key, result)
        layout = layouts_of(result)[0]
        for key in ("room", "layout", "furniture", "validation", "explanation", "reason", "unplaced_furniture",
                    "scoring", "layout_selection", "openings"):
            self.assertIn(key, layout)
        self.assertEqual(set(layout["layout"]), {"type", "title", "score", "suitability_score"})
        for item in layout["furniture"]:
            for key in ("id", "type", "role", "x", "y", "width", "depth", "height", "rotation", "facing", "bbox",
                        "placement_strategy", "reasons"):
                self.assertIn(key, item)
            self.assertIn(item["facing"], ("north", "south", "east", "west"))
            self.assertEqual({"north": 0, "west": 90, "south": 180, "east": 270}[item["facing"]], item["rotation"])
        for door in layout["openings"]["doors"]:
            for key in ("id", "wall", "position", "width", "swing", "hinge", "is_main"):
                self.assertIn(key, door)


# --------------------------------------------------------------------------- #
# 5. the web service (skipped where FastAPI is not installed)
# --------------------------------------------------------------------------- #
try:
    from fastapi import HTTPException
    import api as service          # backend/bedroom_layout/api.py
except ImportError:                # the engine itself needs none of this
    service = None


@unittest.skipUnless(service, "FastAPI is not installed in this environment")
class ServiceTests(unittest.TestCase):
    def test_generate_all_returns_every_layout(self):
        result = service.generate_all(copy.deepcopy(ROOMS["medium_double"]))
        self.assertEqual(result["roomType"], "bedroom")
        self.assertEqual(result["bestLayout"], result["layouts"][0]["layout"]["type"])
        self.assertGreater(len(result["layouts"]), 1)

    def test_generate_returns_the_best_layout_only(self):
        result = service.generate(copy.deepcopy(ROOMS["medium_double"]))
        self.assertNotIn("layouts", result)
        self.assertEqual(result["layout"]["layout"]["type"], result["bestLayout"])

    def test_a_malformed_request_is_a_400(self):
        with self.assertRaises(HTTPException) as caught:
            service.generate_all({})
        self.assertEqual(caught.exception.status_code, 400)

    def test_a_room_too_small_is_a_422_on_generate(self):
        with self.assertRaises(HTTPException) as caught:
            service.generate(plan(1800, 2100, doors=[("south", 100, 800)]))
        self.assertEqual(caught.exception.status_code, 422)

    def test_rules_endpoint_lists_the_twelve_rules_and_the_furniture_rule(self):
        self.assertEqual(len(service.rules()["rules"]), 13)
        self.assertEqual(service.health(), {"status": "ok"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
