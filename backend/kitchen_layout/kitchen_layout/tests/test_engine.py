"""
Tests for the kitchen layout engine (standard library only - no pytest needed).

    cd backend/kitchen_layout
    python -m unittest kitchen_layout.tests.test_engine -v

Four levels are covered:

1. shapes     - the counter runs each kitchen shape is built from
2. rules      - every returned layout is re-checked against the hard limits of
                the twelve rules with geometry written here, independently of
                the engine's own checks, and the scored rules move the right way
3. behaviour  - appliance sizes, the dining table, fall-backs, determinism, speed
4. service    - the API wrapper (run with the service's venv; skipped without FastAPI)
"""

from __future__ import annotations

import copy
import math
import os
import sys
import time
import unittest

if __package__ in (None, ""):  # allow running the file directly
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from kitchen_layout import RULES, InputError, generate_kitchen_layouts, rule_catalogue
from kitchen_layout.config import Config
from kitchen_layout.floorplan import build_shell
from kitchen_layout.rules import FURNITURE_RULE, furniture_mark
from kitchen_layout.runs import build_arrangements

PX = 10.0                 # millimetres per pixel used by the test plans
LEFT, TOP = 200.0, 150.0  # where the room sits on the imaginary image


def plan(width, length, doors=(), windows=(), **extra):
    """A request for a room given in millimetres. doors / windows: (wall, position_mm, width_mm)."""
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

    detections = [{"id": "door-%d" % (i + 1), "class": "Door", "bbox": box(d[0], d[1], d[2], 6)}
                  for i, d in enumerate(doors)]
    detections += [{"id": "win-%d" % (i + 1), "class": "Window", "bbox": box(w[0], w[1], w[2], 14)}
                   for i, w in enumerate(windows)]
    payload = {
        "room": {"id": "room-1", "name": "Kitchen", "bbox": {"x1": LEFT, "y1": TOP, "x2": right, "y2": bottom}},
        "detections": detections,
        "scale_m_per_px": PX / 1000.0,
    }
    payload.update(extra)
    return payload


