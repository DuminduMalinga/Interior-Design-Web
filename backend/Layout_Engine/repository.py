"""
Repository layer — the ONE place that knows where room/furniture data
comes from. Everything else (layout_engine, API routes) never talks to
mock_data.py or Supabase directly; it talks to this file.

Today:   USE_MOCK = True   -> reads from mock_data.py
Later:   USE_MOCK = False  -> reads from Supabase (uncomment the real code)

This is the entire integration step once your teammates' room-detection
module and the database are ready — you change ONE flag, not your algorithm.
"""

from layout_engine import Room, FurnitureItem

USE_MOCK = True


def get_room(room_id: str) -> Room:
    if USE_MOCK:
        import mock_data
        return mock_data.get_room(room_id)

    # --- Real implementation (uncomment when DB is ready) ---
    # from supabase_client import supabase
    # room_row = supabase.table("Room").select("*").eq("roomID", room_id).single().execute().data
    # element_rows = supabase.table("StructuralElement").select("*").eq("roomID", room_id).execute().data
    # from layout_engine import StructuralElement
    # elements = [
    #     StructuralElement(
    #         element_type=e["elementType"], x=e["positionX"], y=e["positionY"],
    #         width=e["size"], wall=e["orientation"]
    #     ) for e in element_rows
    # ]
    # return Room(width=room_row["width"], length=room_row["length"], elements=elements)
    raise NotImplementedError("Set up Supabase client and uncomment the real query above")


def get_furniture_catalog() -> list[FurnitureItem]:
    if USE_MOCK:
        import mock_data
        return mock_data.get_furniture_catalog()

    # --- Real implementation (uncomment when DB is ready) ---
    # from supabase_client import supabase
    # rows = supabase.table("Furniture").select("*").execute().data
    # return [
    #     FurnitureItem(name=r["furnitureName"], category=r["category"],
    #                    width=r["width"], length=r["length"])
    #     for r in rows
    # ]
    raise NotImplementedError("Set up Supabase client and uncomment the real query above")


def save_layouts(room_id: str, scored_layouts: list[dict]) -> None:
    """Stand-in for INSERT INTO Layout / FurnitureLayout (Fig 4.4)."""
    if USE_MOCK:
        print(f"[MOCK SAVE] Would insert {len(scored_layouts)} layouts for {room_id}")
        for i, l in enumerate(scored_layouts, 1):
            print(f"  Layout {chr(64+i)}: score={l['score']}")
        return

    # --- Real implementation (uncomment when DB is ready) ---
    # from supabase_client import supabase
    # for layout in scored_layouts:
    #     layout_row = supabase.table("Layout").insert({
    #         "roomID": room_id, "score": layout["score"]
    #     }).execute().data[0]
    #     for item in layout["layout"]:
    #         supabase.table("FurnitureLayout").insert({
    #             "layoutID": layout_row["layoutID"],
    #             "positionX": item["x"], "positionY": item["y"],
    #             "rotation": item["rotation"],
    #         }).execute()
    raise NotImplementedError("Set up Supabase client and uncomment the real query above")
