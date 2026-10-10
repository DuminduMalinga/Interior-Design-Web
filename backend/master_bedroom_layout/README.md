# Master Bedroom Layout service

A small FastAPI wrapper around a rule-based (no ML) master-bedroom layout
engine. Given a master bedroom's bounding box plus the doors and windows
detected on the floor plan, it arranges a bed with bedside tables, a wardrobe,
a dressing table and a study desk, fits the lighting, and returns one layout per
bed position, best first, each with a report against fifteen
furniture-arrangement rules.

The engine itself (`master_bedroom_layout/`) is pure Python with **zero**
third-party dependencies; `api.py` only adds the HTTP layer. It is built on the
bedroom engine's search (`backend/bedroom_layout`) with its own rule set.

This is called from the app's Upload → Processing → Select Room → **View
Layouts** flow whenever the selected room's OCR'd name reads as a master
bedroom ("Master Bedroom", "Main Bedroom", "Primary Bedroom", "M. Bed"). It
does not touch the database.

## Setup

```bash
cd backend/master_bedroom_layout
python -m venv venv
source venv/Scripts/activate     # Git Bash on Windows
# venv\Scripts\activate          # PowerShell / cmd
# source venv/bin/activate       # macOS / Linux
pip install -r requirements.txt
```

## Run

```bash
uvicorn api:app --port 8600
```

- Health: `GET http://localhost:8600/health`
- Docs: `http://localhost:8600/docs`
- The rules: `GET http://localhost:8600/rules`
- Generate: `POST http://localhost:8600/generate-all` (or `/generate` for the best layout only)

Without the web server:

```bash
python -m master_bedroom_layout request.json --summary
```

## The fifteen rules

**Built in**: the generator never proposes a position that breaks it.
**Hard**: a position that breaks it is discarded, and the limit is re-checked on
the finished layout. **Scored**: a 0–1 mark, weighted into the 0–100 total and
reported with the measured numbers.

| # | Rule | Hard limit / built in | Scored on | Points |
|---|------|-----------------------|-----------|--------|
| 1 | Position the bed according to room dimensions, door locations, and window positions. | Never in a door's swing or in front of full-height glazing | Bed size the room takes; distance from the doorway; view of the entrance from the pillow; open floor ahead of the door; solid wall behind the headboard | 9 |
| 2 | Provide sufficient space on both sides of the bed where practical. | 600 mm on each side an occupant uses — both sides for two | Up to 750 mm beside it and 900 mm at the foot | 9 |
| 3 | Keep a clear walking path between the bedroom entrance and the bed. | A continuous path ≥ 600 mm wide from the entrance to each side in use | 750 or 900 mm wide; nothing in the direct line | 8 |
| 4 | Place bedside tables within convenient reach of the bed. | Built in: a table touches the bed at the pillow end | Tables placed out of tables wanted | 6 |
| 5 | Leave sufficient clearance in front of wardrobes for opening doors and accessing clothes. | 750 mm in front (500 mm doors plus room to stand) | Up to 900 mm | 8 |
| 6 | Position wardrobes so they do not obstruct doors, windows, or walking paths. | Never in a door's swing, in front of a window or on the floor beside the bed | 300 mm margin from windows; distance from the doorway; out of the line from the entrance to the bed | 7 |
| 7 | Place dressing tables where occupants can use the mirror comfortably. | The mirror never stands in front of a window | Daylight on the face: a window to the side and near, not behind the person | 6 |
| 8 | Provide sufficient space in front of dressing tables and wardrobes for standing and movement. | 700 mm in front of the dressing table | Up to 900 mm; each piece's standing floor not shared with another piece or the bedside | 7 |
| 9 | Position study desks and chairs so they do not interfere with access to the bed. | Desk and chair stay off the floor beside the bed | The way to the bed still works with the chair pulled out. Not applicable without a desk | 5 |
| 10 | Keep frequently used personal items within comfortable reach. | — | Bedside surface level with the mattress and in arm's reach; a short walk to the wardrobe | 5 |
| 11 | Avoid overcrowding the room with unnecessary furniture. | Decides which optional pieces the room gets | Floor covered; largest clear square; leftover gaps too narrow to use | 6 |
| 12 | Arrange furniture to maintain access to windows and ventilation openings. | Nothing tall, and nothing taller than the sill, in front of a window | Window fronts left completely free; every window reachable on foot | 6 |
| 13 | Position bedroom lighting to support reading and other activities. | Built in: a reading lamp on each bedside table, a ceiling light over the open floor, a desk lamp, a light at the dressing mirror | A reading lamp for every sleeper | 5 |
| 14 | Consider the needs and preferences of all occupants when arranging furniture. | Decides bed and wardrobe sizes; honours the pieces asked for | A side of the bed, a bedside table and wardrobe space each; every requested piece placed | 6 |
| 15 | Maintain a clear route between the bed, wardrobe, bathroom entrance, and bedroom exit where applicable. | One continuous path ≥ 600 mm wide links them all | Its width; floor that is cut off; nothing in the direct line from the bed to the bathroom door | 7 |

