"""
Tests for the master-bedroom layout engine (standard library only - no pytest needed).

    cd backend/master_bedroom_layout
    python -m unittest master_bedroom_layout.tests.test_engine -v

Three levels are covered:

1. rules      - every returned layout is re-checked against the hard limits of
                the fifteen rules with geometry written here, independently of
                the engine's own checks, and the scored rules move the right way
2. behaviour  - occupants, preferences, the en-suite, fall-backs, determinism, speed
3. service    - the API wrapper (run with the service's venv; skipped without FastAPI)
"""

from __future__ import annotations

import copy
import os
import sys
import time
import unittest

if __package__ in (None, ""):  # allow running the file directly
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from master_bedroom_layout import RULES, InputError, generate_master_bedroom_layouts, rule_catalogue
from master_bedroom_layout.config import Config

PX = 10.0                 # millimetres per pixel used by the test plans
LEFT, TOP = 200.0, 150.0  # where the room sits on the imaginary image
C = Config().clearances
FLOOR = ("bed", "bedside_table", "wardrobe", "dressing_table", "desk", "desk_chair")


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
        "room": {"id": "room-1", "name": "Master Bedroom",
                 "bbox": {"x1": LEFT, "y1": TOP, "x2": right, "y2": bottom}},
        "detections": detections,
        "scale_m_per_px": PX / 1000.0,
    }
    payload.update(extra)
    return payload


def with_ensuite(payload, wall="east"):
    """Add a bathroom beyond `wall` and a living room everywhere else, so the second door reads as the en-suite."""
    box = payload["room"]["bbox"]
    bath = {"x1": box["x2"] + 1, "x2": box["x2"] + 250, "y1": box["y1"], "y2": box["y2"]}
    hall = {"x1": box["x1"], "x2": box["x2"], "y1": box["y2"] + 1, "y2": box["y2"] + 300}
    payload["rooms"] = [
        {"id": "room-1", "name": "Master Bedroom", "bbox": box},
        {"id": "room-2", "name": "Bathroom", "bbox": bath},
        {"id": "room-3", "name": "Hall", "bbox": hall},
    ]
    return payload


ROOMS = {
    "medium": plan(3800, 4500, doors=[("west", 100, 900)], windows=[("north", 750, 2300)]),
    "large": plan(5000, 4600, doors=[("south", 3800, 900)], windows=[("north", 1200, 2400), ("west", 1500, 1500)]),
    "ensuite": with_ensuite(plan(5000, 4600, doors=[("south", 3800, 900), ("east", 600, 800)],
                                 windows=[("north", 1200, 2400), ("west", 1500, 1500)])),
    "square": plan(3600, 3600, doors=[("east", 2500, 900)], windows=[("north", 900, 1500), ("west", 1000, 1500)]),
    "door_mid": plan(4000, 3500, doors=[("south", 1550, 900)], windows=[("north", 1000, 2000)]),
    "no_window": plan(3600, 4000, doors=[("south", 200, 900)]),
    "one_occupant": plan(3800, 4500, doors=[("west", 100, 900)], windows=[("north", 750, 2300)], occupants=1),
}
RESULTS = {}


def result_for(name):
    if name not in RESULTS:
        RESULTS[name] = generate_master_bedroom_layouts(copy.deepcopy(ROOMS[name]))
    return RESULTS[name]


def every_layout():
    for name in ROOMS:
        for layout in result_for(name)["layouts"]:
            yield name, layout


def overlap(a, b, tol=1.0):
    return a[0] < b[2] - tol and b[0] < a[2] - tol and a[1] < b[3] - tol and b[1] < a[3] - tol


def piece(layout, kind):
    return next((f for f in layout["furniture"] if f["type"] == kind), None)


def pieces(layout, kind):
    return [f for f in layout["furniture"] if f["type"] == kind]


def solid(layout):
    return [f for f in layout["furniture"] if f["type"] in FLOOR]


def in_front(item, depth):
    x0, y0, x1, y1 = item["bbox"]
    return {
        "north": (x0, y1, x1, y1 + depth), "south": (x0, y0 - depth, x1, y0),
        "east": (x1, y0, x1 + depth, y1), "west": (x0 - depth, y0, x0, y1),
    }[item["facing"]]


def inside(room, rect, tol=1.0):
    return rect[0] >= -tol and rect[1] >= -tol and rect[2] <= room["width"] + tol and rect[3] <= room["length"] + tol


