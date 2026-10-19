"""
Tests for the living-room layout engine (standard library only - no pytest needed).

    cd backend/living_room_layout
    python -m unittest living_room_layout.tests.test_engine -v

Three levels are covered:

1. rules      - every returned layout is re-checked against the hard limits of
                the ten rules with geometry written here, independently of
                the engine's own checks, and the scored rules move the right way
2. behaviour  - furniture sizes, activities, occupants, fall-backs, determinism, speed
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

from living_room_layout import RULES, InputError, generate_living_room_layouts, rule_catalogue
from living_room_layout.config import Config
from living_room_layout.rules import FURNITURE_RULE, furniture_mark

PX = 10.0                 # millimetres per pixel used by the test plans
LEFT, TOP = 200.0, 150.0  # where the room sits on the imaginary image
C = Config().clearances

SOFAS = ("sofa", "loveseat")
#: drawn, but they stand on no floor of their own
FLAT = ("rug", "tv")
TALL = ("tv_console", "lamp", "bookshelf")


def plan(width, length, doors=(), windows=(), name="Living Room", **extra):
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
        "room": {"id": "room-1", "name": name, "bbox": {"x1": LEFT, "y1": TOP, "x2": right, "y2": bottom}},
        "detections": detections,
        "scale_m_per_px": PX / 1000.0,
    }
    payload.update(extra)
    return payload


ROOMS = {
    "medium": plan(4500, 4000, doors=[("south", 300, 900)], windows=[("north", 1500, 1500)]),
    "small": plan(3000, 3400, doors=[("south", 100, 800)], windows=[("north", 900, 1200)]),
    "large": plan(6000, 5000, doors=[("south", 2500, 900)], windows=[("north", 2000, 2000), ("west", 1500, 1500)]),
    "through": plan(5000, 4200, doors=[("west", 300, 900), ("east", 3000, 900)], windows=[("north", 1500, 1800)]),
    "living_dining": plan(4500, 7500, doors=[("south", 300, 900)],
                          windows=[("north", 1200, 2000), ("east", 3000, 1500)], name="Living / Dining"),
    "everything": plan(7000, 6000, doors=[("south", 3000, 900)],
                       windows=[("north", 2000, 2400), ("east", 2000, 1500)],
                       activities=["tv", "dining", "work", "reading"]),
    "talk": plan(4500, 4000, doors=[("south", 300, 900)], windows=[("north", 1500, 1500)],
                 activities=["conversation"]),
    "accessible": plan(5000, 4500, doors=[("south", 300, 900)], windows=[("north", 1500, 1500)], accessible=True),
    "no_window": plan(4200, 3800, doors=[("east", 300, 900)]),
}
RESULTS = {}


def result_for(name):
    if name not in RESULTS:
        RESULTS[name] = generate_living_room_layouts(copy.deepcopy(ROOMS[name]))
    return RESULTS[name]


def every_layout():
    for name in ROOMS:
        for layout in result_for(name)["layouts"]:
            yield name, layout


def overlap(a, b, tol=1.0):
    return a[0] < b[2] - tol and b[0] < a[2] - tol and a[1] < b[3] - tol and b[1] < a[3] - tol


def gap(a, b):
    dx = max(b[0] - a[2], a[0] - b[2], 0.0)
    dy = max(b[1] - a[3], a[1] - b[3], 0.0)
    return (dx * dx + dy * dy) ** 0.5


def piece(layout, *kinds):
    return next((f for f in layout["furniture"] if f["type"] in kinds), None)


def pieces(layout, *kinds):
    return [f for f in layout["furniture"] if f["type"] in kinds]


def standing(layout):
    """Everything that takes up floor."""
    return [f for f in layout["furniture"] if f["type"] not in FLAT]


def inside(room, rect, tol=1.0):
    return rect[0] >= -tol and rect[1] >= -tol and rect[2] <= room["width"] + tol and rect[3] <= room["length"] + tol


def ahead(item, other):
    """How far `other` lies in front of `item` (negative when it is behind its front edge)."""
    a, b = item["bbox"], other["bbox"]
    return {"north": b[1] - a[3], "south": a[1] - b[3], "east": b[0] - a[2], "west": a[0] - b[2]}[item["facing"]]


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

    def test_every_piece_stands_inside_the_room_and_on_floor_of_its_own(self):
        for name, layout in every_layout():
            items = standing(layout)
            for i, item in enumerate(items):
                self.assertTrue(inside(layout["room"], item["bbox"]), (name, item["id"]))
                for other in items[i + 1:]:
                    self.assertFalse(overlap(item["bbox"], other["bbox"]), (name, item["id"], other["id"]))

    def test_rule_1_the_armchairs_are_turned_to_the_coffee_table_at_talking_distance(self):
        seen = 0
        for name, layout in every_layout():
            sofa, table = piece(layout, *SOFAS), piece(layout, "coffee_table")
            for chair in pieces(layout, "chair"):
                seen += 1
                self.assertGreaterEqual(ahead(chair, table), -1.0, (name, "armchair turned away from the table"))
                self.assertLessEqual(gap(chair["bbox"], sofa["bbox"]), C.conversation_far, name)
        self.assertGreater(seen, 0)

    def test_rule_4_nothing_stands_where_a_door_opens(self):
        for name, layout in every_layout():
            for door in layout["openings"]["doors"]:
                for item in layout["furniture"]:
                    self.assertFalse(overlap(item["bbox"], door["clearance_zone"]), (name, item["id"], door["id"]))

    def test_rule_4_nothing_tall_stands_in_front_of_a_window(self):
        for name, layout in every_layout():
            for window in layout["openings"]["windows"]:
                for item in pieces(layout, *TALL):
                    self.assertFalse(overlap(item["bbox"], window["access_zone"]), (name, item["id"], window["id"]))

    def test_rule_6_the_coffee_table_is_within_reach_in_front_of_the_sofa(self):
        for name, layout in every_layout():
            sofa, table = piece(layout, *SOFAS), piece(layout, "coffee_table")
            self.assertIsNotNone(sofa, name)
            self.assertIsNotNone(table, name)
            self.assertGreaterEqual(ahead(sofa, table), C.reach_gap_min - 1.0, name)
            self.assertLessEqual(ahead(sofa, table), C.reach_gap_max + 1.0, name)
            for chair in pieces(layout, "chair"):
                self.assertLessEqual(gap(chair["bbox"], table["bbox"]), C.reach + 1.0, name)
            for side in pieces(layout, "side_table"):
                self.assertLess(gap(side["bbox"], sofa["bbox"]), 1.0, (name, "side table not at the sofa"))

    def test_rule_7_the_tv_faces_the_sofa_from_far_enough(self):
        seen = 0
        for name, layout in every_layout():
            unit = piece(layout, "tv_console")
            if unit is None:
                self.assertEqual(name, "talk")
                continue
            seen += 1
            sofa = piece(layout, *SOFAS)
            self.assertGreaterEqual(ahead(sofa, unit), C.tv_min - 1.0, name)
            self.assertEqual(unit["wall"], sofa["facing"], name)
            x0, y0, x1, y1 = unit["bbox"]
            room = layout["room"]
            self.assertTrue(min(x0, y0, room["width"] - x1, room["length"] - y1) < 1.0, (name, "TV unit off the wall"))
            screen = piece(layout, "tv")
            self.assertEqual(screen["mounted"], "wall")
            self.assertTrue(overlap(screen["bbox"], unit["bbox"], tol=0.0), (name, "screen not above its unit"))
        self.assertGreater(seen, 0)

    def test_rule_3_every_other_zone_keeps_clear_of_the_seating(self):
        seen = 0
        for name, layout in every_layout():
            living = next(z for z in layout["zones"] if z["kind"] == "living")["bbox"]
            for zone in layout["zones"]:
                if zone["kind"] == "living":
                    continue
                seen += 1
                self.assertGreaterEqual(gap(zone["bbox"], living), C.zone_gap_min - 1.0, (name, zone["kind"]))
            for item in layout["furniture"]:
                if item["zone"] != "living":
                    self.assertFalse(overlap(item["bbox"], living), (name, item["id"]))
        self.assertGreater(seen, 0)

    def test_rule_7_dining_chairs_can_be_pulled_out(self):
        seen = 0
        for name, layout in every_layout():
            table = piece(layout, "dining_table")
            if table is None:
                continue
            seen += 1
            chairs = pieces(layout, "dining_chair")
            self.assertGreaterEqual(len(chairs), 2, name)
            x0, y0, x1, y1 = table["bbox"]
            sides = {chair["wall"] for chair in chairs}
            pulled = (x0 - C.chair_pull_min * ("west" in sides), y0 - C.chair_pull_min * ("south" in sides),
                      x1 + C.chair_pull_min * ("east" in sides), y1 + C.chair_pull_min * ("north" in sides))
            self.assertTrue(inside(layout["room"], pulled), name)
            for item in standing(layout):
                if item["zone"] != "dining":
                    self.assertFalse(overlap(item["bbox"], pulled), (name, item["id"]))
        self.assertGreater(seen, 0)

    def test_rule_9_every_area_can_be_walked_to(self):
        for name, layout in every_layout():
            circulation = layout["validation"]["circulation"]
            self.assertTrue(circulation["valid"], name)
            self.assertEqual(circulation["unreachable_targets"], [], name)
            self.assertGreaterEqual(circulation["corridor_width_mm"], min(C.path_widths), name)
            self.assertGreaterEqual(layout["seating"]["open_side_mm"], min(C.path_widths) - 1.0, name)

    def test_rule_10_mobility_needs_widen_the_paths_and_remove_the_rug(self):
        for layout in result_for("accessible")["layouts"]:
            self.assertIsNone(piece(layout, "rug"))
            self.assertGreaterEqual(layout["validation"]["circulation"]["corridor_width_mm"],
                                    min(C.accessible_path_widths))
            self.assertGreaterEqual(layout["seating"]["open_side_mm"], min(C.accessible_path_widths) - 1.0)
            self.assertIn("mobility needs", rule(layout, "R10")["detail"])
        self.assertIsNotNone(piece(result_for("medium")["layouts"][0], "rug"))

    def test_scores_are_reported_rule_by_rule_and_add_up(self):
        # the rules keep their weights (100 in all) and a rule that does not apply leaves the
        # others at theirs; the rules total is converted to 90 and the extra rule, last, adds 10
        weights = {r["id"]: r["weight"] for r in rule_catalogue()}
        self.assertEqual(sum(weights[r.id] for r in RULES), 100)
        for name, layout in every_layout():
            rules, scoring, score = layout["rules"], layout["scoring"], layout["layout"]["score"]
            self.assertEqual([r["id"] for r in rules], [r.id for r in RULES] + [FURNITURE_RULE.id])
            self.assertEqual([r["extra"] for r in rules], [False] * len(RULES) + [True])
            applies = [r for r in rules if r["status"] != "not_applicable"]
            for r in applies:
                self.assertAlmostEqual(r["max_points"], weights[r["id"]], delta=0.05)
            # every figure on show is worked from the ones above it, so they add up exactly
            arranged = [r for r in applies if not r["extra"]]
            earned, possible = sum(r["points"] for r in arranged), sum(r["max_points"] for r in arranged)
            self.assertAlmostEqual(scoring["rules_earned"], earned, delta=1e-6, msg=name)
            self.assertAlmostEqual(scoring["rules_possible"], possible, delta=1e-6, msg=name)
            self.assertEqual(scoring["rules_max"], 90.0, name)
            self.assertAlmostEqual(scoring["rules_points"], 90.0 * earned / possible, delta=0.05, msg=name)
            self.assertAlmostEqual(scoring["rules_points"] + rules[-1]["points"], score, delta=1e-6, msg=name)
            self.assertEqual(scoring["total"], score, name)
            for r in rules:
                self.assertTrue(r["detail"], (name, r["id"]))

    def test_the_extra_rule_gives_10_for_the_most_furniture_and_5_for_one_piece_fewer(self):
        for name in ROOMS:
            layouts = [l for l in result_for(name)["layouts"] if "rules" in l]
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

    def test_layouts_come_best_first_with_distinct_names(self):
        for name in ROOMS:
            layouts = result_for(name)["layouts"]
            scores = [l["layout"]["score"] for l in layouts]
            self.assertEqual(scores, sorted(scores, reverse=True), name)
            for key in ("type", "title"):
                names = [l["layout"][key] for l in layouts]
                self.assertEqual(len(names), len(set(names)), (name, key))

    def test_rule_4_furniture_across_the_line_between_two_doors_is_marked_down(self):
        layouts = result_for("through")["layouts"]
        self.assertTrue(any("crosses" in rule(l, "R4")["detail"] for l in layouts))
        clear = generate_living_room_layouts(plan(5000, 4200, doors=[("south", 300, 900), ("south", 3800, 900)]))
        best = clear["layouts"][0]
        self.assertIn("misses", rule(best, "R4")["detail"])


class BehaviourTests(unittest.TestCase):
    def test_rule_5_the_furniture_is_sized_to_the_room(self):
        sofa = lambda name: piece(result_for(name)["layouts"][0], *SOFAS)["width"]
        self.assertEqual(sofa("small"), 1500)
        self.assertEqual(sofa("medium"), 2100)
        self.assertEqual(sofa("large"), 2400)
        self.assertEqual(result_for("small")["programme"]["size_tier"], "compact")

    def test_rule_5_furniture_that_does_not_fit_falls_back_a_class_and_says_so(self):
        result = generate_living_room_layouts(plan(2000, 6500, doors=[("south", 100, 800)],
                                                   activities=["conversation"]))
        best = result["layouts"][0]
        self.assertEqual(result["programme"]["size_tier"], "standard")
        self.assertEqual(best["seating"]["size_tier"], "compact")
        self.assertTrue(best["validation"]["valid"])
        self.assertTrue(any("instead" in note for note in result["notes"]))
        self.assertLess(rule(best, "R5")["score"], 1.0)

    def test_rule_7_each_activity_brings_its_furniture(self):
        best = result_for("everything")["layouts"][0]
        for kind in ("tv_console", "tv", "dining_table", "dining_chair", "desk", "desk_chair", "reading_chair", "lamp"):
            self.assertIsNotNone(piece(best, kind), kind)
        self.assertEqual({z["kind"] for z in best["zones"]}, {"living", "dining", "work", "reading"})
        plain = result_for("medium")["layouts"][0]
        for kind in ("dining_table", "desk", "reading_chair"):
            self.assertIsNone(piece(plain, kind), kind)
        self.assertEqual(rule(plain, "R3")["status"], "not_applicable")

    def test_rule_7_without_a_tv_the_seats_face_each_other(self):
        result = result_for("talk")
        best = result["layouts"][0]
        self.assertIsNone(piece(best, "tv_console"))
        self.assertEqual(best["seating"]["arrangement"], "facing")
        sofa = piece(best, *SOFAS)
        for chair in pieces(best, "chair"):
            self.assertGreater(ahead(sofa, chair), 0.0)
            self.assertGreater(ahead(chair, sofa), 0.0)

    def test_rule_7_activities_are_assumed_from_the_room_when_none_are_given(self):
        result = result_for("living_dining")
        self.assertEqual(result["activitiesSource"], "inferred")
        self.assertIn("dining", result["activities"])
        self.assertIsNotNone(piece(result["layouts"][0], "dining_table"))
        self.assertEqual(result_for("everything")["activitiesSource"], "provided")
        self.assertIn("conversation", result_for("everything")["activities"])
        odd = generate_living_room_layouts(dict(copy.deepcopy(ROOMS["medium"]), activities=["juggling", "TV"]))
        self.assertEqual(odd["activities"], ["conversation", "tv"])
        self.assertTrue(any("juggling" in note for note in odd["notes"]))

    def test_the_seats_follow_the_occupants(self):
        chairs = lambda people: generate_living_room_layouts(
            dict(copy.deepcopy(ROOMS["large"]), occupants=people))["programme"]["armchairs"]
        self.assertEqual([chairs(n) for n in (2, 3, 4, 5, 8)], [0, 0, 1, 2, 2])
        crowd = generate_living_room_layouts(dict(copy.deepcopy(ROOMS["large"]), occupants=8))
        self.assertTrue(any("8 occupants" in note for note in crowd["notes"]))

    def test_rule_3_a_zone_the_room_cannot_take_is_reported_not_forced(self):
        result = generate_living_room_layouts(dict(copy.deepcopy(ROOMS["small"]), activities=["tv", "dining"]))
        best = result["layouts"][0]
        self.assertTrue(best["validation"]["valid"])
        if piece(best, "dining_table") is None:
            self.assertIn("dining_table", [u["type"] for u in best["unplaced_furniture"]])
            self.assertEqual(rule(best, "R3")["score"], 0.0)

    def test_a_room_too_small_gives_an_explained_error(self):
        result = generate_living_room_layouts(plan(1800, 2000, doors=[("south", 100, 750)]))
        self.assertIn("too small", result["layouts"][0]["error"])
        self.assertIsNone(result["bestLayout"])

    def test_a_room_with_no_door_or_window_still_gets_a_layout(self):
        best = generate_living_room_layouts(plan(4000, 4000))["layouts"][0]
        self.assertTrue(best["validation"]["valid"])
        self.assertEqual(rule(best, "R4")["status"], "not_applicable")
        self.assertIsNone(best["validation"]["circulation"])

    def test_bad_requests_are_rejected(self):
        for payload in ({}, {"room": {}}, {"room": {"bbox": {"x1": 0, "y1": 0, "x2": 0, "y2": 10}}}, []):
            self.assertRaises(InputError, generate_living_room_layouts, payload)

    def test_the_same_request_always_gives_the_same_answer(self):
        first = generate_living_room_layouts(copy.deepcopy(ROOMS["everything"]))
        second = generate_living_room_layouts(copy.deepcopy(ROOMS["everything"]))
        for result in (first, second):
            result["search"].pop("elapsed_seconds")
        self.assertEqual(first, second)

    def test_generation_is_quick(self):
        started = time.perf_counter()
        generate_living_room_layouts(plan(9000, 8000, doors=[("south", 3000, 900)], windows=[("north", 2000, 2400)],
                                          activities=["tv", "dining", "work", "reading"]))
        self.assertLess(time.perf_counter() - started, 5.0)

    def test_the_rule_catalogue_lists_all_ten_and_the_furniture_rule(self):
        catalogue = rule_catalogue()
        self.assertEqual([r["id"] for r in catalogue], ["R%d" % n for n in range(1, 12)])
        self.assertEqual(sum(r["weight"] for r in catalogue[:-1]), 100)
        self.assertEqual(catalogue[-1]["weight"], 10.0)
        self.assertEqual([r["extra"] for r in catalogue], [False] * 10 + [True])
        self.assertTrue(all(r["rule"] and r["method"] for r in catalogue))

    def test_the_result_has_the_shape_the_plan_viewer_draws(self):
        result = result_for("medium")
        for key in ("roomId", "roomType", "scaleSource", "scaleMmPerPx", "doorsUsed", "windowsUsed", "notes",
                    "layouts", "bestLayout", "activities", "activitiesSource", "accessible", "accessibleSource",
                    "programme"):
            self.assertIn(key, result)
        self.assertEqual(result["roomType"], "living_room")
        layout = result["layouts"][0]
        for key in ("room", "layout", "furniture", "validation", "explanation", "reason", "unplaced_furniture",
                    "scoring", "rules", "layout_selection", "openings", "seating", "zones"):
            self.assertIn(key, layout)
        for item in layout["furniture"]:
            for key in ("id", "type", "role", "x", "y", "width", "depth", "rotation", "facing", "wall", "bbox",
                        "mounted", "reasons"):
                self.assertIn(key, item)
            self.assertIn(item["rotation"], (0, 90, 180, 270))
            self.assertTrue(item["reasons"], item["id"])


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
        self.assertEqual(everything["roomType"], "living_room")
        best = service.generate(copy.deepcopy(ROOMS["medium"]))
        self.assertEqual(best["layout"]["layout"]["type"], everything["bestLayout"])

    def test_errors(self):
        with self.assertRaises(HTTPException) as caught:
            service.generate_all({})
        self.assertEqual(caught.exception.status_code, 400)
        with self.assertRaises(HTTPException) as caught:
            service.generate(plan(1800, 2000, doors=[("south", 100, 750)]))
        self.assertEqual(caught.exception.status_code, 422)

    def test_rules_and_health(self):
        self.assertEqual(len(service.rules()["rules"]), 11)
        self.assertEqual(service.health(), {"status": "ok"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
