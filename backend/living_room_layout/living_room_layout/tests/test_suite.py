"""
Self-contained test suite (no pytest required).

    python -m living_room_layout.tests.test_suite

Covers five levels:

1. geometry      - intersection, containment, sectors, rotated footprints
2. rules         - each hard constraint actually rejects what it should
3. pipeline      - every scenario in input/ produces a valid, complete layout
4. determinism   - the same input twice gives the same layout
5. the ten rules - the programme they decide, their marks, and the report
"""

from __future__ import annotations

import math
import os
import sys
import traceback
from typing import Callable, List, Tuple

if __package__ in (None, ""):  # allow running the file directly
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    __package__ = "living_room_layout.tests"

from living_room_layout.config import Config
from living_room_layout.engine.pipeline import LayoutGenerator
from living_room_layout.engine.room_analyzer import RoomAnalyzer
from living_room_layout.io_json import InputError, load_scenario, parse_scenario
from living_room_layout.layouts import ALL_LAYOUTS
from living_room_layout.models.door import Door
from living_room_layout.models.furniture import Furniture, FurnitureCatalogue
from living_room_layout.models.geometry import Rect, Shape, sector_polygon
from living_room_layout.models.room import Room
from living_room_layout.models.window import Window
from living_room_layout.programme import apply_programme
from living_room_layout.rules.context import PlacementContext
from living_room_layout.rules.hard_constraints import check_item
from living_room_layout.rules.circulation_rules import analyse_circulation
from living_room_layout.rules.living_rules import RuleEvaluator, rule_catalogue

INPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "input")

CATALOGUE = FurnitureCatalogue()
FAILURES: List[str] = []


# --------------------------------------------------------------------------- #
# tiny assertion helpers
# --------------------------------------------------------------------------- #
def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def close(a: float, b: float, tol: float = 1.0) -> bool:
    return abs(a - b) <= tol


def run(name: str, fn: Callable[[], None]) -> None:
    try:
        fn()
        print("  PASS  {}".format(name))
    except Exception as error:
        FAILURES.append(name)
        print("  FAIL  {}: {}".format(name, error))
        if os.environ.get("LRL_TRACE"):
            traceback.print_exc()


def scenario(width=5000, length=4000, doors=None, windows=None, purpose="family_social", furniture=None):
    data = {
        "room": {"width": width, "length": length, "height": 2800},
        "doors": doors if doors is not None else [
            {"id": "door_1", "wall": "south", "position": 1000, "width": 900, "swing": "inward"}
        ],
        "windows": windows if windows is not None else [],
        "user_requirements": {
            "purpose": purpose,
            "required_furniture": furniture or ["sofa", "coffee_table"],
        },
    }
    return parse_scenario(data, name="unit")


def context(scn) -> PlacementContext:
    return PlacementContext(RoomAnalyzer(scn).analyze(), [])


def piece(type_name: str, x: float, y: float, rotation: int = 0, role: str = "", variant="left") -> Furniture:
    return Furniture(id=type_name + "_t", spec=CATALOGUE.spec(type_name), x=x, y=y,
                     rotation=rotation, role=role or type_name, variant=variant)


# --------------------------------------------------------------------------- #
# 1. geometry
# --------------------------------------------------------------------------- #
def test_rect_intersection():
    a = Rect(0, 0, 1000, 1000)
    check(a.intersects(Rect(900, 900, 500, 500)), "overlapping rects must intersect")
    check(not a.intersects(Rect(1000, 0, 500, 500)), "touching rects must not count as overlap")
    check(not a.intersects(Rect(2000, 0, 10, 10)), "disjoint rects must not intersect")
    check(close(a.intersection_area(Rect(500, 0, 1000, 1000)), 500 * 1000), "intersection area")
    check(close(a.distance_to_rect(Rect(1400, 0, 100, 100)), 400), "rect gap measurement")


def test_polygon_sat():
    square = Rect(0, 0, 1000, 1000).to_polygon()
    diamond = Shape.of(sector_polygon((1500, 500), 700, 150, 210)).parts[0]
    check(square.intersects(diamond), "sector reaching into the square must intersect it")
    far = Shape.of(sector_polygon((3000, 500), 700, 150, 210)).parts[0]
    check(not square.intersects(far), "distant sector must not intersect")


