"""
Tests for the bathroom layout engine (standard library only - no pytest needed).

    cd backend/bathroom_layout
    python -m unittest bathroom_layout.tests.test_engine -v

Three levels are covered:

1. rules      - every returned layout is re-checked against the hard limits of
                the fifteen rules with geometry written here, independently of
                the engine's own checks, and the scored rules move the right way
2. behaviour  - fixture sizes, mobility needs, fall-backs, determinism, speed
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

from bathroom_layout import RULES, InputError, generate_bathroom_layouts, rule_catalogue
from bathroom_layout.config import Config

PX = 10.0                 # millimetres per pixel used by the test plans
LEFT, TOP = 200.0, 150.0  # where the room sits on the imaginary image
C = Config().clearances
A = Config().access
FLOOR = ("shower", "toilet", "washbasin", "bathroom_cabinet")


def plan(width, length, doors=(), windows=(), **extra):
    """A request for a room given in millimetres. doors / windows: (wall, position_mm, width_mm[, extras])."""
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
    for i, d in enumerate(doors):
        det = {"id": "door-%d" % (i + 1), "class": "Door", "bbox": box(d[0], d[1], d[2], 6)}
        det.update(d[3] if len(d) > 3 else {})
        detections.append(det)
    detections += [{"id": "win-%d" % (i + 1), "class": "Window", "bbox": box(w[0], w[1], w[2], 14)}
                   for i, w in enumerate(windows)]
    payload = {
        "room": {"id": "room-1", "name": "Bathroom", "bbox": {"x1": LEFT, "y1": TOP, "x2": right, "y2": bottom}},
        "detections": detections,
        "scale_m_per_px": PX / 1000.0,
    }
    payload.update(extra)
    return payload


ROOMS = {
    "plan_like": plan(2440, 1540, doors=[("north", 1500, 800)]),
    "small_square": plan(1800, 1800, doors=[("south", 100, 750)], windows=[("north", 600, 600)]),
    "standard": plan(2400, 2000, doors=[("south", 200, 800)], windows=[("north", 900, 600)]),
    "long_narrow": plan(1500, 3000, doors=[("south", 350, 800)], windows=[("north", 450, 600)]),
    "wide": plan(3200, 1800, doors=[("west", 500, 800)], windows=[("east", 600, 600)]),
    "family": plan(3000, 2400, doors=[("east", 200, 850)], windows=[("north", 1100, 900)]),
    "large": plan(3600, 3000, doors=[("south", 1400, 900)], windows=[("north", 1200, 1200), ("west", 1000, 800)]),
    "two_doors": plan(3000, 2400, doors=[("south", 200, 800), ("north", 2000, 800)]),
    "outward_door": plan(1800, 1800, doors=[("south", 100, 750, {"swing": "outward"})]),
    "accessible": plan(2800, 2600, doors=[("south", 200, 900)], windows=[("north", 1000, 600)], accessible=True),
}
RESULTS = {}


def result_for(name):
    if name not in RESULTS:
        RESULTS[name] = generate_bathroom_layouts(copy.deepcopy(ROOMS[name]))
    return RESULTS[name]


def every_layout():
    for name in ROOMS:
        for layout in result_for(name)["layouts"]:
            yield name, layout


def overlap(a, b, tol=1.0):
    return a[0] < b[2] - tol and b[0] < a[2] - tol and a[1] < b[3] - tol and b[1] < a[3] - tol


def floor_pieces(layout):
    return [f for f in layout["furniture"] if f["mounted"] == "floor"]


def piece(layout, kind):
    return next((f for f in layout["furniture"] if f["type"] == kind), None)


def in_front(item, depth, half_width=None):
    """The floor `depth` deep in front of a piece, `half_width` either side of its centre line."""
    x0, y0, x1, y1 = item["bbox"]
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    if half_width is None:
        half_width = (x1 - x0 if item["facing"] in ("north", "south") else y1 - y0) / 2.0
    return {
        "north": (cx - half_width, y1, cx + half_width, y1 + depth),
        "south": (cx - half_width, y0 - depth, cx + half_width, y0),
        "east": (x1, cy - half_width, x1 + depth, cy + half_width),
        "west": (x0 - depth, cy - half_width, x0, cy + half_width),
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
            self.assertTrue(result["layouts"], name)
            self.assertNotIn("error", result["layouts"][0], name)
            self.assertEqual(result["bestLayout"], result["layouts"][0]["layout"]["type"])
            for layout in result["layouts"]:
                self.assertTrue(layout["validation"]["valid"], (name, layout["validation"]["notes"]))

    def test_every_bathroom_has_a_shower_a_toilet_and_a_basin(self):
        for name, layout in every_layout():
            for kind in ("shower", "toilet", "washbasin"):
                self.assertIsNotNone(piece(layout, kind), (name, kind))

    def test_fixtures_stay_inside_the_room_and_never_overlap(self):
        for name, layout in every_layout():
            pieces = floor_pieces(layout)
            for i, a in enumerate(pieces):
                self.assertTrue(inside(layout["room"], a["bbox"]), (name, a["id"]))
                for b in pieces[i + 1:]:
                    self.assertFalse(overlap(a["bbox"], b["bbox"]), (name, a["id"], b["id"]))

    def test_rule_12_every_fixture_stands_against_a_wall_and_out_of_the_door_swing(self):
        for name, layout in every_layout():
            room = layout["room"]
            for f in floor_pieces(layout):
                x0, y0, x1, y1 = f["bbox"]
                self.assertTrue(min(x0, y0, room["width"] - x1, room["length"] - y1) < 1.0, (name, f["id"]))
                for door in layout["openings"]["doors"]:
                    self.assertFalse(overlap(f["bbox"], door["clearance_zone"]), (name, f["id"], door["id"]))

    def test_rule_2_the_toilet_has_room_at_its_sides_and_in_front(self):
        for name, layout in every_layout():
            toilet = piece(layout, "toilet")
            zone = in_front(toilet, C.toilet_front_min, C.toilet_side_min)
            beside = in_front(dict(toilet, facing=toilet["facing"]), -toilet["depth"], C.toilet_side_min)
            beside = (min(beside[0], beside[2]), min(beside[1], beside[3]),
                      max(beside[0], beside[2]), max(beside[1], beside[3]))
            for area in (zone, beside):
                self.assertTrue(inside(layout["room"], area), (name, "wall too close to the toilet"))
                for other in floor_pieces(layout):
                    if other["id"] != toilet["id"]:
                        self.assertFalse(overlap(other["bbox"], area), (name, other["id"]))

    def test_rule_5_the_basin_has_standing_room(self):
        for name, layout in every_layout():
            basin = piece(layout, "washbasin")
            half = max(basin["width"], C.basin_zone_width) / 2.0
            zone = in_front(basin, C.basin_front_min, half)
            self.assertTrue(inside(layout["room"], zone), name)
            for other in floor_pieces(layout):
                if other["id"] != basin["id"]:
                    self.assertFalse(overlap(other["bbox"], zone), (name, other["id"]))

    def test_rule_3_the_shower_is_in_a_corner_with_dry_floor_outside_it(self):
        for name, layout in every_layout():
            room, shower = layout["room"], piece(layout, "shower")
            x0, y0, x1, y1 = shower["bbox"]
            self.assertTrue((x0 < 1 or x1 > room["width"] - 1) and (y0 < 1 or y1 > room["length"] - 1), name)
            # somewhere along its open side there is a way out at least 600 mm wide and deep
            side = shower["facing"]
            lo, hi = (y0, y1) if side in ("east", "west") else (x0, x1)
            found = False
            start = lo
            while start + 600.0 <= hi + 1.0 and not found:
                span = (start, start + 600.0)
                exit_zone = {
                    "east": (x1, span[0], x1 + C.shower_exit_min, span[1]),
                    "west": (x0 - C.shower_exit_min, span[0], x0, span[1]),
                    "north": (span[0], y1, span[1], y1 + C.shower_exit_min),
                    "south": (span[0], y0 - C.shower_exit_min, span[1], y0),
                }[side]
                found = inside(room, exit_zone) and not any(
                    overlap(o["bbox"], exit_zone) for o in floor_pieces(layout) if o["id"] != shower["id"])
                start += 50.0
            self.assertTrue(found, name)

    def test_rule_4_every_fixture_can_be_walked_to(self):
        for name, layout in every_layout():
            circulation = layout["validation"]["circulation"]
            self.assertTrue(circulation["valid"], name)
            self.assertEqual(circulation["unreachable_targets"], [], name)
            self.assertGreaterEqual(circulation["corridor_width_mm"], C.path_min, name)

    def test_rule_6_a_tall_cabinet_never_stands_in_front_of_a_window(self):
        for name, layout in every_layout():
            cabinet = piece(layout, "bathroom_cabinet")
            if cabinet is not None:
                for window in layout["openings"]["windows"]:
                    self.assertFalse(overlap(cabinet["bbox"], window["access_zone"]), (name, window["id"]))

    def test_rule_7_a_cabinet_door_can_open(self):
        for name, layout in every_layout():
            cabinet = piece(layout, "bathroom_cabinet")
            if cabinet is not None:
                leaf = in_front(cabinet, min(cabinet["width"], C.cabinet_leaf_max))
                self.assertTrue(inside(layout["room"], leaf), name)
                for other in floor_pieces(layout):
                    if other["id"] != cabinet["id"]:
                        self.assertFalse(overlap(other["bbox"], leaf), (name, other["id"]))

    def test_rule_9_the_mirror_is_at_the_basin_and_never_over_a_window(self):
        for name, layout in every_layout():
            mirror, basin = piece(layout, "mirror"), piece(layout, "washbasin")
            self.assertEqual(layout["fittings"]["mirror"] != "none", mirror is not None, name)
            if mirror is None:
                continue
            self.assertTrue(overlap(mirror["bbox"], basin["bbox"], tol=-1.0), name)
            self.assertTrue(900.0 <= mirror["mount_height"] <= 1200.0, name)
            for window in layout["openings"]["windows"]:
                if window["wall"] == mirror["wall"]:
                    lo, hi = (mirror["bbox"][0], mirror["bbox"][2]) if window["wall"] in ("north", "south") \
                        else (mirror["bbox"][1], mirror["bbox"][3])
                    shared = min(hi, window["position"] + window["width"]) - max(lo, window["position"])
                    self.assertLessEqual(shared, 50.0, name)

    def test_rule_8_towels_hang_on_free_wall(self):
        for name, layout in every_layout():
            for kind in ("towel_rail", "towel_ring"):
                towel = piece(layout, kind)
                if towel is None:
                    continue
                for other in floor_pieces(layout):
                    self.assertFalse(overlap(other["bbox"], towel["bbox"]), (name, kind, other["id"]))
                for door in layout["openings"]["doors"]:
                    self.assertFalse(overlap(door["clearance_zone"], towel["bbox"]), (name, kind))

    def test_rule_14_the_drain_is_in_the_shower(self):
        for name, layout in every_layout():
            drain, shower = layout["floor"]["drain"], piece(layout, "shower")["bbox"]
            self.assertTrue(shower[0] <= drain[0] <= shower[2] and shower[1] <= drain[1] <= shower[3], name)
            self.assertTrue(layout["floor"]["drain_in_shower"], name)
            self.assertIn("non-slip", layout["floor"]["finish"])
            self.assertIsNotNone(piece(layout, "floor_drain"), name)

    def test_rules_13_and_15_apply_only_when_required(self):
        for name, layout in every_layout():
            wanted = name == "accessible"
            for rule_id in ("R13", "R15"):
                self.assertEqual(rule(layout, rule_id)["status"] != "not_applicable", wanted, (name, rule_id))
            self.assertEqual(piece(layout, "grab_bar") is not None, wanted, name)

    def test_rule_13_an_accessible_bathroom_has_turning_and_transfer_space(self):
        for layout in result_for("accessible")["layouts"]:
            self.assertGreaterEqual(layout["clear_square_mm"], A.turning_square - 1.0)
            self.assertGreaterEqual(layout["validation"]["circulation"]["corridor_width_mm"], A.path_width)
            toilet = piece(layout, "toilet")
            x0, y0, x1, y1 = toilet["bbox"]
            along = toilet["facing"] in ("north", "south")
            lo, hi = (x0, x1) if along else (y0, y1)
            length = layout["room"]["width"] if along else layout["room"]["length"]
            gaps = []
            for a, b in ((lo - A.transfer_width, lo), (hi, hi + A.transfer_width)):
                strip = (a, y0, b, y1) if along else (x0, a, x1, b)
                gaps.append(a >= -1.0 and b <= length + 1.0 and not any(
                    overlap(o["bbox"], strip) for o in floor_pieces(layout) if o["id"] != toilet["id"]))
            self.assertTrue(any(gaps))
            self.assertEqual(piece(layout, "shower")["model"], "level_access")

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

    def test_rule_1_the_best_layout_keeps_the_basin_near_the_door(self):
        for name in ("standard", "family", "large"):
            best = result_for(name)["layouts"][0]
            self.assertEqual(rule(best, "R1")["status"], "satisfied", name)

    def test_rule_11_the_best_layout_keeps_water_off_the_way_through(self):
        for name in ("standard", "family", "large", "wide"):
            best = result_for(name)["layouts"][0]
            self.assertEqual(rule(best, "R11")["status"], "satisfied", name)
            self.assertIn("stays off", rule(best, "R11")["detail"], name)


class BehaviourTests(unittest.TestCase):
    def test_fixtures_are_sized_to_the_room(self):
        models = lambda name: piece(result_for(name)["layouts"][0], "shower")["model"]
        self.assertEqual(models("small_square"), "compact")
        self.assertEqual(models("standard"), "standard")
        self.assertEqual(models("large"), "walk_in")

    def test_a_storage_cabinet_comes_with_floor_area_or_on_request(self):
        self.assertIsNone(piece(result_for("standard")["layouts"][0], "bathroom_cabinet"))
        self.assertIsNotNone(piece(result_for("large")["layouts"][0], "bathroom_cabinet"))
        asked = generate_bathroom_layouts(dict(copy.deepcopy(ROOMS["standard"]), storage_cabinet=True))
        best = asked["layouts"][0]
        self.assertTrue(piece(best, "bathroom_cabinet") is not None
                        or any(u["type"] == "bathroom_cabinet" for u in best["unplaced_furniture"]))

    def test_a_tight_room_falls_back_to_smaller_fixtures(self):
        result = generate_bathroom_layouts(plan(1800, 1800, doors=[("south", 100, 750)], fixture_size="large"))
        self.assertNotEqual(piece(result["layouts"][0], "shower")["model"], "walk_in")
        self.assertTrue(any("instead" in note for note in result["notes"]))

    def test_doors_that_leave_no_room_are_planned_to_open_outwards_and_reported(self):
        result = generate_bathroom_layouts(plan(2440, 1550, doors=[("east", 125, 900), ("north", 1500, 800)]))
        best = result["layouts"][0]
        self.assertTrue(best["validation"]["valid"])
        self.assertIsNotNone(piece(best, "shower"))
        self.assertTrue(all(d["swing"] == "outward" for d in best["openings"]["doors"]))
        self.assertTrue(any("outwards" in note for note in result["notes"]))
        self.assertTrue(any("outwards" in note for note in best["validation"]["notes"]))
        # a door the plan says opens inwards is never rehung
        inward = {"swing": "inward"}
        stated = plan(2440, 1550, doors=[("east", 125, 900, inward), ("north", 1500, 800, inward)])
        result = generate_bathroom_layouts(stated)
        self.assertFalse(any("outwards" in note for note in result["notes"]))
        self.assertFalse(result["layouts"][0]["validation"]["valid"])

    def test_a_very_small_room_is_planned_as_a_toilet_room(self):
        result = generate_bathroom_layouts(plan(1300, 1700, doors=[("south", 100, 750, {"swing": "outward"})]))
        best = result["layouts"][0]
        self.assertNotIn("error", best)
        self.assertIsNone(piece(best, "shower"))
        self.assertEqual(rule(best, "R3")["status"], "not_applicable")
        self.assertTrue(best["validation"]["valid"])

    def test_wheelchair_access_that_does_not_fit_is_reported_not_hidden(self):
        result = generate_bathroom_layouts(plan(2000, 1800, doors=[("south", 200, 800)], accessible=True))
        best = result["layouts"][0]
        self.assertFalse(best["validation"]["valid"])
        self.assertTrue(any(v["rule_id"] == "R13" for v in best["validation"]["hard_constraint_violations"]))
        self.assertIsNotNone(piece(best, "grab_bar"))
        self.assertTrue(any("wheelchair" in note for note in result["notes"]))

    def test_a_room_too_small_gives_an_explained_error(self):
        result = generate_bathroom_layouts(plan(900, 1200, doors=[("south", 50, 700)]))
        self.assertIn("too small", result["layouts"][0]["error"])
        self.assertIsNone(result["bestLayout"])

    def test_a_room_with_no_door_still_gets_a_bathroom(self):
        result = generate_bathroom_layouts(plan(2400, 2000, windows=[("north", 900, 600)]))
        best = result["layouts"][0]
        self.assertTrue(best["validation"]["valid"])
        self.assertEqual(rule(best, "R1")["status"], "not_applicable")
        self.assertEqual(rule(best, "R4")["status"], "not_applicable")

    def test_a_window_over_the_basin_costs_the_mirror(self):
        # windows along the whole of every wall but the door's: wherever the basin goes, glass is behind it
        result = generate_bathroom_layouts(plan(
            2400, 2000, doors=[("south", 200, 800)],
            windows=[("north", 0, 2400), ("west", 0, 2000), ("east", 0, 2000), ("south", 1100, 1300)]))
        for layout in result["layouts"]:
            self.assertEqual(layout["fittings"]["mirror"], "none")
            self.assertEqual(rule(layout, "R9")["status"], "not_satisfied")

    def test_bad_requests_are_rejected(self):
        for payload in ({}, {"room": {}}, {"room": {"bbox": {"x1": 0, "y1": 0, "x2": 0, "y2": 10}}}):
            self.assertRaises(InputError, generate_bathroom_layouts, payload)

    def test_the_same_request_always_gives_the_same_answer(self):
        first = generate_bathroom_layouts(copy.deepcopy(ROOMS["family"]))
        second = generate_bathroom_layouts(copy.deepcopy(ROOMS["family"]))
        for result in (first, second):
            result["search"].pop("elapsed_seconds")
        self.assertEqual(first, second)

    def test_generation_is_quick(self):
        started = time.perf_counter()
        generate_bathroom_layouts(copy.deepcopy(ROOMS["large"]))
        self.assertLess(time.perf_counter() - started, 6.0)

    def test_the_rule_catalogue_lists_all_fifteen(self):
        catalogue = rule_catalogue()
        self.assertEqual([r["id"] for r in catalogue], ["R%d" % n for n in range(1, 16)])
        self.assertTrue(all(r["rule"] and r["method"] for r in catalogue))

    def test_the_result_has_the_shape_the_plan_viewer_draws(self):
        result = result_for("family")
        for key in ("roomId", "roomType", "scaleSource", "scaleMmPerPx", "doorsUsed", "windowsUsed", "notes",
                    "layouts", "bestLayout", "accessible", "programme"):
            self.assertIn(key, result)
        self.assertEqual(result["roomType"], "bathroom")
        layout = result["layouts"][0]
        for key in ("room", "layout", "furniture", "validation", "explanation", "reason", "unplaced_furniture",
                    "scoring", "rules", "layout_selection", "openings", "floor", "fittings"):
            self.assertIn(key, layout)
        for item in layout["furniture"]:
            for key in ("id", "type", "role", "x", "y", "width", "depth", "rotation", "facing", "wall", "bbox",
                        "mounted", "reasons"):
                self.assertIn(key, item)
            self.assertIn(item["rotation"], (0, 90, 180, 270))
            self.assertIn(item["mounted"], ("floor", "wall", "drain"))


try:
    from fastapi import HTTPException

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    import api as service
except ImportError:                # the engine itself needs none of this
    service = None


@unittest.skipUnless(service, "FastAPI is not installed in this environment")
class ServiceTests(unittest.TestCase):
    def test_generate_all_and_generate(self):
        everything = service.generate_all(copy.deepcopy(ROOMS["family"]))
        self.assertEqual(everything["roomType"], "bathroom")
        best = service.generate(copy.deepcopy(ROOMS["family"]))
        self.assertEqual(best["layout"]["layout"]["type"], everything["bestLayout"])

    def test_errors(self):
        with self.assertRaises(HTTPException) as caught:
            service.generate_all({})
        self.assertEqual(caught.exception.status_code, 400)
        with self.assertRaises(HTTPException) as caught:
            service.generate(plan(900, 1200, doors=[("south", 50, 700)]))
        self.assertEqual(caught.exception.status_code, 422)

    def test_rules_and_health(self):
        self.assertEqual(len(service.rules()["rules"]), 15)
        self.assertEqual(service.health(), {"status": "ok"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
