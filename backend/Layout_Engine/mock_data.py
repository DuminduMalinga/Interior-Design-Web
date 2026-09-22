"""
Mock data simulating the OUTPUT of FloorPlanAnalysisModule.detectRoomStructure().

Why this exists:
    Your teammates are still building room detection, and the database isn't
    populated yet. This file lets you develop and test the layout/scoring
    engine RIGHT NOW, against data shaped exactly like what will eventually
    come from the real database (Room + StructuralElement + Furniture tables,
    see SDS Fig 4.4).

    When the DB and detection module are ready, you delete/ignore this file
    and point `repository.py` at real Supabase queries instead. Nothing in
    layout_engine.py changes.
"""

from layout_engine import Room, StructuralElement, FurnitureItem


# ---------------------------------------------------------------------
# Mock "detected rooms" — shaped like rows that will eventually come
# from your Room + StructuralElement tables (Fig 4.4)
# ---------------------------------------------------------------------

MOCK_ROOMS = {
    "room-001": {
        "room_type": "Bedroom",
        "width": 12,
        "length": 14,
        "elements": [
            {"element_type": "door", "x": 4, "y": 0, "width": 3, "wall": "north"},
            {"element_type": "window", "x": 2, "y": 0, "width": 4, "wall": "south"},
        ],
    },
    "room-002": {
        "room_type": "Bedroom",
        "width": 10,
        "length": 11,
        "elements": [
            {"element_type": "door", "x": 0, "y": 3, "width": 3, "wall": "west"},
            {"element_type": "window", "x": 3, "y": 0, "width": 3, "wall": "north"},
        ],
    },
}


def get_room(room_id: str) -> Room:
    """Stand-in for: SELECT * FROM Room JOIN StructuralElement WHERE roomID=..."""
    data = MOCK_ROOMS[room_id]
    elements = [StructuralElement(**e) for e in data["elements"]]
    return Room(width=data["width"], length=data["length"], elements=elements)


# ---------------------------------------------------------------------
# Mock furniture catalog — shaped like rows from the Furniture table
# ---------------------------------------------------------------------

MOCK_CATALOG = [
    {"name": "Double Bed", "category": "bed", "width": 5, "length": 6.5, "required": True, "prefers_wall": True},
    {"name": "Wardrobe", "category": "wardrobe", "width": 4, "length": 2, "required": True, "prefers_wall": True},
    {"name": "Study Desk", "category": "desk", "width": 4, "length": 2, "required": False, "prefers_wall": True},
    {"name": "Nightstand", "category": "nightstand", "width": 1.5, "length": 1.5, "required": False, "prefers_wall": True},
]


def get_furniture_catalog() -> list[FurnitureItem]:
    """Stand-in for: SELECT * FROM Furniture"""
    return [FurnitureItem(**f) for f in MOCK_CATALOG]


if __name__ == "__main__":
    # Quick sanity check that mock data loads correctly
    room = get_room("room-001")
    catalog = get_furniture_catalog()
    print(f"Loaded room: {room.width}x{room.length} with {len(room.elements)} elements")
    print(f"Loaded catalog: {[f.name for f in catalog]}")