def test_sector_area():
    quarter = sector_polygon((0, 0), 900, 0, 90, segments=64)
    expected = math.pi * 900 * 900 / 4.0
    check(abs(quarter.area - expected) / expected < 0.01, "quarter disc area within 1%")


def test_rotated_footprint():
    sofa = piece("sofa", 1000, 500, rotation=0)
    check((sofa.bbox.width, sofa.bbox.height) == (2200, 900), "rotation 0 keeps width x depth")
    check(sofa.facing == (0.0, 1.0), "rotation 0 faces north")
    turned = piece("sofa", 1000, 500, rotation=90)
    check((turned.bbox.width, turned.bbox.height) == (900, 2200), "rotation 90 swaps the extents")
    check(turned.facing == (-1.0, 0.0), "rotation 90 faces west")
    front = turned.front_center(0.0)
    check(close(front[0], 1000) and close(front[1], 1600), "front face centre of a west-facing sofa")


def test_l_shape_footprint():
    l_sofa = piece("l_sofa", 0, 0, rotation=0, variant="left")
    parts = l_sofa.part_rects()
    check(len(parts) == 2, "an L-sofa has two convex parts")
    total = sum(p.area for p in parts)
    check(total < 2800 * 2200, "the L footprint is smaller than its bounding box")
    corner = Rect(2000, 1500, 500, 500)          # the open notch of a left variant
    check(not any(p.intersects(corner) for p in parts), "the notch of the L stays empty")


def test_door_swing_geometry():
    room = Room(5000, 4000)
    door = Door(id="d", wall="south", position=1000, width=900, swing="inward", hinge="left")
    swing = door.swing_shape(room)
    check(swing is not None, "an inward door has a swing area")
    check(swing.contains_point((1100, 200)), "the swing sweeps into the room beside the hinge")
    check(not swing.contains_point((1100, -200)), "the swing never leaves the room")
    check(not swing.contains_point((2500, 500)), "the swing is bounded by the leaf length")
    sliding = Door(id="s", wall="south", position=1000, width=900, swing="sliding")
    check(sliding.swing_shape(room) is None, "a sliding door has no swing area")


def test_wall_segments():
    scn = scenario(
        doors=[{"id": "d", "wall": "south", "position": 1000, "width": 900, "swing": "inward"}],
        windows=[{"id": "w", "wall": "north", "position": 1500, "width": 1800, "sill_height": 900}],
    )
    analysis = RoomAnalyzer(scn).analyze()
    south = analysis.wall_info("south")
    check(close(south.solid_length, 5000 - 900), "south wall loses exactly the door width")
    check(close(south.longest_solid_length, 3100), "longest south run is east of the door")
    north = analysis.wall_info("north")
    check(close(north.longest_solid_length, 1700), "longest north run is east of the window")
    check(analysis.wall_info("east").longest_solid_length == 4000, "an empty wall is solid end to end")
    check(analysis.usable_area < analysis.room.area, "door zones reduce the usable floor")


# --------------------------------------------------------------------------- #
# 2. hard constraints
# --------------------------------------------------------------------------- #
def test_boundary_constraint():
    ctx = context(scenario())
    outside = piece("sofa", 4500, 500)          # 2200 wide in a 5000 wide room
    violation = check_item(outside, ctx)
    check(violation is not None and violation.rule == "room_boundary", "furniture crossing a wall is rejected")


def test_overlap_constraint():
    scn = scenario()
    ctx = context(scn)
    ctx.add(piece("sofa", 1000, 0))
    clash = piece("coffee_table", 1500, 300, role="coffee_table")
    violation = check_item(clash, ctx)
    check(violation is not None and violation.rule == "furniture_overlap", "overlapping furniture is rejected")


def test_door_constraints():
    ctx = context(scenario())
    in_doorway = piece("sofa", 1000, 0)
    violation = check_item(in_doorway, ctx)
    check(violation is not None and violation.rule in ("door_opening", "door_clearance", "door_swing"),
          "furniture in the doorway is rejected, got {}".format(violation))

    just_clear = piece("sofa", 2100, 0)
    check(check_item(just_clear, ctx) is None,
          "furniture beside the door clearance zone is accepted")


