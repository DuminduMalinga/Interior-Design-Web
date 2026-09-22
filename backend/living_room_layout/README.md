# Living Room Layout service

A small FastAPI wrapper around a rule-based (no ML) furniture layout engine
copied from `C:/Users/HashTag/Desktop/LivingRoom`. Given a room's shell plus
its doors and windows, it analyses the geometry, picks one of six layout
types, places furniture, and returns a fully-explained, validated layout —
every position traceable to the rule that produced it.

The engine itself (`living_room_layout/`) is unmodified and has **zero**
third-party dependencies; `api.py` is the only new code here.

This is called from the app's Upload → Processing → Select Room → **View
Layouts** flow, only when the selected room's OCR'd name looks like a living
room. It does not touch the database.

## Setup

```bash
cd backend/living_room_layout
python -m venv venv
source venv/Scripts/activate     # Git Bash on Windows
# venv\Scripts\activate          # PowerShell / cmd
# source venv/bin/activate       # macOS / Linux
pip install -r requirements.txt
```

## Run

```bash
uvicorn api:app --reload --port 8100
```

- Health: `GET http://localhost:8100/health`
- Docs: `http://localhost:8100/docs`
- Generate: `POST http://localhost:8100/generate`

### `POST /generate`

Request body — the selected room's bbox (source-image pixels, from the wall
detector) plus **all** detections on that floor plan (only `Door`/`Window`
ones are used; anything overlapping the room's bbox, inflated by a small
margin, is treated as belonging to it):

```jsonc
{
  "room": { "id": "room-2", "name": "Living Room",
            "bbox": { "x1": 243.97, "y1": 80.81, "x2": 554.95, "y2": 414.63 } },
  "detections": [
    { "id": "det-5", "class": "Door", "bbox": { "x1": 399, "y1": 251, "x2": 445, "y2": 256 } },
    { "id": "det-9", "class": "Window", "bbox": { "x1": 116, "y1": 99, "x2": 127, "y2": 197 } }
  ],
  "purpose": "family_social",          // optional
  "preferred_layout": null,             // optional: force one of the 6 layouts
  "required_furniture": ["sofa", "coffee_table", "tv", "tv_console"],   // optional
  "optional_furniture": ["chair", "side_table"]                         // optional
}
```

Response:

```jsonc
{
  "roomId": "room-2",
  "scaleSource": "door",     // "provided" | "door" | "default"
  "doorsUsed": ["det-5"],
  "windowsUsed": ["det-9"],
  "notes": [ "door 'det-5' sits 12 px inside the room; projected onto the south wall" ],
  "layout": { /* the engine's full output — see below */ }
}
```

`layout` is the engine's own output JSON (room, layout type + score, every
placed `furniture[]` item with `reasons`, `validation` incl. circulation,
`explanation`, `reason` the layout was chosen, `openings.doors` / `.windows`
with their swing/clearance geometry, `scoring`, and `layout_selection`
ranking all six layouts). See the engine's own
[`../../../LivingRoom/README.md`](../../../../LivingRoom/README.md) §11 for
the full field reference — nothing in that shape was changed.

**Scale recovery.** Detected floor plans have no real-world units. If the
room has a detected door, the engine recovers millimetres-per-pixel from a
standard 900 mm leaf; only if there's no door at all does it fall back to
`DEFAULT_MM_PER_PX` (20, i.e. ~a 5000×4000 mm room from a ~250×200 px box) —
tune that in `.env` for your typical image resolution.

**No rendering here.** The engine's own matplotlib renderer is not used;
the frontend draws the room, openings and furniture itself as inline SVG
from this JSON (`frontend/src/app/components/LivingRoomPlan.tsx`), so it
matches the app's theme and stays interactive.

## Frontend wiring

`frontend/.env`:

```
VITE_LIVING_ROOM_LAYOUT_URL=http://localhost:8100
```

`frontend/src/app/lib/livingRoomLayout.ts` calls this from `ViewLayouts.tsx`
whenever the room selected on `/select-room` has "living" in its (OCR'd)
name; other room types keep the existing placeholder until their own engines
exist.
