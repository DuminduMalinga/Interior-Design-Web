"""
Tests for the dining-area layout engine (standard library only - no pytest needed).

    cd backend/dining_layout
    python -m unittest dining_layout.tests.test_engine -v

Three levels are covered:

1. rules      - every returned layout is re-checked against the hard limits of
                the twelve rules with geometry written here, independently of
                the engine's own checks, and the scored rules move the right way
2. behaviour  - table sizes, occupants, fall-backs, the kitchen, determinism, speed
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

from dining_layout import RULES, InputError, generate_dining_layouts, rule_catalogue
from dining_layout.config import Config

PX = 10.0                 # millimetres per pixel used by the test plans
LEFT, TOP = 200.0, 150.0  # where the room sits on the imaginary image
C = Config().clearances


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
        "room": {"id": "room-1", "name": "Dining Room", "bbox": {"x1": LEFT, "y1": TOP, "x2": right, "y2": bottom}},
        "detections": detections,
        "scale_m_per_px": PX / 1000.0,
    }
    payload.update(extra)
    return payload


ROOMS = {
    "square": plan(3600, 3600, doors=[("south", 300, 900)], windows=[("north", 1200, 1200)]),
    "small": plan(2400, 2600, doors=[("south", 100, 800)], windows=[("north", 600, 1200)]),
    "long": plan(3000, 5200, doors=[("south", 1050, 900)], windows=[("north", 900, 1200), ("east", 2000, 1500)]),
    "through": plan(4200, 3800, doors=[("west", 300, 900), ("east", 2700, 900)], windows=[("north", 1500, 1500)]),
    "large": plan(5000, 4500, doors=[("south", 2000, 900)], windows=[("north", 1500, 2000), ("west", 1500, 1500)]),
    "no_window": plan(3600, 3200, doors=[("east", 300, 900)]),
    "six_asked": plan(3200, 3000, doors=[("south", 100, 800)], seats=6),
    "entertaining": plan(5200, 4200, doors=[("south", 300, 900)], windows=[("north", 1500, 2000)],
                         occupants=6, use="entertaining"),
}
RESULTS = {}


def result_for(name):
    if name not in RESULTS:
        RESULTS[name] = generate_dining_layouts(copy.deepcopy(ROOMS[name]))
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


def grown(layout, depth):
    """The table grown by `depth` on every side that has a chair."""
    x0, y0, x1, y1 = piece(layout, "dining_table")["bbox"]
    sides = {chair["wall"] for chair in pieces(layout, "dining_chair")}
    return (x0 - depth * ("west" in sides), y0 - depth * ("south" in sides),
            x1 + depth * ("east" in sides), y1 + depth * ("north" in sides))


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

    def test_every_layout_has_a_table_its_chairs_and_a_light(self):
        for name, layout in every_layout():
            self.assertIsNotNone(piece(layout, "dining_table"), name)
            self.assertEqual(len(pieces(layout, "dining_chair")), layout["table"]["seats"], name)
            self.assertIsNotNone(piece(layout, "pendant_light"), name)

    def test_rule_2_there_is_room_to_pull_every_chair_out(self):
        for name, layout in every_layout():
            zone = grown(layout, C.chair_pull_min)
            self.assertTrue(inside(layout["room"], zone), name)
            board = piece(layout, "sideboard")
            if board is not None:
                self.assertFalse(overlap(board["bbox"], zone), name)

    def test_rule_5_chairs_sit_at_the_table_without_overlapping(self):
        for name, layout in every_layout():
            table = piece(layout, "dining_table")["bbox"]
            chairs = pieces(layout, "dining_chair")
            for i, chair in enumerate(chairs):
                self.assertTrue(inside(layout["room"], chair["bbox"]), name)
                self.assertTrue(overlap(chair["bbox"], table, tol=-1.0), (name, "chair not at the table"))
                self.assertFalse(overlap(chair["bbox"], table), name)
                for other in chairs[i + 1:]:
                    self.assertFalse(overlap(chair["bbox"], other["bbox"]), name)
            per_person = max(table[2] - table[0], table[3] - table[1]) / max(
                sum(1 for c in chairs if c["wall"] == chairs[0]["wall"]), 1)
            self.assertGreaterEqual(per_person, C.seat_width_min, name)

    def test_rule_6_nothing_stands_where_a_door_opens_even_with_chairs_pulled_out(self):
        for name, layout in every_layout():
            zone = grown(layout, C.chair_pull_min)
            board = piece(layout, "sideboard")
            for door in layout["openings"]["doors"]:
                self.assertFalse(overlap(zone, door["clearance_zone"]), (name, door["id"]))
                if board is not None:
                    self.assertFalse(overlap(board["bbox"], door["clearance_zone"]), (name, door["id"]))

    def test_rule_7_the_sideboard_keeps_its_distance_and_stands_against_a_wall(self):
        seen = 0
        for name, layout in every_layout():
            board = piece(layout, "sideboard")
            if board is None:
                continue
            seen += 1
            room, table = layout["room"], piece(layout, "dining_table")["bbox"]
            x0, y0, x1, y1 = board["bbox"]
            self.assertTrue(inside(room, board["bbox"]), name)
            self.assertTrue(min(x0, y0, room["width"] - x1, room["length"] - y1) < 1.0, name)
            dx = max(table[0] - x1, x0 - table[2], 0.0)
            dy = max(table[1] - y1, y0 - table[3], 0.0)
            self.assertGreaterEqual((dx * dx + dy * dy) ** 0.5, C.furniture_gap_side - 1.0, name)
        self.assertGreater(seen, 0)

    def test_rule_3_every_side_with_chairs_can_be_walked_to(self):
        for name, layout in every_layout():
            circulation = layout["validation"]["circulation"]
            self.assertTrue(circulation["valid"], name)
            self.assertEqual(circulation["unreachable_targets"], [], name)
            self.assertGreaterEqual(circulation["corridor_width_mm"], C.path_min, name)

    def test_rule_10_a_pendant_hangs_over_the_table(self):
        for name, layout in every_layout():
            table = piece(layout, "dining_table")["bbox"]
            lights = pieces(layout, "pendant_light")
            self.assertEqual(len(lights), 2 if layout["table"]["seats"] == 8 else 1, name)
            for light in lights:
                x0, y0, x1, y1 = light["bbox"]
                self.assertTrue(table[0] <= x0 and x1 <= table[2] and table[1] <= y0 and y1 <= table[3], name)
                self.assertEqual(light["mounted"], "ceiling")
                self.assertEqual(light["mount_height"], C.table_height + C.pendant_drop)

    def test_scores_are_reported_rule_by_rule_and_add_up(self):
        self.assertEqual(sum(r["weight"] for r in rule_catalogue()), 100)
        for name, layout in every_layout():
            self.assertEqual([r["id"] for r in layout["rules"]], [r.id for r in RULES])
            self.assertAlmostEqual(sum(r["points"] for r in layout["rules"]), layout["layout"]["score"], delta=0.6)
            self.assertAlmostEqual(sum(r["max_points"] for r in layout["rules"]), 100.0, delta=0.6)
            for r in layout["rules"]:
                self.assertTrue(r["detail"], (name, r["id"]))

    def test_layouts_come_best_first_with_distinct_names(self):
        for name in ROOMS:
            layouts = result_for(name)["layouts"]
            scores = [l["layout"]["score"] for l in layouts]
            self.assertEqual(scores, sorted(scores, reverse=True), name)
            types = [l["layout"]["type"] for l in layouts]
            self.assertEqual(len(types), len(set(types)), name)

    def test_rule_2_the_best_layout_leaves_the_comfortable_clearance_in_a_roomy_room(self):
        for name in ("square", "large", "entertaining"):
            self.assertEqual(rule(result_for(name)["layouts"][0], "R2")["status"], "satisfied", name)

    def test_rule_9_a_table_across_the_line_between_two_doors_is_marked_down(self):
        layouts = result_for("through")["layouts"]
        marks = {rule(l, "R9")["score"] for l in layouts}
        self.assertGreater(len(marks), 1)
        clear = max(layouts, key=lambda l: rule(l, "R9")["score"])
        self.assertIn("misses", rule(clear, "R9")["detail"])


class BehaviourTests(unittest.TestCase):
    def test_rule_4_the_table_is_sized_to_the_room(self):
        seats = lambda name: result_for(name)["layouts"][0]["table"]["seats"]
        self.assertEqual(seats("small"), 2)
        self.assertEqual(seats("square"), 6)
        self.assertEqual(seats("large"), 8)

    def test_rule_12_seats_follow_the_occupants_and_the_use(self):
        self.assertEqual(result_for("six_asked")["seats"], 6)
        self.assertEqual(result_for("six_asked")["seatsSource"], "provided")
        self.assertEqual(result_for("entertaining")["seats"], 8)      # six occupants and two guests
        everyday = generate_dining_layouts(dict(copy.deepcopy(ROOMS["entertaining"]), use="everyday"))
        self.assertEqual(everyday["seats"], 6)

    def test_rule_4_a_table_that_does_not_fit_falls_back_a_size_and_says_so(self):
        result = generate_dining_layouts(plan(2400, 2600, doors=[("south", 100, 800)], seats=8))
        best = result["layouts"][0]
        self.assertLess(best["table"]["seats"], 8)
        self.assertTrue(best["validation"]["valid"])
        self.assertTrue(any("instead" in note for note in result["notes"]))
        self.assertLess(rule(best, "R12")["score"], 1.0)

    def test_rule_11_a_sideboard_comes_with_floor_area_or_on_request(self):
        self.assertIsNone(piece(result_for("small")["layouts"][0], "sideboard"))
        self.assertEqual(rule(result_for("small")["layouts"][0], "R11")["status"], "not_applicable")
        self.assertIsNotNone(piece(result_for("large")["layouts"][0], "sideboard"))
        without = generate_dining_layouts(dict(copy.deepcopy(ROOMS["large"]), sideboard=False))
        self.assertIsNone(piece(without["layouts"][0], "sideboard"))

    def test_rule_8_the_table_is_drawn_towards_the_kitchen(self):
        room = plan(9000, 4500, doors=[("south", 4000, 900)])
        box = room["room"]["bbox"]
        scores = {}
        for side, kitchen in (("west", {"x1": box["x1"] - 300, "x2": box["x1"] - 10}),
                              ("east", {"x1": box["x2"] + 10, "x2": box["x2"] + 300})):
            kitchen.update(y1=box["y1"], y2=box["y2"])
            request = dict(copy.deepcopy(room), rooms=[{"id": "room-2", "name": "Kitchen", "bbox": kitchen}])
            best = generate_dining_layouts(request)["layouts"][0]
            self.assertNotEqual(rule(best, "R8")["status"], "not_applicable")
            self.assertEqual(best["kitchen"]["via"], "wall")
            table = piece(best, "dining_table")["bbox"]
            scores[side] = (table[0] + table[2]) / 2.0
        self.assertLess(scores["west"], scores["east"])
        self.assertEqual(rule(result_for("large")["layouts"][0], "R8")["status"], "not_applicable")

    def test_a_room_too_small_gives_an_explained_error(self):
        result = generate_dining_layouts(plan(1500, 1500, doors=[("south", 100, 750)]))
        self.assertIn("too small", result["layouts"][0]["error"])
        self.assertIsNone(result["bestLayout"])

    def test_a_room_with_no_door_or_window_still_gets_a_layout(self):
        best = generate_dining_layouts(plan(3600, 3600))["layouts"][0]
        self.assertTrue(best["validation"]["valid"])
        for rule_id in ("R1", "R6", "R9"):
            self.assertEqual(rule(best, rule_id)["status"], "not_applicable")

    def test_bad_requests_are_rejected(self):
        for payload in ({}, {"room": {}}, {"room": {"bbox": {"x1": 0, "y1": 0, "x2": 0, "y2": 10}}}, []):
            self.assertRaises(InputError, generate_dining_layouts, payload)

    def test_the_same_request_always_gives_the_same_answer(self):
        first = generate_dining_layouts(copy.deepcopy(ROOMS["through"]))
        second = generate_dining_layouts(copy.deepcopy(ROOMS["through"]))
        for result in (first, second):
            result["search"].pop("elapsed_seconds")
        self.assertEqual(first, second)

    def test_generation_is_quick(self):
        started = time.perf_counter()
        generate_dining_layouts(plan(7000, 7000, doors=[("south", 3000, 900)], windows=[("north", 2000, 2400)]))
        self.assertLess(time.perf_counter() - started, 5.0)

    def test_the_rule_catalogue_lists_all_twelve(self):
        catalogue = rule_catalogue()
        self.assertEqual([r["id"] for r in catalogue], ["R%d" % n for n in range(1, 13)])
        self.assertTrue(all(r["rule"] and r["method"] for r in catalogue))

    def test_the_result_has_the_shape_the_plan_viewer_draws(self):
        result = result_for("square")
        for key in ("roomId", "roomType", "scaleSource", "scaleMmPerPx", "doorsUsed", "windowsUsed", "notes",
                    "layouts", "bestLayout", "seats", "seatsSource", "programme"):
            self.assertIn(key, result)
        self.assertEqual(result["roomType"], "dining")
        layout = result["layouts"][0]
        for key in ("room", "layout", "furniture", "validation", "explanation", "reason", "unplaced_furniture",
                    "scoring", "rules", "layout_selection", "openings", "table", "lighting"):
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
        everything = service.generate_all(copy.deepcopy(ROOMS["square"]))
        self.assertEqual(everything["roomType"], "dining")
        best = service.generate(copy.deepcopy(ROOMS["square"]))
        self.assertEqual(best["layout"]["layout"]["type"], everything["bestLayout"])

    def test_errors(self):
        with self.assertRaises(HTTPException) as caught:
            service.generate_all({})
        self.assertEqual(caught.exception.status_code, 400)
        with self.assertRaises(HTTPException) as caught:
            service.generate(plan(1500, 1500, doors=[("south", 100, 750)]))
        self.assertEqual(caught.exception.status_code, 422)

    def test_rules_and_health(self):
        self.assertEqual(len(service.rules()["rules"]), 12)
        self.assertEqual(service.health(), {"status": "ok"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