def test_door_swing_constraint():
    doors = [{"id": "d", "wall": "east", "position": 1000, "width": 900,
              "swing": "inward", "hinge": "left"}]
    ctx = context(scenario(doors=doors))
    inside_arc = piece("side_table", 4300, 1200, role="side_table")
    violation = check_item(inside_arc, ctx)
    check(violation is not None, "a side table inside the swing arc is rejected")
    check(violation.rule in ("door_swing", "door_clearance", "door_opening"),
          "rejection comes from a door rule, got {}".format(violation.rule))


def test_window_constraints():
    windows = [{"id": "w", "wall": "north", "position": 1500, "width": 1800,
                "height": 1500, "sill_height": 900}]
    scn = scenario(windows=windows)
    ctx = context(scn)

    shelf = piece("bookshelf", 1800, 4000 - 350, rotation=180, role="bookshelf")
    violation = check_item(shelf, ctx)
    check(violation is not None and violation.rule == "window_tall_furniture",
          "a 2000 mm bookshelf may not stand in front of a window")

    low_sofa = piece("sofa", 1600, 4000 - 900, rotation=180)
    check(check_item(low_sofa, ctx) is None,
          "a 850 mm sofa under a 900 mm sill is allowed")


def test_floor_to_ceiling_window():
    windows = [{"id": "w", "wall": "north", "position": 1000, "width": 3000,
                "height": 2200, "sill_height": 150}]
    ctx = context(scenario(windows=windows))
    low_sofa = piece("sofa", 1600, 4000 - 900, rotation=180)
    violation = check_item(low_sofa, ctx)
    check(violation is not None and violation.rule == "window_floor_to_ceiling",
          "nothing may block full-height glazing, got {}".format(violation))


def test_coffee_table_clearance():
    scn = scenario()
    ctx = context(scn)
    sofa = piece("sofa", 1400, 3100, rotation=180)      # faces south, front at y=3100
    ctx.add(sofa)

    # the sofa occupies y 3100..4000 and faces south, so its front face is y=3100
    too_close = piece("coffee_table", 1400, 2300, role="coffee_table")   # 200 mm gap
    violation = check_item(too_close, ctx)
    check(violation is not None and violation.rule == "coffee_table_min_clearance",
          "a table 200 mm from the sofa is rejected, got {}".format(violation))

    too_far = piece("coffee_table", 1400, 1000, role="coffee_table")     # 1500 mm gap
    violation = check_item(too_far, ctx)
    check(violation is not None and violation.rule == "coffee_table_reach",
          "a table 1500 mm from the sofa is out of reach, got {}".format(violation))

    just_right = piece("coffee_table", 1600, 2050, role="coffee_table")  # 450 mm gap
    check(check_item(just_right, ctx) is None, "a table 450 mm in front of the sofa is accepted")


def test_seating_dead_gap():
    ctx = context(scenario())
    backed = piece("chair", 3000, 0)                    # against the south wall
    check(check_item(backed, ctx) is None, "a chair against the wall is fine")
    stranded = piece("chair", 3000, 300)                # 300 mm behind it: unusable
    violation = check_item(stranded, ctx)
    check(violation is not None and violation.rule == "seating_clearance",
          "a 300 mm slot behind a chair is rejected, got {}".format(violation))
    walkway = piece("chair", 3000, 900)                 # 900 mm behind it: a real path
    check(check_item(walkway, ctx) is None, "a chair with 900 mm behind it is fine")


def test_wall_requirement_and_pairing():
    scn = scenario()
    ctx = context(scn)
    floating = piece("bookshelf", 2000, 2000, role="bookshelf")
    violation = check_item(floating, ctx)
    check(violation is not None and violation.rule == "requires_wall",
          "a free-standing bookshelf is rejected")

    console = piece("tv_console", 2600, 0, role="tv_console")
    check(check_item(console, ctx) is None, "a console against the wall is accepted")
    ctx.add(console)
    stray_tv = piece("tv", 100, 3900, rotation=180, role="tv")   # opposite wall
    violation = check_item(stray_tv, ctx)
    check(violation is not None and violation.rule == "media_pairing",
          "a TV far from its console is rejected, got {}".format(violation))
    on_console = piece("tv", 2900, 0, role="tv")
    check(check_item(on_console, ctx) is None, "a TV on its console is accepted")