Rules that do not apply to a room are left out and the total is rescaled to
0–100. Every number above lives in `master_bedroom_layout/config.py` and can be
overridden per request with a `config` block.

**What a master bedroom gets.** It is planned for two occupants unless the
request says one. Bed: a double below 13 m², a queen from 13 m², a king from
18 m². Wardrobe: three doors, four from 16 m². A dressing table with stool from
12 m²; a study desk from 18 m² (9 m² for one occupant). `required_furniture`,
`optional_furniture`, `excluded_furniture` and `bed_size` override all of this
(rule 14). A room that cannot take the first-choice bed falls back a size, and a
room too small for two is returned marked *compromised* with what is missing.

**The en-suite.** A second door that leads to a room named like a bathroom is
taken as the bathroom entrance: it is never the bedroom entrance, its swing is
kept clear, the walking route must reach it, and rule 15 reports the way to it
from the bed. This needs the `rooms` list in the request.

**What a floor plan does not say.** Doors are assumed to open *inward* and the
whole door-width square is kept clear. Window sills are taken as 900 mm.
Electrical points are not known: the light positions are a recommendation drawn
on the plan (`mounted`: `table`, `ceiling` or `wall`).

## `POST /generate-all`

The request is the living-room service's, plus optional fields:

```jsonc
{
  "room": { "id": "room-4", "name": "Master Bedroom", "bbox": { "x1": 574.6, "y1": 147.1, "x2": 779.0, "y2": 387.9 } },
  "detections": [ /* every Door / Window on the plan */ ],
  "rooms": [ /* optional: every room { id, name, bbox } - this is how the en-suite door is recognised */ ],
  "occupants": 2,                             // optional: 1 or 2 (default 2)
  "bed_size": "king",                         // optional: single | double | queen | king
  "required_furniture": ["desk"],             // optional
  "excluded_furniture": ["dressing_table"],   // optional
  "scale_m_per_px": 0.01875                   // optional: recovered from the door widths if left out
}
```

Each layout in the response has the living-room engine's fields, so the
frontend draws it with the same plan viewer, plus `rules[]` (one entry per rule
with `status`, `points`, `max_points`, `detail`). The dressing stool and the
lights are in `furniture[]` too; nothing is measured from them.

## Tests

```bash
python -m unittest master_bedroom_layout.tests.test_engine -v
```

Standard library only. Every layout of seven test rooms is re-checked against
the hard limits with geometry written in the test file.

`geometry.py`, `room.py`, `floorplan.py` and `circulation.py` are the same
modules as the other engines', so each engine stays self-contained; a fix to
one should be mirrored in the others.

## Frontend wiring

`frontend/.env` (optional — this is the default):

```
VITE_MASTER_BEDROOM_LAYOUT_URL=http://localhost:8600
```

`frontend/src/app/lib/masterBedroomLayout.ts` calls this from `ViewLayouts.tsx`
whenever the room selected on `/select-room` has a master-bedroom name.
