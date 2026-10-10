# Kitchen Layout service

A small FastAPI wrapper around a rule-based (no ML) kitchen layout engine.
Given a kitchen's bounding box plus the doors and windows detected on the floor
plan, it lays out every classic kitchen shape the room allows — one-wall,
L-shaped, U-shaped, galley — places the sink, the stove, the refrigerator, the
worktops, utensil drawers and a dining table according to twelve
kitchen-arrangement rules, and returns the best kitchen of each shape, best
first, each with a rule-by-rule report.

The engine itself (`kitchen_layout/`) is pure Python with **zero** third-party
dependencies; `api.py` only adds the HTTP layer.

This is called from the app's Upload → Processing → Select Room → **View
Layouts** flow whenever the selected room's OCR'd name contains "kitchen". It
does not touch the database.

## Setup

```bash
cd backend/kitchen_layout
python -m venv venv
source venv/Scripts/activate     # Git Bash on Windows
# venv\Scripts\activate          # PowerShell / cmd
# source venv/bin/activate       # macOS / Linux
pip install -r requirements.txt
```

## Run

```bash
uvicorn api:app --port 8300
```

- Health: `GET http://localhost:8300/health`
- Docs: `http://localhost:8300/docs`
- The rules: `GET http://localhost:8300/rules`
- Generate: `POST http://localhost:8300/generate-all` (or `/generate` for the best layout only)

Without the web server:

```bash
python -m kitchen_layout request.json --summary
```

## The twelve rules

**Built in**: the generator never proposes a position that breaks it.
**Hard**: a position that breaks it is discarded, and the limit is re-checked on
the finished layout. **Scored**: a 0–1 mark, weighted into the 0–100 total and
reported with the measured numbers.

| # | Rule | Hard limit | Scored on | Points |
|---|------|-----------|-----------|--------|
| 1 | Position the sink in a convenient location for washing and food preparation. | 300 mm clear of an inside corner | Worktop on both sides, a window over it | 8 |
| 2 | Place the food preparation countertop close to the sink. | Built in: it starts at the sink. At least 600 mm long | Up to 900 mm | 8 |
| 3 | Arrange the sink, food preparation area, and stove to support a safe workflow. | Sink and stove never side by side | Sink, worktop, stove in one line; stove away from the doorway and not under a window | 12 |
| 4 | Consider the sink, stove, and refrigerator when planning the kitchen work triangle. | — | Each leg 1.2–2.7 m, 4.0–7.9 m round, nothing across a leg | 12 |
| 5 | Provide adequate countertop space near the stove. | 300 mm on one side; worktop between stove and refrigerator | 400 mm one side, 300 mm the other | 8 |
| 6 | Leave sufficient space for refrigerator doors to open fully. | The floor the door swings over is empty | A further 500 mm to stand in; clear of the room door | 7 |
| 7 | Arrange cupboards and drawers so they do not block essential walking paths when opened. | — | Each one is opened in turn; 500 mm must remain to reach sink, stove, refrigerator and table | 8 |
| 8 | Store frequently used cooking utensils near the preparation or cooking area. | Built in: a drawer unit always stands beside the stove | On the preparation side | 4 |
| 9 | Keep a clear working route between the sink, preparation area, stove, and refrigerator. | 900 mm clear in front of every unit; a path from the entrance to all three | Up to 1200 mm; nothing on the route; no through-traffic | 12 |
| 10 | Position the dining table and chairs so they do not interfere with cooking and washing activities. | People seated are off the floor in front of every unit | Outside the work triangle, reached without crossing it, away from the stove | 7 |
| 11 | Organize raw-food preparation and ready-to-eat food handling to reduce cross-contamination. | — | A second worktop apart from the one by the sink; food moving one way | 8 |
| 12 | Consider appliance dimensions, door-opening directions, and available floor space before finalizing the layout. | Decides appliance sizes; nothing tall in front of a window | Planned size fits, no two doors open into each other, clear floor left | 6 |

Every number above lives in `kitchen_layout/config.py` and can be overridden per
request with a `config` block.

**Rule 12 — what a kitchen gets.** Compact appliances below 7 m², standard up
to 14 m², large above. A dining table is tried from 9 m² (two seats, four from
12 m², six from 22 m²) unless the request says. A shape that cannot take the
planned appliances is tried again a size down; a table that fits nowhere clear
of the working floor is left out and reported.

**What a floor plan does not say.** Doors are assumed to open *inward* and the
whole door-width square is kept clear. Window sills are taken as 900 mm, level
with the worktop, so base units may stand under a window but the refrigerator
may not. Existing plumbing and gas points are not known and not considered.

## How it searches

1. Appliance sizes and the table are fixed for the floor area.
2. Door zones are cut out of each wall and every shape that still fits is laid
   out as counter runs.
3. For each shape the refrigerator is tried at every end of the worktop (or on
   its own in a corner or beside a door), the sink at every position, the stove
   at every position that leaves a preparation worktop. Each combination is
   ranked by rules 1–5 and 11.
4. The best combinations are built out — worktops named, utensil drawers put by
   the stove, the table seated in the floor left over — then walked and scored
   against all twelve rules.
5. The best kitchen of each shape is returned, best first.

The search is deterministic and takes under a second.

## `POST /generate-all`

The request is the living-room service's, plus optional kitchen fields:

```jsonc
{
  "room": { "id": "room-2", "name": "Kitchen", "bbox": { "x1": 129.3, "y1": 474.4, "x2": 382.3, "y2": 676.5 } },
  "detections": [ /* every Door / Window on the plan */ ],
  "rooms": [ /* optional: every room { id, name, bbox } */ ],
  "dining_table": true,            // optional: decided from the floor area if left out
  "seats": 4,                      // optional: 2, 4 or 6
  "appliance_size": "standard",    // optional: compact | standard | large
  "scale_m_per_px": 0.01875        // optional: recovered from the door widths if left out
}
```

Each layout in the response has the living-room engine's fields, so the
frontend draws it with the same plan viewer, plus `rules[]` (one entry per rule
with `status`, `points`, `max_points`, `detail`) and `work_triangle` (the three
points and leg lengths, drawn over the plan).

## Tests

```bash
python -m unittest kitchen_layout.tests.test_engine -v
```

Standard library only. Every layout of nine test kitchens is re-checked against
the hard limits with geometry written in the test file.

`geometry.py`, `room.py`, `floorplan.py` and `circulation.py` are the same
modules as the bedroom engine's, so each engine stays self-contained; a fix to
one should be mirrored in the other.

## Frontend wiring

`frontend/.env` (optional — this is the default):

```
VITE_KITCHEN_LAYOUT_URL=http://localhost:8300
```

`frontend/src/app/lib/kitchenLayout.ts` calls this from `ViewLayouts.tsx`
whenever the room selected on `/select-room` has "kitchen" in its (OCR'd) name.