def test_circulation_blocked():
    scn = scenario(width=3000, length=3000)
    analysis = RoomAnalyzer(scn).analyze()
    ctx = PlacementContext(analysis, [])
    wall_of_sofas = [
        piece("sofa", 400, 1500, rotation=0),
        piece("sofa", 400, 2400, rotation=0),
    ]
    wall_of_sofas[0].id, wall_of_sofas[1].id = "a", "b"
    report = analyse_circulation(ctx.with_placed(wall_of_sofas), wall_of_sofas)
    check(not report.valid or report.reachable_ratio < 1.0,
          "a room sealed across its width fails or restricts circulation")

    empty = analyse_circulation(ctx, [])
    check(empty.valid, "an empty room always has circulation")


# --------------------------------------------------------------------------- #
# 3. input validation
# --------------------------------------------------------------------------- #
def test_input_validation():
    def expect_error(data, why):
        try:
            parse_scenario(data)
        except InputError:
            return
        raise AssertionError("expected InputError: " + why)

    expect_error({"doors": []}, "missing room block")
    expect_error({"room": {"width": 0, "length": 4000}}, "zero width room")
    expect_error({"room": {"width": 5000, "length": 4000},
                  "doors": [{"id": "d", "wall": "ceiling", "position": 0, "width": 900}]},
                 "unknown wall name")
    expect_error({"room": {"width": 5000, "length": 4000},
                  "doors": [{"id": "d", "wall": "south", "position": 4500, "width": 900}]},
                 "door running off the end of its wall")
    expect_error({"room": {"width": 5000, "length": 4000},
                  "doors": [{"id": "d", "wall": "south", "position": 1000, "width": 900}],
                  "windows": [{"id": "w", "wall": "south", "position": 1200, "width": 900}]},
                 "door and window overlapping on the same wall")
    expect_error({"room": {"width": 5000, "length": 4000},
                  "user_requirements": {"required_furniture": ["hovercraft"]}},
                 "unknown furniture type")


def test_config_override():
    data = {
        "room": {"width": 5000, "length": 4000},
        "doors": [{"id": "d", "wall": "south", "position": 1000, "width": 900}],
        "config": {"clearances": {"door_clearance_min": 1200}},
        "user_requirements": {"required_furniture": ["sofa"]},
    }
    scn = parse_scenario(data)
    check(scn.config.clearances.door_clearance_min == 1200, "config overrides are applied")
    check(scn.config.clearances.circulation_min == Config().clearances.circulation_min,
          "unspecified config values keep their defaults")


def test_furniture_override():
    data = {
        "room": {"width": 5000, "length": 4000},
        "furniture_overrides": {"sofa": {"width": 1800}, "beanbag": {"width": 800, "depth": 800,
                                                                    "height": 700, "category": "seating"}},
        "user_requirements": {"required_furniture": ["sofa", "beanbag"]},
    }
    scn = parse_scenario(data)
    check(scn.catalogue.spec("sofa").width == 1800, "an existing type can be resized from JSON")
    check(scn.catalogue.spec("beanbag").is_seating, "a brand new type can be added from JSON")


# --------------------------------------------------------------------------- #
# 4. layouts and the full pipeline
# --------------------------------------------------------------------------- #
def test_every_layout_plans():
    scn = scenario(width=6000, length=5000, purpose="multi_function",
                   windows=[{"id": "w", "wall": "north", "position": 1000, "width": 1500,
                             "sill_height": 900}],
                   furniture=["sofa", "coffee_table", "tv", "tv_console", "bookshelf", "desk"])
    analysis = RoomAnalyzer(scn).analyze()
    for layout in ALL_LAYOUTS:
        specs = layout.plan(analysis, scn.requirements, scn.catalogue)
        check(specs, "{} produced an empty plan".format(layout.name))
        roles = [s.role for s in specs]
        check(len(roles) == len(set(roles)), "{} has duplicate roles".format(layout.name))
        for spec in specs:
            check(scn.catalogue.has(spec.type),
                  "{} references unknown type {}".format(layout.name, spec.type))
            if spec.anchor:
                check(spec.anchor in roles[:roles.index(spec.role)],
                      "{}: anchor '{}' of '{}' is not placed before it".format(
                          layout.name, spec.anchor, spec.role))
        suitability = layout.suitability(analysis, scn.requirements)
        check(suitability.layout == layout.name, "suitability reports its own name")