ROOMS = {
    "family": plan(4740, 3790, doors=[("east", 2700, 890)], windows=[("south", 2450, 1520), ("west", 1290, 1520)]),
    "small": plan(2400, 3000, doors=[("south", 100, 800)], windows=[("north", 600, 1200)]),
    "narrow": plan(2100, 3600, doors=[("south", 650, 800)], windows=[("north", 450, 1200)]),
    "medium": plan(3200, 3600, doors=[("east", 200, 900)], windows=[("north", 1000, 1200)]),
    "two_doors": plan(5200, 4200, doors=[("south", 300, 900), ("north", 4000, 900)], windows=[("west", 1200, 1800)]),
    "wide": plan(5000, 2600, doors=[("west", 1500, 900)], windows=[("north", 1800, 1500)]),
    "door_mid": plan(3600, 3200, doors=[("south", 1350, 900)], windows=[("north", 1200, 1200)]),
    "corridor": plan(1700, 4000, doors=[("south", 450, 800)], windows=[("north", 250, 1200)]),
    "big_square": plan(5500, 5500, doors=[("south", 2300, 900)],
                       windows=[("north", 1500, 2400), ("east", 2000, 1500)]),
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


def one(layout, kind):
    return next(f for f in layout["furniture"] if f["type"] == kind)


def clear_in_front(layout, item, line=None):
    """Clear floor in front of a unit, from its own front or from the worktop line."""
    room, wall = layout["room"], item["wall"]
    lo, hi = along(wall, item["bbox"])
    far = out_from(room, wall, item["bbox"])[1] if line is None else line
    room_depth = room["length"] if wall in ("north", "south") else room["width"]
    clear = room_depth - far
    front = band(room, wall, lo, hi, clear, offset=far)
    for other in layout["furniture"]:
        if other["id"] != item["id"] and overlap(front, other["bbox"]):
            clear = min(clear, out_from(room, wall, other["bbox"])[0] - far)
    return clear


def worktop_beside(layout, item):
    """Worktop touching a unit on each side along its wall (0 where there is none)."""
    lo, hi = along(item["wall"], item["bbox"])
    sides = [0.0, 0.0]
    for other in layout["furniture"]:
        if other["wall"] != item["wall"] or other["type"] not in ("counter", "utensil_drawers"):
            continue
        o_lo, o_hi = along(other["wall"], other["bbox"])
        if abs(o_hi - lo) <= 1:
            sides[0] = o_hi - o_lo
        if abs(o_lo - hi) <= 1:
            sides[1] = o_hi - o_lo
    return sides


def raster_walk(layout, width=600.0, cell=50.0):
    """Flood fill on a plain pixel grid - a second opinion on the engine's exact walkability map."""
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
# 1. shapes
# --------------------------------------------------------------------------- #
class ShapeTests(unittest.TestCase):
    def shapes(self, payload):
        shell = build_shell(payload)
        config = Config()
        zones = [d.keep_clear(shell.room, config.clearances.door_entry_depth) for d in shell.doors]
        return build_arrangements(shell.room, zones, config.clearances, config.rooms)

    def test_an_open_room_takes_every_shape(self):
        kinds = [a.kind for a in self.shapes(plan(4000, 4000))]
        self.assertEqual(kinds.count("one_wall"), 4)
        self.assertEqual(kinds.count("l_shaped"), 4)
        self.assertEqual(kinds.count("u_shaped"), 4)
        self.assertEqual(kinds.count("galley"), 2)

    def test_a_door_breaks_the_shapes_that_would_cross_it(self):
        # a door in the middle of the south wall: no U with the south wall as its middle run
        shapes = self.shapes(plan(4000, 4000, doors=[("south", 1550, 900)]))
        self.assertFalse([a for a in shapes if a.kind == "u_shaped" and a.walls[1] == "south"])
        # and no run crosses the floor the door opens over
        zone = (1550.0, 0.0, 2450.0, 900.0)
        for shape in shapes:
            for piece in shape.pieces():
                strip = band({"width": 4000.0, "length": 4000.0}, piece.wall, piece.t0, piece.t1, 600.0)
                self.assertFalse(overlap(strip, zone), shape.key)

    def test_a_room_too_narrow_has_no_galley(self):
        self.assertFalse([a for a in self.shapes(plan(2000, 4000)) if a.kind == "galley" and "west" in a.walls])

    def test_a_chain_measures_round_the_corner(self):
        shape = next(a for a in self.shapes(plan(4000, 3000)) if a.key == "l_shaped_north_east")
        chain = shape.chains[0]
        self.assertAlmostEqual(chain.length, 3400 + 600 + 2400)
        self.assertEqual([p.corner for p in chain.pieces], [False, True, False])
        self.assertAlmostEqual(chain.corner_gap(0, 3000), 400)


# --------------------------------------------------------------------------- #
# 2. the twelve rules, re-checked on every layout of every room
# --------------------------------------------------------------------------- #
class RuleComplianceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.results = {name: generate_kitchen_layouts(copy.deepcopy(payload)) for name, payload in ROOMS.items()}

    def each_layout(self):
        for name, result in self.results.items():
            layouts = [l for l in layouts_of(result) if l["validation"]["valid"]]
            self.assertTrue(layouts, "{}: no valid layout".format(name))
            for layout in layouts:
                yield name, layout

    def test_every_room_gets_layouts_and_a_best_one(self):
        for name, result in self.results.items():
            layouts = layouts_of(result)
            self.assertTrue(1 <= len(layouts) <= 6, name)
            self.assertEqual(result["bestLayout"], layouts[0]["layout"]["type"], name)
            types = [l["layout"]["type"] for l in layouts]
            self.assertEqual(len(types), len(set(types)), name)

    def test_every_kitchen_has_a_sink_a_stove_a_refrigerator_and_utensil_drawers(self):
        for name, layout in self.each_layout():
            kinds = [f["type"] for f in layout["furniture"]]
            for kind in ("sink", "stove", "fridge", "utensil_drawers"):
                self.assertEqual(kinds.count(kind), 1, "{}: {}".format(name, kind))

    def test_units_stay_inside_the_room_and_never_overlap(self):
        for name, layout in self.each_layout():
            room, items = layout["room"], layout["furniture"]
            for index, item in enumerate(items):
                x0, y0, x1, y1 = item["bbox"]
                self.assertTrue(-1 <= x0 and -1 <= y0 and x1 <= room["width"] + 1 and y1 <= room["length"] + 1,
                                "{}: {} outside the room".format(name, item["id"]))
                for other in items[index + 1:]:
                    self.assertFalse(overlap(item["bbox"], other["bbox"]),
                                     "{}: {} overlaps {}".format(name, item["id"], other["id"]))

    def test_nothing_stands_where_a_door_opens(self):
        for name, layout in self.each_layout():
            for door in layout["openings"]["doors"]:
                zone = door_zone(layout["room"], door)
                for item in layout["furniture"]:
                    self.assertFalse(overlap(zone, item["bbox"]), "{}: {}".format(name, item["id"]))

    def test_rule_2_and_3_a_preparation_worktop_lies_beside_the_sink_never_the_stove(self):
        for name, layout in self.each_layout():
            sink, stove = one(layout, "sink"), one(layout, "stove")
            if sink["wall"] == stove["wall"]:
                s_lo, s_hi = along(sink["wall"], sink["bbox"])
                c_lo, c_hi = along(stove["wall"], stove["bbox"])
                self.assertGreaterEqual(max(c_lo - s_hi, s_lo - c_hi), 599, "{}: sink hard against stove".format(name))
            prep = [f for f in layout["furniture"] if f["role"] == "prep counter"]
            self.assertTrue(prep, "{}: no preparation worktop".format(name))

    def test_rule_5_the_stove_has_worktop_beside_it_and_none_of_it_is_the_refrigerator(self):
        for name, layout in self.each_layout():
            stove, fridge = one(layout, "stove"), one(layout, "fridge")
            self.assertGreaterEqual(max(worktop_beside(layout, stove)), 299, name)
            if stove["wall"] == fridge["wall"]:
                c_lo, c_hi = along(stove["wall"], stove["bbox"])
                f_lo, f_hi = along(fridge["wall"], fridge["bbox"])
                self.assertGreaterEqual(max(f_lo - c_hi, c_lo - f_hi), 299, "{}: stove against fridge".format(name))

    def test_rule_6_the_refrigerator_door_has_floor_to_open(self):
        doors = {"compact": 600, "single door": 700, "double door": 450}
        for name, layout in self.each_layout():
            fridge = one(layout, "fridge")
            self.assertGreaterEqual(clear_in_front(layout, fridge), doors[fridge["model"]] - 1, name)

    def test_rule_8_utensil_drawers_stand_beside_the_stove(self):
        for name, layout in self.each_layout():
            stove, drawers = one(layout, "stove"), one(layout, "utensil_drawers")
            self.assertEqual(stove["wall"], drawers["wall"], name)
            c_lo, c_hi = along(stove["wall"], stove["bbox"])
            d_lo, d_hi = along(drawers["wall"], drawers["bbox"])
            self.assertTrue(abs(d_hi - c_lo) <= 1 or abs(d_lo - c_hi) <= 1, name)

    def test_rule_9_every_station_has_its_working_floor_and_can_be_walked_to(self):
        for name, layout in self.each_layout():
            room = layout["room"]
            reached = raster_walk(layout)
            for kind in ("sink", "stove", "fridge"):
                item = one(layout, kind)
                on_run = item["placement_strategy"].startswith("run")
                self.assertGreaterEqual(clear_in_front(layout, item, 600.0 if on_run else None), 899,
                                        "{}: {}".format(name, kind))
                lo, hi = along(item["wall"], item["bbox"])
                front = band(room, item["wall"], lo, hi, 900, offset=out_from(room, item["wall"], item["bbox"])[1])
                self.assertTrue(reached(front), "{}: the {} cannot be walked to".format(name, kind))

    def test_rule_10_people_at_the_table_are_off_the_working_floor(self):
        seen_a_table = False
        for name, layout in self.each_layout():
            tables = [f for f in layout["furniture"] if f["type"] == "dining_table"]
            chairs = [f for f in layout["furniture"] if f["type"] == "dining_chair"]
            for table in tables:
                seen_a_table = True
                self.assertEqual(len(chairs), int(table["model"].split("-")[0]), name)
                for seat in [table] + chairs:
                    for unit in layout["furniture"]:
                        if unit["type"] in ("counter", "sink", "stove", "utensil_drawers"):
                            lo, hi = along(unit["wall"], unit["bbox"])
                            aisle = band(layout["room"], unit["wall"], lo, hi, 900, offset=600)
                            self.assertFalse(overlap(aisle, seat["bbox"]),
                                             "{}: {} in front of {}".format(name, seat["id"], unit["id"]))
        self.assertTrue(seen_a_table, "no test room produced a dining table")

    def test_rule_12_the_refrigerator_never_stands_in_front_of_a_window(self):
        for name, layout in self.each_layout():
            fridge = one(layout, "fridge")
            for window in layout["openings"]["windows"]:
                front = band(layout["room"], window["wall"], window["position"],
                             window["position"] + window["width"], 600)
                self.assertFalse(overlap(front, fridge["bbox"]), name)

    def test_the_work_triangle_is_reported_between_the_three_fronts(self):
        for name, layout in self.each_layout():
            triangle = layout["work_triangle"]
            a, b, c = triangle["points"]
            self.assertAlmostEqual(math.dist(a, b), triangle["legs_mm"]["sink_stove"], delta=2, msg=name)
            self.assertAlmostEqual(sum(triangle["legs_mm"].values()), triangle["perimeter_mm"], delta=3, msg=name)

    def test_scores_are_reported_rule_by_rule_and_add_up(self):
        # the rules keep their weights (100 in all) and a rule that does not apply leaves the
        # others at theirs; the rules total is converted to 90 and the extra rule, last, adds 10
        weights = {r["id"]: r["weight"] for r in rule_catalogue()}
        self.assertEqual(sum(weights[rule.id] for rule in RULES), 100)
        for name, layout in self.each_layout():
            rules, scoring, score = layout["rules"], layout["scoring"], layout["layout"]["score"]
            self.assertEqual([r["id"] for r in rules], [rule.id for rule in RULES] + [FURNITURE_RULE.id], name)
            self.assertEqual([r["extra"] for r in rules], [False] * len(RULES) + [True], name)
            self.assertTrue(0 <= score <= 100, name)
            applies = [r for r in rules if r["status"] != "not_applicable"]
            for r in applies:
                self.assertAlmostEqual(r["max_points"], weights[r["id"]], delta=0.05, msg=name)
            # every figure on show is worked from the ones above it, so they add up exactly
            arranged = [r for r in applies if not r["extra"]]
            earned, possible = sum(r["points"] for r in arranged), sum(r["max_points"] for r in arranged)
            self.assertAlmostEqual(scoring["rules_earned"], earned, delta=1e-6, msg=name)
            self.assertAlmostEqual(scoring["rules_possible"], possible, delta=1e-6, msg=name)
            self.assertEqual(scoring["rules_max"], 90.0, name)
            self.assertAlmostEqual(scoring["rules_points"], 90.0 * earned / possible, delta=0.05, msg=name)
            self.assertAlmostEqual(scoring["rules_points"] + rules[-1]["points"], score, delta=1e-6, msg=name)
            self.assertEqual(scoring["total"], score, name)
            for rule in rules:
                self.assertTrue(rule["detail"], "{}: {}".format(name, rule["id"]))

    def test_the_extra_rule_gives_10_for_the_most_furniture_and_5_for_one_piece_fewer(self):
        for name, result in self.results.items():
            layouts = [l for l in layouts_of(result) if "rules" in l]
            if not layouts:
                continue
            counts = [len(l["furniture"]) for l in layouts]
            most = max(counts)
            for layout, count in zip(layouts, counts):
                extra = layout["rules"][-1]
                self.assertEqual(extra["max_points"], 10.0, name)
                # below one piece fewer the points fall evenly, to 0 with no furniture
                expected = 10.0 if count == most else 5.0 * count / (most - 1)
                self.assertAlmostEqual(extra["points"], expected, delta=0.05, msg=name)

    def test_the_furniture_mark_halves_for_one_piece_fewer_then_falls_evenly_to_nothing(self):
        self.assertEqual(furniture_mark(7, 7), 1.0)
        self.assertEqual(furniture_mark(6, 7), 0.5)
        self.assertAlmostEqual(furniture_mark(3, 7), 0.25)
        self.assertEqual(furniture_mark(0, 7), 0.0)
        self.assertEqual(furniture_mark(1, 1), 1.0)
        self.assertEqual(furniture_mark(0, 1), 0.0)

    def test_layouts_come_best_first(self):
        for name, result in self.results.items():
            scores = [l["layout"]["score"] for l in layouts_of(result)]
            self.assertEqual(scores, sorted(scores, reverse=True), name)

    @staticmethod
    def rule(layout, rule_id):
        return next(r for r in layout["rules"] if r["id"] == rule_id)

    def test_rule_1_the_best_kitchen_puts_the_sink_under_a_window(self):
        best = layouts_of(self.results["family"])[0]
        self.assertIn("under a window", self.rule(best, "R1")["detail"])
        self.assertEqual(self.rule(best, "R1")["score"], 1.0)

    def test_rule_7_a_galley_with_a_900_mm_aisle_is_marked_down_for_open_doors(self):
        galley = [l for l in layouts_of(self.results["narrow"]) if l["layout"]["kind"] == "galley"]
        roomy = [l for l in layouts_of(self.results["narrow"]) if l["layout"]["kind"] == "l_shaped"]
        self.assertTrue(galley and roomy)
        self.assertLess(self.rule(galley[0], "R7")["score"], 0.5)
        self.assertGreater(self.rule(roomy[0], "R7")["score"], self.rule(galley[0], "R7")["score"])


# --------------------------------------------------------------------------- #
# 3. behaviour
# --------------------------------------------------------------------------- #
class BehaviourTests(unittest.TestCase):
    def test_rule_12_appliances_are_sized_to_the_room(self):
        sizes = lambda name: generate_kitchen_layouts(ROOMS[name])["programme"]["appliance_sizes"][0]
        self.assertEqual((sizes("corridor"), sizes("medium"), sizes("family")), ("compact", "standard", "large"))

    def test_rule_12_a_shape_too_tight_falls_back_to_smaller_appliances(self):
        result = generate_kitchen_layouts(ROOMS["narrow"])
        self.assertEqual(result["programme"]["appliance_sizes"][0], "standard")
        self.assertIn("compact", {l["programme"]["appliance_size"] for l in layouts_of(result)})

    def test_a_dining_table_is_only_tried_in_a_room_big_enough(self):
        self.assertFalse(generate_kitchen_layouts(ROOMS["small"])["diningTable"])
        family = generate_kitchen_layouts(ROOMS["family"])
        self.assertTrue(family["diningTable"])
        self.assertEqual(family["diningTableSource"], "inferred")

    def test_a_dining_table_can_be_ruled_out_or_asked_for(self):
        without = generate_kitchen_layouts(dict(ROOMS["family"], dining_table=False))
        for layout in layouts_of(without):
            self.assertFalse([f for f in layout["furniture"] if f["type"].startswith("dining")])
        asked = generate_kitchen_layouts(dict(ROOMS["medium"], dining_table=True))
        self.assertEqual(asked["diningTableSource"], "provided")
        best = layouts_of(asked)[0]                 # asked for, so a layout that seats it comes first
        self.assertTrue([f for f in best["furniture"] if f["type"] == "dining_table"])

    def test_a_table_that_does_not_fit_is_left_out_and_reported(self):
        result = generate_kitchen_layouts(dict(ROOMS["corridor"], dining_table=True))
        for layout in layouts_of(result):
            self.assertFalse([f for f in layout["furniture"] if f["type"] == "dining_table"])
            self.assertEqual([u["type"] for u in layout["unplaced_furniture"]], ["dining_table"])
            status = {r["id"]: r["status"] for r in layout["rules"]}
            self.assertEqual(status["R10"], "not_applicable")

    def test_a_room_too_small_gives_an_explained_error(self):
        result = generate_kitchen_layouts(plan(1500, 1800, doors=[("south", 300, 800)]))
        self.assertIsNone(result["bestLayout"])
        self.assertIn("error", result["layouts"][0])

    def test_a_room_with_no_door_or_window_still_gets_a_kitchen(self):
        result = generate_kitchen_layouts(plan(3000, 3400))
        layout = layouts_of(result)[0]
        self.assertIsNone(layout["validation"]["circulation"])
        self.assertEqual({r["id"]: r["status"] for r in layout["rules"]}["R7"], "not_applicable")

    def test_bad_requests_are_rejected(self):
        with self.assertRaises(InputError):
            generate_kitchen_layouts({})

    def test_the_same_request_always_gives_the_same_answer(self):
        def strip(result):
            result = copy.deepcopy(result)
            result["search"].pop("elapsed_seconds")
            return result
        for name in ("family", "small", "two_doors"):
            self.assertEqual(strip(generate_kitchen_layouts(copy.deepcopy(ROOMS[name]))),
                             strip(generate_kitchen_layouts(copy.deepcopy(ROOMS[name]))), name)

    def test_generation_is_quick(self):
        for name, payload in ROOMS.items():
            started = time.perf_counter()
            generate_kitchen_layouts(payload)
            self.assertLess(time.perf_counter() - started, 5.0, name)

    def test_the_rule_catalogue_lists_all_twelve_and_the_furniture_rule(self):
        catalogue = rule_catalogue()
        self.assertEqual([r["id"] for r in catalogue], ["R%d" % n for n in range(1, 14)])
        self.assertEqual(sum(r["weight"] for r in catalogue[:-1]), 100)
        self.assertEqual(catalogue[-1]["weight"], 10.0)
        self.assertEqual([r["extra"] for r in catalogue], [False] * 12 + [True])

    def test_the_result_has_the_shape_the_plan_viewer_draws(self):
        result = generate_kitchen_layouts(ROOMS["family"])
        for key in ("roomId", "scaleSource", "doorsUsed", "windowsUsed", "notes", "layouts", "bestLayout"):
            self.assertIn(key, result)
        layout = layouts_of(result)[0]
        for key in ("room", "layout", "furniture", "validation", "explanation", "reason", "unplaced_furniture",
                    "scoring", "layout_selection", "openings", "work_triangle"):
            self.assertIn(key, layout)
        for item in layout["furniture"]:
            for key in ("id", "type", "role", "x", "y", "width", "depth", "height", "rotation", "facing", "bbox",
                        "placement_strategy", "reasons"):
                self.assertIn(key, item)
            self.assertEqual({"north": 0, "west": 90, "south": 180, "east": 270}[item["facing"]], item["rotation"])


# --------------------------------------------------------------------------- #
# 4. the web service (skipped where FastAPI is not installed)
# --------------------------------------------------------------------------- #
try:
    from fastapi import HTTPException
    import api as service          # backend/kitchen_layout/api.py
except ImportError:                # the engine itself needs none of this
    service = None


@unittest.skipUnless(service, "FastAPI is not installed in this environment")
class ServiceTests(unittest.TestCase):
    def test_generate_all_and_generate(self):
        everything = service.generate_all(copy.deepcopy(ROOMS["family"]))
        self.assertEqual(everything["roomType"], "kitchen")
        best = service.generate(copy.deepcopy(ROOMS["family"]))
        self.assertEqual(best["layout"]["layout"]["type"], everything["bestLayout"])

    def test_errors(self):
        with self.assertRaises(HTTPException) as caught:
            service.generate_all({})
        self.assertEqual(caught.exception.status_code, 400)
        with self.assertRaises(HTTPException) as caught:
            service.generate(plan(1500, 1800, doors=[("south", 300, 800)]))
        self.assertEqual(caught.exception.status_code, 422)

    def test_rules_and_health(self):
        self.assertEqual(len(service.rules()["rules"]), 13)
        self.assertEqual(service.health(), {"status": "ok"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