def rule(layout, rule_id):
    return next(r for r in layout["rules"] if r["id"] == rule_id)


class RuleComplianceTests(unittest.TestCase):
    """Every layout of every test room, checked with geometry that does not come from the engine."""

    def test_every_room_gets_valid_layouts_and_a_best_one(self):
        for name in ROOMS:
            result = result_for(name)
            self.assertNotIn("error", result["layouts"][0], name)
            self.assertEqual(result["bestLayout"], result["layouts"][0]["layout"]["type"])
            for layout in result["layouts"]:
                self.assertTrue(layout["validation"]["valid"], (name, layout["validation"]["notes"]))

    def test_furniture_stays_inside_the_room_and_never_overlaps(self):
        for name, layout in every_layout():
            items = solid(layout)
            for i, a in enumerate(items):
                self.assertTrue(inside(layout["room"], a["bbox"]), (name, a["id"]))
                for b in items[i + 1:]:
                    self.assertFalse(overlap(a["bbox"], b["bbox"]), (name, a["id"], b["id"]))

    def test_rule_1_and_6_nothing_stands_where_a_door_opens(self):
        for name, layout in every_layout():
            for item in solid(layout):
                for door in layout["openings"]["doors"]:
                    self.assertFalse(overlap(item["bbox"], door["clearance_zone"]), (name, item["id"], door["id"]))

    def test_rule_2_both_sides_of_a_shared_bed_are_clear(self):
        for name, layout in every_layout():
            bed, room = piece(layout, "bed"), layout["room"]
            x0, y0, x1, y1 = bed["bbox"]
            along_x = bed["facing"] in ("north", "south")
            strips = [(x0 - C.bed_side_min, y0, x0, y1), (x1, y0, x1 + C.bed_side_min, y1)] if along_x \
                else [(x0, y0 - C.bed_side_min, x1, y0), (x0, y1, x1, y1 + C.bed_side_min)]
            free = 0
            for strip in strips:
                blocked = any(overlap(o["bbox"], strip) for o in solid(layout)
                              if o["type"] not in ("bed", "bedside_table"))
                free += inside(room, strip) and not blocked
            self.assertGreaterEqual(free, 1 if name == "one_occupant" else 2, name)

    def test_rule_4_a_bedside_table_touches_the_bed_for_every_sleeper(self):
        for name, layout in every_layout():
            bed = piece(layout, "bed")["bbox"]
            tables = pieces(layout, "bedside_table")
            wanted = 1 if name == "one_occupant" else 2
            self.assertTrue(1 <= len(tables) <= wanted, name)      # a table that would stand in a door is left out
            for table in tables:
                self.assertTrue(overlap(table["bbox"], bed, tol=-1.0), name)
        for name in ROOMS:
            best = result_for(name)["layouts"][0]
            self.assertEqual(len(pieces(best, "bedside_table")), 1 if name == "one_occupant" else 2, name)

    def test_rules_5_and_8_wardrobe_and_dressing_table_have_floor_in_front(self):
        for name, layout in every_layout():
            for kind, depth in (("wardrobe", C.wardrobe_front_min), ("dressing_table", C.drawer_front_min)):
                item = piece(layout, kind)
                if item is None:
                    continue
                front = in_front(item, depth)
                self.assertTrue(inside(layout["room"], front), (name, kind))
                for other in solid(layout):
                    if other["id"] != item["id"]:
                        self.assertFalse(overlap(other["bbox"], front), (name, kind, other["id"]))

    def test_rules_6_7_and_12_nothing_tall_stands_in_front_of_a_window(self):
        for name, layout in every_layout():
            for kind in ("wardrobe", "dressing_table"):
                item = piece(layout, kind)
                if item is not None:
                    for window in layout["openings"]["windows"]:
                        self.assertFalse(overlap(item["bbox"], window["access_zone"]), (name, kind, window["id"]))

    def test_rule_8_the_dressing_table_comes_with_a_stool_in_front_of_it(self):
        seen = 0
        for name, layout in every_layout():
            table, stool = piece(layout, "dressing_table"), piece(layout, "stool")
            self.assertEqual(table is None, stool is None, name)
            if table is not None:
                seen += 1
                self.assertTrue(overlap(stool["bbox"], in_front(table, C.drawer_front_min)), name)
        self.assertGreater(seen, 0)

    def test_rule_13_every_sleeper_has_a_reading_lamp_and_the_room_a_ceiling_light(self):
        for name, layout in every_layout():
            lamps = pieces(layout, "bedside_lamp")
            tables = pieces(layout, "bedside_table")
            self.assertEqual(len(lamps), len(tables), name)
            for lamp in lamps:
                self.assertTrue(any(overlap(lamp["bbox"], t["bbox"]) for t in tables), name)
                self.assertEqual(lamp["mounted"], "table")
            self.assertEqual(len(pieces(layout, "ceiling_light")), 1, name)
            self.assertEqual(piece(layout, "desk") is None, piece(layout, "desk_lamp") is None, name)
            self.assertEqual(piece(layout, "dressing_table") is None, piece(layout, "mirror_light") is None, name)

    def test_rules_3_and_15_everything_can_be_walked_to(self):
        for name, layout in every_layout():
            circulation = layout["validation"]["circulation"]
            self.assertTrue(circulation["valid"], name)
            self.assertEqual(circulation["unreachable_targets"], [], name)
            self.assertGreaterEqual(circulation["corridor_width_mm"], C.path_min, name)

    def test_scores_are_reported_rule_by_rule_and_add_up(self):
        # a rule that does not apply leaves the others at their default weights
        weights = {r["id"]: r["weight"] for r in rule_catalogue()}
        self.assertEqual(sum(weights.values()), 100)
        for name, layout in every_layout():
            self.assertEqual([r["id"] for r in layout["rules"]], [r.id for r in RULES])
            applies = [r for r in layout["rules"] if r["status"] != "not_applicable"]
            for r in applies:
                self.assertAlmostEqual(r["max_points"], weights[r["id"]], delta=0.05)
            earned, possible = sum(r["points"] for r in applies), sum(r["max_points"] for r in applies)
            self.assertAlmostEqual(100.0 * earned / possible, layout["layout"]["score"], delta=1.0)
            for r in layout["rules"]:
                self.assertTrue(r["detail"], (name, r["id"]))

    def test_layouts_come_best_first_with_distinct_names(self):
        for name in ROOMS:
            layouts = result_for(name)["layouts"]
            scores = [l["layout"]["score"] for l in layouts]
            self.assertEqual(scores, sorted(scores, reverse=True), name)
            types = [l["layout"]["type"] for l in layouts]
            self.assertEqual(len(types), len(set(types)), name)

    def test_rule_1_the_best_layout_keeps_the_headboard_off_the_window_wall(self):
        for name in ("medium", "large", "door_mid"):
            best = result_for(name)["layouts"][0]
            self.assertIn("solid wall", rule(best, "R1")["detail"], name)


