# Living Room Layout service

A small FastAPI wrapper around a rule-based (no ML) living-room layout engine.
Given a living room's bounding box plus the doors and windows detected on the
floor plan, it places a sofa, armchairs, a coffee table, side tables, a TV unit
and a rug — and a dining table, a desk or a reading corner when the household's
daily activities call for one — according to ten furniture-arrangement rules,
and returns the best layout for each way the seating group can stand, best
first, each with a rule-by-rule report.

The engine itself (`living_room_layout/`) is pure Python with **zero**
third-party dependencies; `api.py` only adds the HTTP layer.

This is called from the app's Upload → Processing → Select Room → **View
Layouts** flow whenever the selected room's OCR'd name contains "living". It
does not touch the database.

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
uvicorn api:app --port 8100
```

- Health: `GET http://localhost:8100/health`
- Docs: `http://localhost:8100/docs`
- The rules: `GET http://localhost:8100/rules`
- Generate: `POST http://localhost:8100/generate-all` (or `/generate` for the best layout only)

Without the web server:

```bash
python -m living_room_layout request.json --summary
```

## The ten rules

**Built in**: the generator never proposes a position that breaks it.
**Hard**: a position that breaks it is discarded, and the limit is re-checked on
the finished layout. **Scored**: a 0–1 mark, weighted into the 0–100 total and
reported with the measured numbers.

| # | Rule | Hard limit / built in | Scored on | Points |
|---|------|-----------------------|-----------|--------|
| 1 | Arrange sofas and chairs to support face-to-face conversation. | Built in: the armchairs stand across the coffee table from the sofa, or at its ends, turned to it | Seat-to-seat distance (0.9–2.7 m full marks); every seat facing the centre of the group; planned seats placed | 12 |
| 2 | Arrange seating furniture to provide suitable views of other people. | — | How far each person turns to see each of the others (within 60° is no turn); nothing tall between them; the entrance in view from the sofa | 8 |
| 3 | Divide the room into living, dining, and entertainment zones when necessary. | Built in: sofa, armchairs and TV form one living and entertainment zone on a rug. A dining table, desk or reading corner stands ≥ 600 mm clear of it | Up to 900 mm between zones. Not applicable when the activities need one zone only | 8 |
| 4 | Keep doors, windows, and main walking paths unobstructed. | Nothing in a door's swing or landing; nothing tall in front of a window | Distance from the furniture to the nearest doorway (full marks from 1.5 m); window fronts left free; the straight line between the doors | 12 |
| 5 | Select furniture sizes that fit the available room space. | Decides the furniture: compact, standard or generous by floor area; an armchair fewer, then a class down, when it does not fit | Sofa length against the room (65 % full marks, 90 % none); the class placed; planned pieces placed | 10 |
| 6 | Position coffee tables and frequently used furniture within comfortable reach of seating areas. | Built in: the coffee table 400 mm in front of the sofa (350–500 mm re-checked) | Every seat with a table within 600 mm; a side table at the sofa's end | 10 |
| 7 | Arrange furniture according to the household's daily activities. | Decides the furniture. The TV ≥ 1.5 m from the sofa and within 35° of straight ahead; 700 mm behind every dining chair | How well each activity is provided for: seats, viewing distance (2.0–3.6 m) and angle, dining seats, daylight at the desk and the reading chair | 12 |
| 8 | Maintain visual openness and avoid overcrowding. | — | Share of the floor the furniture covers (28 % full marks, 45 % none); the largest clear square of floor against the room's shorter side | 10 |
| 9 | Position furniture to support comfortable movement between different activity areas. | One continuous path ≥ 600 mm wide links the entrance to the seating, every other zone and every other door | 750 or 900 mm wide; the width of the seating group's open side | 10 |
| 10 | Consider the physical needs and accessibility requirements of occupants. | With `accessible`: every path ≥ 900 mm, no loose rug | Path width; a 1.5 m turning space; a place for a wheelchair in the seating group | 8 |

Rules that do not apply to a room are left out and the total is rescaled to
0–100. Every number above lives in `living_room_layout/config.py` and can be
overridden per request with a `config` block.

