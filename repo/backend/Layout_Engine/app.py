"""
API layer — matches the sequence diagram in Fig 2.8 (View Furniture Layout).
Runnable TODAY against mock data. When the DB is ready, flip
repository.USE_MOCK = False and this file doesn't change at all.

Run with:
    pip install fastapi uvicorn --break-system-packages
    uvicorn app:app --reload
Then open http://127.0.0.1:8000/docs to try it interactively.
"""

from fastapi import FastAPI, HTTPException
import repository
from layout_engine import generate_and_score

app = FastAPI(title="Layout Optimization Module")


@app.post("/api/rooms/{room_id}/layouts/generate")
def generate_layouts_endpoint(room_id: str, top_n: int = 5):
    try:
        room = repository.get_room(room_id)
    except KeyError:
        raise HTTPException(404, f"Room {room_id} not found")

    catalog = repository.get_furniture_catalog()
    results = generate_and_score(room, catalog, top_n=top_n)

    if not results:
        raise HTTPException(422, "No valid layouts could be generated for this room")

    repository.save_layouts(room_id, results)

    return {
        "roomId": room_id,
        "layoutCount": len(results),
        "layouts": [
            {
                "label": chr(65 + i),           # "A", "B", "C"...
                "score": r["score"],
                "breakdown": r["breakdown"],
                "recommended": i == 0,
                "furniture": r["layout"],
            }
            for i, r in enumerate(results)
        ],
    }


if __name__ == "__main__":
    # Smoke test without even starting the web server
    result = generate_layouts_endpoint("room-001")
    import json
    print(json.dumps(result, indent=2))