class BehaviourTests(unittest.TestCase):
    def test_a_master_bedroom_is_planned_for_two_unless_told_otherwise(self):
        self.assertEqual(result_for("medium")["occupants"], 2)
        self.assertEqual(result_for("medium")["occupantsSource"], "inferred")
        self.assertEqual(result_for("one_occupant")["occupants"], 1)
        self.assertIn(piece(result_for("large")["layouts"][0], "bed")["model"], ("king", "queen"))

    def test_rule_15_the_en_suite_door_is_part_of_the_route(self):
        best = result_for("ensuite")["layouts"][0]
        doors = {d["id"]: d for d in best["openings"]["doors"]}
        self.assertTrue(doors["door-1"]["is_main"])
        self.assertEqual(doors["door-2"]["leads_to"], "Bathroom")
        self.assertIn("bathroom door", rule(best, "R15")["detail"])
        self.assertNotIn("bathroom door", rule(result_for("large")["layouts"][0], "R15")["detail"])
        for item in solid(best):
            self.assertFalse(overlap(item["bbox"], doors["door-2"]["clearance_zone"]), item["id"])

    def test_rule_14_preferences_are_honoured(self):
        base = copy.deepcopy(ROOMS["large"])
        with_desk = generate_master_bedroom_layouts(dict(base, required_furniture=["desk"]))["layouts"][0]
        self.assertIsNotNone(piece(with_desk, "desk"))
        without = generate_master_bedroom_layouts(dict(base, excluded_furniture=["dressing_table", "desk"]))
        best = without["layouts"][0]
        self.assertIsNone(piece(best, "dressing_table"))
        self.assertIsNone(piece(best, "desk"))
        self.assertEqual(rule(best, "R7")["status"], "not_applicable")
        self.assertEqual(rule(best, "R9")["status"], "not_applicable")
        king = generate_master_bedroom_layouts(dict(base, bed_size="king"))["layouts"][0]
        self.assertEqual(piece(king, "bed")["model"], "king")

    def test_rule_11_a_small_room_gets_no_optional_furniture(self):
        result = generate_master_bedroom_layouts(plan(3000, 3400, doors=[("south", 200, 900)]))
        self.assertFalse(result["programme"]["dresser"])
        self.assertFalse(result["programme"]["desk"])

    def test_a_room_too_small_for_two_is_reported_not_hidden(self):
        result = generate_master_bedroom_layouts(plan(2200, 2800, doors=[("east", 100, 800)]))
        best = result["layouts"][0]
        if "error" not in best:
            self.assertFalse(best["validation"]["valid"])
            self.assertTrue(best["validation"]["hard_constraint_violations"])
        tiny = generate_master_bedroom_layouts(plan(1800, 2100, doors=[("south", 100, 800)]))
        self.assertIn("too small", tiny["layouts"][0]["error"])

    def test_a_room_with_no_door_still_gets_a_layout(self):
        best = generate_master_bedroom_layouts(plan(3800, 4200, windows=[("north", 800, 1500)]))["layouts"][0]
        self.assertTrue(best["validation"]["valid"])
        for rule_id in ("R3", "R15"):
            self.assertEqual(rule(best, rule_id)["status"], "not_applicable")

    def test_bad_requests_are_rejected(self):
        for payload in ({}, {"room": {}}, {"room": {"bbox": {"x1": 0, "y1": 0, "x2": 0, "y2": 10}}}):
            self.assertRaises(InputError, generate_master_bedroom_layouts, payload)

    def test_the_same_request_always_gives_the_same_answer(self):
        first = generate_master_bedroom_layouts(copy.deepcopy(ROOMS["ensuite"]))
        second = generate_master_bedroom_layouts(copy.deepcopy(ROOMS["ensuite"]))
        for result in (first, second):
            result["search"].pop("elapsed_seconds")
        self.assertEqual(first, second)

    def test_generation_is_quick(self):
        started = time.perf_counter()
        generate_master_bedroom_layouts(copy.deepcopy(ROOMS["ensuite"]))
        self.assertLess(time.perf_counter() - started, 8.0)

    def test_the_rule_catalogue_lists_all_fifteen(self):
        catalogue = rule_catalogue()
        self.assertEqual([r["id"] for r in catalogue], ["R%d" % n for n in range(1, 16)])
        self.assertTrue(all(r["rule"] and r["method"] for r in catalogue))

    def test_the_result_has_the_shape_the_plan_viewer_draws(self):
        result = result_for("large")
        for key in ("roomId", "roomType", "scaleSource", "scaleMmPerPx", "doorsUsed", "windowsUsed", "notes",
                    "layouts", "bestLayout", "occupants", "occupantsSource", "programme"):
            self.assertIn(key, result)
        self.assertEqual(result["roomType"], "master_bedroom")
        layout = result["layouts"][0]
        for key in ("room", "layout", "furniture", "validation", "explanation", "reason", "unplaced_furniture",
                    "scoring", "rules", "layout_selection", "openings"):
            self.assertIn(key, layout)
        for item in layout["furniture"]:
            for key in ("id", "type", "role", "x", "y", "width", "depth", "rotation", "facing", "wall", "bbox",
                        "mounted", "reasons"):
                self.assertIn(key, item)
            self.assertIn(item["rotation"], (0, 90, 180, 270))


try:
    from fastapi import HTTPException

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    import api as service
except ImportError:                # the engine itself needs none of this
    service = None


@unittest.skipUnless(service, "FastAPI is not installed in this environment")
class ServiceTests(unittest.TestCase):
    def test_generate_all_and_generate(self):
        everything = service.generate_all(copy.deepcopy(ROOMS["medium"]))
        self.assertEqual(everything["roomType"], "master_bedroom")
        best = service.generate(copy.deepcopy(ROOMS["medium"]))
        self.assertEqual(best["layout"]["layout"]["type"], everything["bestLayout"])

    def test_errors(self):
        with self.assertRaises(HTTPException) as caught:
            service.generate_all({})
        self.assertEqual(caught.exception.status_code, 400)
        with self.assertRaises(HTTPException) as caught:
            service.generate(plan(1800, 2100, doors=[("south", 100, 800)]))
        self.assertEqual(caught.exception.status_code, 422)

    def test_rules_and_health(self):
        self.assertEqual(len(service.rules()["rules"]), 15)
        self.assertEqual(service.health(), {"status": "ok"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