def test_preferred_layout_is_honoured():
    data = {
        "room": {"width": 5600, "length": 4400},
        "doors": [{"id": "d", "wall": "south", "position": 800, "width": 900, "swing": "inward"}],
        "windows": [{"id": "w", "wall": "north", "position": 3000, "width": 1400, "sill_height": 900}],
        "user_requirements": {"purpose": "family_social", "preferred_layout": "reading",
                              "required_furniture": ["sofa", "bookshelf", "reading_chair", "side_table"]},
    }
    result = LayoutGenerator(parse_scenario(data, name="pref")).run()
    check(result.decision.layout.name == "reading", "an explicit preferred_layout is selected")
    check(result.decision.preference_honoured, "the decision records that the preference was honoured")


def test_unknown_preferred_layout_falls_back():
    data = {
        "room": {"width": 5000, "length": 4000},
        "doors": [{"id": "d", "wall": "south", "position": 800, "width": 900, "swing": "inward"}],
        "user_requirements": {"purpose": "family_social", "preferred_layout": "hexagonal",
                              "required_furniture": ["sofa", "coffee_table"]},
    }
    result = LayoutGenerator(parse_scenario(data, name="bad_pref")).run()
    check(result.decision.layout is not None, "an unknown layout name still yields a layout")
    check(any("not one of the six supported layouts" in r for r in result.decision.reasons),
          "the fallback is explained")


def test_room_without_doors():
    data = {
        "room": {"width": 4000, "length": 3500},
        "doors": [],
        "user_requirements": {"purpose": "family_social", "required_furniture": ["sofa", "coffee_table"]},
    }
    result = LayoutGenerator(parse_scenario(data, name="no_door")).run()
    check(result.result.valid, "a doorless room still produces a valid layout")


def _scenario_files() -> List[str]:
    return sorted(os.path.join(INPUT_DIR, f) for f in os.listdir(INPUT_DIR) if f.endswith(".json"))


def test_all_scenarios_valid():
    for path in _scenario_files():
        name = os.path.basename(path)
        result = LayoutGenerator(load_scenario(path)).run()
        check(result.result.valid, "{}: layout violates {}".format(
            name, [v.message for v in result.result.violations]))
        check(result.result.items, "{}: nothing was placed".format(name))
        missing = [f.role for f in result.result.failures if f.required]
        check(not missing, "{}: required furniture unplaced: {}".format(name, missing))

        validation = result.validation()
        check(validation["valid"], "{}: validation block says invalid".format(name))
        check(not validation["furniture_overlap"], "{}: overlap reported".format(name))
        check(not validation["door_blocked"], "{}: door blocked".format(name))
        check(not validation["window_blocked"], "{}: window blocked".format(name))
        check(validation["circulation_valid"], "{}: circulation invalid".format(name))
        check(validation["inside_room_boundary"], "{}: furniture outside the room".format(name))


def test_output_json_shape():
    result = LayoutGenerator(load_scenario(os.path.join(INPUT_DIR, "room_medium.json"))).run()
    data = result.to_dict()
    for key in ("room", "layout", "furniture", "validation", "explanation",
                "selected_layout", "reason", "rejected_positions"):
        check(key in data, "output JSON is missing '{}'".format(key))
    for key in ("type", "score"):
        check(key in data["layout"], "layout block is missing '{}'".format(key))
    for item in data["furniture"]:
        for key in ("id", "type", "x", "y", "width", "depth", "rotation"):
            check(key in item, "furniture entry is missing '{}'".format(key))
    check(data["explanation"], "the explanation is empty")
    check(isinstance(data["rejected_positions"], list), "rejected_positions must be a list")
    import json
    json.dumps(data)  # must be serialisable


def test_determinism():
    path = os.path.join(INPUT_DIR, "room_medium.json")
    first = LayoutGenerator(load_scenario(path)).run()
    second = LayoutGenerator(load_scenario(path)).run()
    a = [(i.id, i.x, i.y, i.rotation) for i in first.result.items]
    b = [(i.id, i.x, i.y, i.rotation) for i in second.result.items]
    check(a == b, "the same input must produce the same layout")
    check(close(first.result.score.total, second.result.score.total, 0.01), "scores must match")


