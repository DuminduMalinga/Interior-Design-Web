"""
Unit tests for the Layout Generation & Scoring engine.
Run with: pytest test_layout_engine.py -v

Covers SDS §5.5 "Layout Validity Testing":
    - no furniture overlaps
    - no door/window clearance violations
    - scores are within expected 0-100 range
"""

import pytest
from layout_engine import Room, StructuralElement, FurnitureItem, generate_and_score, generate_layouts


@pytest.fixture
def sample_room():
    return Room(
        width=12, length=14,
        elements=[
            StructuralElement("door", x=4, y=0, width=3, wall="north"),
            StructuralElement("window", x=2, y=0, width=4, wall="south"),
        ],
    )


@pytest.fixture
def sample_catalog():
    return [
        FurnitureItem("Double Bed", "bed", width=5, length=6.5),
        FurnitureItem("Wardrobe", "wardrobe", width=4, length=2),
        FurnitureItem("Study Desk", "desk", width=4, length=2, required=False),
    ]


def test_generates_at_least_one_layout(sample_room, sample_catalog):
    layouts = generate_layouts(sample_room, sample_catalog)
    assert len(layouts) > 0, "Engine should produce at least one valid layout for a normal room"


def test_no_furniture_overlaps(sample_room, sample_catalog):
    layouts = generate_layouts(sample_room, sample_catalog)
    for layout in layouts:
        rects = [r for _, r in layout]
        for i, r1 in enumerate(rects):
            for r2 in rects[i + 1:]:
                assert not r1.overlaps(r2), "No two furniture items should overlap"


def test_no_furniture_outside_room_bounds(sample_room, sample_catalog):
    layouts = generate_layouts(sample_room, sample_catalog)
    for layout in layouts:
        for _, r in layout:
            x1, y1, x2, y2 = r.bounds()
            assert x1 >= 0 and y1 >= 0
            assert x2 <= sample_room.width and y2 <= sample_room.length


def test_no_door_blocking(sample_room, sample_catalog):
    layouts = generate_layouts(sample_room, sample_catalog)
    door_zones = sample_room.door_clear_zone()
    for layout in layouts:
        for _, r in layout:
            for zone in door_zones:
                assert not r.overlaps(zone), "Furniture must not block a door's clearance zone"


def test_scores_within_valid_range(sample_room, sample_catalog):
    results = generate_and_score(sample_room, sample_catalog, top_n=5)
    for r in results:
        assert 0 <= r["score"] <= 100
        for key in ("space", "access", "ergonomics"):
            assert 0 <= r["breakdown"][key] <= 100


def test_results_sorted_descending_by_score(sample_room, sample_catalog):
    results = generate_and_score(sample_room, sample_catalog, top_n=5)
    scores = [r["score"] for r in results]
    assert scores == sorted(scores, reverse=True), "Layouts must be ranked best-first"


def test_returns_at_most_top_n(sample_room, sample_catalog):
    results = generate_and_score(sample_room, sample_catalog, top_n=3)
    assert len(results) <= 3


def test_tiny_room_may_produce_no_layouts(sample_catalog):
    """Edge case: a room too small for the furniture should not crash,
    just return an empty list (handled as HTTP 422 in app.py)."""
    tiny_room = Room(width=3, length=3, elements=[])
    results = generate_and_score(tiny_room, sample_catalog, top_n=5)
    assert isinstance(results, list)  # empty is fine, crashing is not
