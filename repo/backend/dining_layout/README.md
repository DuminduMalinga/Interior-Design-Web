# Dining Layout service

A small FastAPI wrapper around a rule-based (no ML) dining-area layout engine.
Given a dining area's bounding box plus the doors and windows detected on the
floor plan, it places a dining table with its chairs, a sideboard and the
pendant light over the table according to twelve furniture-arrangement rules,
and returns the best layout for each part of the room the table can stand in,
best first, each with a rule-by-rule report.

The engine itself (`dining_layout/`) is pure Python with **zero** third-party
dependencies; `api.py` only adds the HTTP layer.

This is called from the app's Upload → Processing → Select Room → **View
Layouts** flow whenever the selected room's OCR'd name contains "din" (Dining
Room, Dining Area, Dinette) and is not a living room or a kitchen. It does not
touch the database.

## Setup

```bash
cd backend/dining_layout
python -m venv venv
source venv/Scripts/activate     # Git Bash on Windows
# venv\Scripts\activate          # PowerShell / cmd
# source venv/bin/activate       # macOS / Linux
pip install -r requirements.txt
```

## Run

```bash
uvicorn api:app --port 8500
```

- Health: `GET http://localhost:8500/health`
- Docs: `http://localhost:8500/docs`
- The rules: `GET http://localhost:8500/rules`
- Generate: `POST http://localhost:8500/generate-all` (or `/generate` for the best layout only)

Without the web server:

```bash
python -m dining_layout request.json --summary
```

## The twelve rules

**Built in**: the generator never proposes a position that breaks it.
**Hard**: a position that breaks it is discarded, and the limit is re-checked on
the finished layout. **Scored**: a 0–1 mark, weighted into the 0–100 total and
reported with the measured numbers.

| # | Rule | Hard limit / built in | Scored on | Points |
|---|------|-----------------------|-----------|--------|
| 1 | Place the dining table where occupants can access it easily. | Every side with chairs can be walked to from the entrance | Distance from the doorway (full marks to 2.5 m); nothing in the direct line | 8 |
| 2 | Leave sufficient space around the table for chairs to be pulled out. | 700 mm from the table edge to a wall or furniture on every side with chairs | Up to 900 mm | 12 |
| 3 | Keep clear walking paths around the dining table and chairs. | One continuous path ≥ 600 mm wide to every side with chairs | 750 or 900 mm wide; sides where someone can pass behind a seated person (1.1 m) | 10 |
| 4 | Select a dining table size that fits the available floor space. | Decides the table; a size down when the first choice does not fit | Share of the floor the table and seated diners cover (28 % full marks, 50 % none) | 8 |
| 5 | Arrange chairs so occupants can sit down and stand up comfortably. | Built in: one chair per 600 mm of table edge. A table end without chairs is against the wall or 600 mm off it | Table edge per person; free elbows for the chairs at the table's ends | 8 |
| 6 | Position the dining table to avoid blocking doors, windows, and entrances. | Table and pulled-out chairs stay out of every door's swing and landing | Distance to the nearest doorway; window fronts left free | 9 |
| 7 | Keep sufficient space between the dining table and nearby furniture. | 900 mm to the sideboard with chairs between, 600 mm otherwise | Up to 1.2 m | 7 |
| 8 | Position the dining area close to the kitchen when practical. | — | Distance from the table to the kitchen door, or to the wall nearest the kitchen. Not applicable when the plan shows no kitchen within 3 m | 8 |
| 9 | Ensure that the dining table does not obstruct the main circulation route. | — | With every chair occupied a 750 mm path still links the entrance to the other doors and the sideboard; the straight line between doors misses the diners | 10 |
| 10 | Arrange lighting to provide sufficient illumination over the dining table. | Built in: a pendant centred over the table, 750 mm above its top (two over a table of 2 m or more) | Daylight: distance from the table to the nearest window | 6 |
| 11 | Keep frequently used dining items within convenient reach. | — | The sideboard that holds tableware within 1.5 m of the table. Not applicable when no sideboard is planned | 6 |
| 12 | Arrange the dining furniture according to the number of occupants and expected use. | Decides the number of seats and the sideboard | Seats placed out of seats wanted | 8 |

Rules that do not apply to a room are left out and the total is rescaled to
0–100. Every number above lives in `dining_layout/config.py` and can be
overridden per request with a `config` block.

**What a dining area gets.** With `seats` (or `occupants`) in the request, the
smallest standard table that seats everyone: 800 mm square for two, 1.2 m for
four, 1.8 m for six, 2.2 m for eight. `"use": "entertaining"` adds two guest
seats to `occupants` and a sideboard. With neither, the floor area decides: two
seats below 6.5 m², four below 10.5 m², six below 19 m², eight above; a
sideboard from 10 m².

**What a floor plan does not say.** Doors are assumed to open *inward* and the
whole door-width square is kept clear. Window sills are taken as 900 mm, so the
850 mm sideboard may stand under a window. Ceiling points are not known: the
pendant position is a recommendation returned with the layout (`lighting`).

## How it searches

1. The seats, and with them the table, are fixed (rules 4 and 12).
2. The table is tried at every position across the floor, lengthways both
   ways; its chairs follow from it. Positions that break rule 2 or 6 are
   discarded and the rest are scored.
3. The best positions for every part of the room (centre, each side, each
   corner) and direction are finished: the sideboard goes on the wall that
   serves the table best while leaving every route open, the pendant is hung,
   and the room is walked twice — chairs pushed in (rule 3) and every chair
   occupied (rule 9).
4. The best layout for each part of the room is returned, best first.

The search is deterministic and takes well under a second.

## `POST /generate-all`

The request is the living-room service's, plus optional dining fields:

```jsonc
{
  "room": { "id": "room-1", "name": "Dining Room", "bbox": { "x1": 549.1, "y1": 392.6, "x2": 778.7, "y2": 676.5 } },
  "detections": [ /* every Door / Window on the plan */ ],
  "rooms": [ /* optional: every room { id, name, bbox } - this is how the kitchen is found */ ],
  "seats": 6,                      // optional: 2, 4, 6 or 8
  "occupants": 4,                  // optional: used when "seats" is left out
  "use": "everyday",               // optional: everyday | entertaining
  "sideboard": true,               // optional: decided from the floor area if left out
  "scale_m_per_px": 0.01875        // optional: recovered from the door widths if left out
}
```

Each layout in the response has the living-room engine's fields, so the
frontend draws it with the same plan viewer, plus `rules[]` (one entry per rule
with `status`, `points`, `max_points`, `detail`), `table` (seats, direction,
clearance on each side), `lighting` and `kitchen`. Chairs are drawn pushed in;
pendant lights carry `"mounted": "ceiling"`.

## Tests

```bash
python -m unittest dining_layout.tests.test_engine -v
```

Standard library only. Every layout of eight test rooms is re-checked against
the hard limits with geometry written in the test file.

`geometry.py`, `room.py`, `floorplan.py` and `circulation.py` are the same
modules as the bedroom, kitchen and bathroom engines', so each engine stays
self-contained; a fix to one should be mirrored in the others.

## Frontend wiring

`frontend/.env` (optional — this is the default):

```
VITE_DINING_LAYOUT_URL=http://localhost:8500
```

`frontend/src/app/lib/diningLayout.ts` calls this from `ViewLayouts.tsx`
whenever the room selected on `/select-room` has a dining name.