def test_explanations_present():
    result = LayoutGenerator(load_scenario(os.path.join(INPUT_DIR, "room_multi_window.json"))).run()
    check(result.decision.reasons, "layout selection must be explained")
    check(all(item.reasons for item in result.result.items), "every placement must carry a reason")
    check(result.checker.report(), "rejected placements must be reported")
    check(result.checker.statistics()["candidates_tested"] > 0, "search statistics must be recorded")


# --------------------------------------------------------------------------- #
# 5. the ten living-room rules
# --------------------------------------------------------------------------- #
def rule_marks(scn, pieces):
    """Mark a hand-built arrangement against the ten rules."""
    ctx = context(scn).with_placed(pieces)
    report = analyse_circulation(ctx, pieces)
    return RuleEvaluator(ctx, pieces, report).evaluate()


def test_rule_catalogue():
    catalogue = rule_catalogue()
    check(len(catalogue) == 10, "there are ten living-room rules")
    check([r["id"] for r in catalogue] == ["R{}".format(n) for n in range(1, 11)], "rules are R1..R10 in order")
    check(close(sum(r["weight"] for r in catalogue), 100.0, 0.01), "the rule weights add up to 100")
    check(all(r["rule"] and r["method"] for r in catalogue), "every rule carries its text and its method")


def test_rules_reported_in_output():
    data = LayoutGenerator(load_scenario(os.path.join(INPUT_DIR, "room_medium.json"))).run().to_dict()
    rules = data["rules"]
    check(len(rules) == 10, "the output reports all ten rules")
    for rule in rules:
        check(rule["status"] in ("satisfied", "partly_satisfied", "not_satisfied", "not_applicable"),
              "{} has a known status".format(rule["id"]))
        check(-0.01 <= rule["points"] <= rule["max_points"] + 0.01, "{} points stay within its maximum".format(rule["id"]))
        check(rule["detail"], "{} explains its mark".format(rule["id"]))
    score = data["layout"]["score"]
    check(0.0 <= score <= 100.0, "the layout score is on a 0-100 scale, got {}".format(score))
    check(close(sum(r["points"] for r in rules), score, 0.6), "the rule points add up to the layout score")
    check(close(sum(r["max_points"] for r in rules), 100.0, 0.6), "the applicable rules are worth 100 points")
    keys = {r["key"] for r in rules}
    check(set(data["scoring"]["components"]) <= keys, "the score breakdown is keyed by rule")
    check(data["programme"]["activities"], "the programme lists the activities the room is furnished for")
    check(len(data["rules_applied"]["rules"]) == 10, "the rule catalogue is included")


def test_face_to_face_rule():
    scn = scenario(width=5000, length=4500)
    sofa = piece("sofa", 1400, 3600, rotation=180)                  # against the north wall, facing south
    facing = piece("chair", 2100, 1100, rotation=0, role="chair_1")  # in front of it, facing north
    turned = piece("chair", 2100, 1100, rotation=180, role="chair_1")
    good = rule_marks(scn, [sofa, facing])["R1"]
    bad = rule_marks(scn, [sofa, turned])["R1"]
    check(good.score > 0.9, "a chair facing the sofa at talking distance satisfies rule 1, got {:.2f}".format(good.score))
    check(bad.score < good.score - 0.3, "a chair with its back to the sofa scores clearly lower")
    alone = rule_marks(scn, [sofa])["R1"]
    check(alone.score < 0.5, "a sofa with no seat facing it does not support face-to-face conversation")


def test_views_rule():
    scn = scenario(width=5000, length=4500)
    sofa = piece("sofa", 1400, 3600, rotation=180)
    chair = piece("chair", 2100, 600, rotation=0, role="chair_1")
    clear = rule_marks(scn, [sofa, chair])["R2"]
    check(clear.score > 0.9, "two seats facing each other see each other, got {:.2f}".format(clear.score))
    shelf = piece("bookshelf", 2050, 2200, rotation=0)              # 2 m tall, between the two seats
    blocked = rule_marks(scn, [sofa, chair, shelf])["R2"]
    check(blocked.score < 0.1, "a tall piece between two seats blocks their view of each other")