**What a living room gets.** The floor area picks the size class:

| Class | Floor area | Sofa | Armchairs | Coffee table | TV unit | Dining table |
|-------|-----------|------|-----------|--------------|---------|--------------|
| compact | under 12 m² | 1.5 m two-seat | 1 | 900 × 500 | 1.2 m | 800 mm for two |
| standard | 12–20 m² | 2.1 m three-seat | 2 | 1.1 m × 600 | 1.6 m | 1.2 m for four |
| generous | 20 m² and over | 2.4 m three-seat | 2 | 1.3 m × 700 | 2.0 m | 1.8 m for six |

`activities` decides the rest: `conversation` (always), `tv` (TV unit and
screen), `dining` (table and chairs), `work` (desk and chair), `reading`
(reading chair and floor lamp, plus a bookshelf outside the compact class).
With no activities given, conversation and TV are assumed, dining when the
room's name says so ("Living / Dining"), and a reading corner from 25 m².
`occupants` sets the number of armchairs: one per person the sofa does not seat.

**What a floor plan does not say.** Doors are assumed to open *inward* and the
whole door-width square is kept clear. Window sills are taken as 900 mm, so a
sofa or a desk may stand under a window but the TV, a lamp or a bookshelf may
not.

## How it searches

1. The furniture is fixed (rules 5, 7 and 10).
2. The seating group — sofa, coffee table and armchairs, with the TV unit on
   the wall the sofa looks at — is tried at every position across the floor,
   looking each of the four ways, with the sofa against the wall or far enough
   off it to walk behind. With a TV the armchairs stand at the ends of the
   coffee table (a U, or an L with one armchair); without one they may also
   stand across it, face to face. Positions that break a hard limit are
   discarded and the rest are scored.
3. The best positions of every kind are furnished: side tables at the sofa's
   ends, then a zone for each further activity clear of the seating, then the
   rug; and the room is walked from the entrance to every area.
4. The best layout for each direction the sofa can look is returned, best
   first. When the full group fits in only a few ways, arrangements with one
   armchair fewer fill the remaining slots.

The search is deterministic and takes well under a second.

## `POST /generate-all`

The request has the same shape as the other room services', plus optional
living-room fields:

```jsonc
{
  "room": { "id": "room-1", "name": "Living Room", "bbox": { "x1": 549.1, "y1": 392.6, "x2": 778.7, "y2": 676.5 } },
  "detections": [ /* every Door / Window on the plan */ ],
  "rooms": [ /* optional: every room { id, name, bbox } - a dining table is drawn towards the kitchen door */ ],
  "activities": ["conversation", "tv", "dining"],   // optional: conversation | tv | reading | work | dining
  "occupants": 4,                  // optional: decided from the floor area if left out
  "accessible": false,             // optional: an occupant has mobility needs
  "scale_m_per_px": 0.01875        // optional: recovered from the door widths if left out
}
```

Each layout in the response has the fields the plan viewer draws for every
room engine, plus `rules[]` (one entry per rule with `status`, `points`,
`max_points`, `detail`), `seating` (arrangement, direction, seats, viewing
distance and angle) and `zones`. Every piece carries the `zone` it belongs to.
The rug and chairs pushed in under a table take up no floor of their own; the
television carries `"mounted": "wall"`.

## Tests

```bash
python -m unittest living_room_layout.tests.test_engine -v
```

Standard library only. Every layout of nine test rooms is re-checked against
the hard limits with geometry written in the test file.

`geometry.py`, `room.py`, `floorplan.py` and `circulation.py` are the same
modules as the bedroom, kitchen, bathroom and dining engines', so each engine
stays self-contained; a fix to one should be mirrored in the others.

## Frontend wiring

`frontend/.env` (optional — this is the default):

```
VITE_LIVING_ROOM_LAYOUT_URL=http://localhost:8100
```

`frontend/src/app/lib/livingRoomLayout.ts` calls this from `ViewLayouts.tsx`
whenever the room selected on `/select-room` has a living-room name.