def test_reach_rule():
    scn = scenario(width=5000, length=4500)
    sofa = piece("sofa", 1400, 3600, rotation=180)                  # front face at y = 3600
    near = piece("coffee_table", 1900, 2550, role="coffee_table")   # 450 mm in front
    far = piece("coffee_table", 1900, 2100, role="coffee_table")    # 900 mm in front
    check(rule_marks(scn, [sofa, near])["R6"].score > rule_marks(scn, [sofa, far])["R6"].score,
          "a coffee table within reach marks higher than one 900 mm away")
    check(rule_marks(scn, [sofa])["R6"].score == 0.0, "no table at all leaves nothing within reach")


def test_programme_sizes_fit_room():
    def programme_for(width, length, **extra):
        data = {"room": {"width": width, "length": length},
                "doors": [{"id": "d", "wall": "south", "position": 500, "width": 900}],
                "user_requirements": {"required_furniture": ["sofa", "coffee_table"]}}
        data.update(extra)
        scn = parse_scenario(data)
        return apply_programme(scn), scn

    small, scn_small = programme_for(3200, 3400)
    check(small.tier == "compact", "a 10.9 m2 room gets compact furniture, got {}".format(small.tier))
    medium, scn_medium = programme_for(5000, 4000)
    check(medium.tier == "standard", "a 20 m2 room gets standard furniture")
    large, scn_large = programme_for(7000, 5500)
    check(large.tier == "generous", "a 38.5 m2 room gets generous furniture")
    widths = [s.catalogue.spec("sofa").width for s in (scn_small, scn_medium, scn_large)]
    check(widths[0] < widths[1] < widths[2], "the sofa grows with the room: {}".format(widths))
    _, overridden = programme_for(3200, 3400, furniture_overrides={"sofa": {"width": 2000}})
    check(overridden.catalogue.spec("sofa").width == 2000, "an explicit furniture override beats the size tier")
    check(apply_programme(scn_small) is small, "the programme is worked out once per scenario")


def test_programme_activities():
    def scn_for(**requirements):
        return parse_scenario({"room": {"width": 6000, "length": 4500, "name": requirements.pop("name", "living")},
                               "doors": [{"id": "d", "wall": "south", "position": 500, "width": 900}],
                               "user_requirements": requirements})

    default = apply_programme(scn_for())
    check(default.activities == ["conversation", "tv"], "a family room is furnished for conversation and TV")
    check(default.activities_source == "inferred", "activities nobody named are marked as inferred")
    check(default.required[:2] == ["sofa", "coffee_table"] and "tv_console" in default.required,
          "the programme plans the furniture those activities need: {}".format(default.required))

    named = apply_programme(scn_for(activities=["reading", "dining"]))
    check(named.activities == ["reading", "dining"] and named.activities_source == "provided",
          "activities the household names are used as given")
    check({"bookshelf", "reading_chair", "dining_set"} <= set(named.required) and "tv_console" not in named.required,
          "only the named activities are furnished: {}".format(named.required))

    combined = apply_programme(scn_for(name="Living / Dining"))
    check("dining" in combined.activities, "a 'Living / Dining' room is furnished for dining too")

    listed = apply_programme(scn_for(required_furniture=["sofa", "coffee_table", "desk"]))
    check(listed.activities == ["conversation", "work"], "an explicit furniture list sets the activities")
    check(listed.required == ["sofa", "coffee_table", "desk"], "and is left as the caller wrote it")

    try:
        apply_programme(scn_for(activities=["juggling"]))
    except InputError:
        pass
    else:
        raise AssertionError("an unknown activity must be rejected")


def test_accessible_programme():
    data = {"room": {"width": 6000, "length": 5000},
            "doors": [{"id": "d", "wall": "south", "position": 500, "width": 900}],
            "user_requirements": {"accessible": True}}
    scn = parse_scenario(data)
    programme = apply_programme(scn)
    check(programme.accessible and programme.accessible_source == "provided", "mobility needs are recorded")
    check(scn.config.clearances.door_clearance_min == 1200, "1.2 m is kept clear inside every door")
    check(scn.config.clearances.seating_circulation_min == 900, "900 mm is needed behind a free-standing seat")
    check("rug" not in programme.optional, "no loose rug is planned")
    data["user_requirements"] = {}
    plain = parse_scenario(data)
    check("rug" in apply_programme(plain).optional, "without mobility needs a 30 m2 room gets a rug")
    check(plain.config.clearances.door_clearance_min == 900, "and the standard door clearance")


def test_dining_clearance_constraint():
    ctx = context(scenario(width=6000, length=5000, doors=[]))
    against_wall = piece("dining_set", 2000, 0, role="dining_set")           # a row of chairs on the south wall
    violation = check_item(against_wall, ctx)
    check(violation is not None and violation.rule == "dining_clearance",
          "dining chairs with a wall right behind them are rejected, got {}".format(violation))
    clear = piece("dining_set", 2000, 1500, role="dining_set")
    check(check_item(clear, ctx) is None, "a dining set with floor behind both rows of chairs is accepted")
    parts = clear.output_dicts()
    check([p["type"] for p in parts] == ["dining_table"] + ["dining_chair"] * 4,
          "the output lists the table and its four chairs")
    table = parts[0]["bbox"]
    check(close(table[3] - table[1], 1700 - 2 * 450), "the table is the set without its two rows of chairs")
    check(all(1500 - 1 <= p["bbox"][1] and p["bbox"][3] <= 3200 + 1 for p in parts), "every part lies inside the set")


def test_dining_zone_layout():
    data = {
        "room": {"width": 6500, "length": 4500, "name": "Living / Dining"},
        "doors": [{"id": "d", "wall": "south", "position": 2800, "width": 900, "swing": "inward"}],
        "windows": [{"id": "w", "wall": "north", "position": 2000, "width": 1800, "sill_height": 900}],
        "user_requirements": {"purpose": "family_social", "activities": ["conversation", "tv", "dining"]},
    }
    result = LayoutGenerator(parse_scenario(data, name="living_dining")).run()
    out = result.to_dict()
    check(result.result.valid, "the living/dining room produces a valid layout: {}".format(
        [v.message for v in result.result.violations]))
    types = [f["type"] for f in out["furniture"]]
    check(types.count("dining_table") == 1 and types.count("dining_chair") >= 4,
          "a dining table and its chairs are placed: {}".format(types))
    check({"living", "dining"} <= {z["name"] for z in out["zones"]}, "the room is divided into living and dining zones")
    zones = {r["id"]: r for r in out["rules"]}
    check(zones["R3"]["status"] != "not_applicable", "rule 3 applies once the room holds two activity areas")
    check("dining" in zones["R7"]["detail"].lower(), "rule 7 reports on the dining activity")


# --------------------------------------------------------------------------- #
def main() -> int:
    groups: List[Tuple[str, List[Callable]]] = [
        ("geometry", [test_rect_intersection, test_polygon_sat, test_sector_area,
                      test_rotated_footprint, test_l_shape_footprint,
                      test_door_swing_geometry, test_wall_segments]),
        ("hard constraints", [test_boundary_constraint, test_overlap_constraint,
                              test_door_constraints, test_door_swing_constraint,
                              test_window_constraints, test_floor_to_ceiling_window,
                              test_coffee_table_clearance, test_seating_dead_gap,
                              test_wall_requirement_and_pairing, test_circulation_blocked]),
        ("input handling", [test_input_validation, test_config_override, test_furniture_override]),
        ("layouts and pipeline", [test_every_layout_plans, test_preferred_layout_is_honoured,
                                  test_unknown_preferred_layout_falls_back, test_room_without_doors,
                                  test_all_scenarios_valid, test_output_json_shape,
                                  test_determinism, test_explanations_present]),
        ("the ten rules", [test_rule_catalogue, test_face_to_face_rule, test_views_rule, test_reach_rule,
                           test_programme_sizes_fit_room, test_programme_activities,
                           test_accessible_programme, test_dining_clearance_constraint,
                           test_rules_reported_in_output, test_dining_zone_layout]),
    ]
    total = 0
    for title, tests in groups:
        print("\n{}".format(title.upper()))
        for test in tests:
            total += 1
            run(test.__name__.replace("test_", ""), test)

    print("\n" + "=" * 60)
    print("{} of {} checks passed".format(total - len(FAILURES), total))
    if FAILURES:
        print("failed: {}".format(", ".join(FAILURES)))
    print("=" * 60)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    raise SystemExit(main())
