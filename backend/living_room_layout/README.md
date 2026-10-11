# Living Room Layout service

A small FastAPI wrapper around a rule-based (no ML) living-room layout engine.
Given a living room's bounding box plus the doors and windows detected on the
floor plan, it works out what the room is furnished for, builds each of six
layout types, and optimises and scores every one against ten
furniture-arrangement rules. Each layout comes back with a rule-by-rule report
and the reasoning behind every placement.

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

Without the web server, on one of the engine's own scenario files:

```bash
python -m living_room_layout.main living_room_layout/input/room_medium.json
python -m living_room_layout.tests.test_suite      # 38 checks, about two minutes
```

## The ten rules

**Decides**: the rule settles what is planned before anything is placed.
**Hard**: a position that breaks it is discarded while searching, and the limit
is re-checked on the finished layout. **Scored**: a 0–1 mark, weighted into the
0–100 total and reported with the measured numbers.

| # | Rule | Decides / hard limit | Scored on | Points |
|---|------|----------------------|-----------|--------|
| 1 | Arrange sofas and chairs to support face-to-face conversation. | Armchairs are only tried turned towards the sofa; a chair stays within 4.5 m of another seat | How squarely each chair faces the sofa; talking distance (1.2–3.0 m) | 12 |
| 2 | Arrange seating furniture to provide suitable views of other people. | — | Every pair of seats: one person sees the other without turning more than 60°, and nothing above eye level (1.1 m) stands between them | 8 |
| 3 | Divide the room into living, dining, and entertainment zones when necessary. | Decides the zones: one floor band per activity area when the room holds more than one | Pieces inside their own zone; a walkway between zones (300 mm, 900 mm for full marks); a clear view from the sofa to the screen. Not applicable to a single seating group | 8 |
| 4 | Keep doors, windows, and main walking paths unobstructed. | Nothing in a door opening, its swing or the 900 mm inside it; nothing tall in front of a window; a 900 mm path from the entrance to every seat and door | 1.2 m clear inside the doors; how much of each window front is free; a 1.2 m main path | 14 |
| 5 | Select furniture sizes that fit the available room space. | Decides the sizes: compact, standard or generous for the floor area, a size down when a layout cannot place its furniture | Every planned piece placed; the sofa between 30 % and 67 % of the room dimension it runs along | 8 |
| 6 | Position coffee tables and frequently used furniture within comfortable reach of seating areas. | Coffee table 400–900 mm from the sofa, with 400 mm round it | 400–500 mm, directly in front of the sofa; every seat with a table within arm's reach (700 mm); the lamp by the reading chair | 10 |
| 7 | Arrange furniture according to the household's daily activities. | Decides the furniture each activity needs; dining chairs keep 300 mm behind them | Each activity can be done: the sofa faces the screen at 1.8–4.5 m, the reading chair has shelves and light, the desk has daylight, the dining chairs can be pulled out | 12 |
| 8 | Maintain visual openness and avoid overcrowding. | An optional piece is left out rather than cost the room its walking path | Share of the floor left free (70 % full marks, 50 % none); the largest clear square; nothing tall in the view from the entrance | 10 |
| 9 | Position furniture to support comfortable movement between different activity areas. | One continuous 900 mm path reaches every seat, door and activity area | A 1.2 m path; the straight way to the other doors and areas does not cut between the sofa and its table | 10 |
| 10 | Consider the physical needs and accessibility requirements of occupants. | Decides the clearances: with mobility needs, 1.2 m inside every door, 900 mm behind a free-standing seat, no loose rug | A path to every seat; space to turn (1.5 m with mobility needs, 1.2 m otherwise); clear floor beside a seat | 8 |

Rules that do not apply to a room are left out and the total is rescaled to
0–100. The weights and every figure above live in `living_room_layout/config.py`
(`RuleWeights`, `RuleThresholds`, `Clearances`) and can be overridden per request
with a `config` block.

**What a living room gets.** Every room starts from a sofa and a coffee table.
The household's daily activities add the rest: a TV unit and screen for
watching TV, a bookshelf and reading chair for reading, a desk and chair for
working, a table with four or six chairs for dining; armchairs and side tables
are placed when they fit. With no `activities` in the request the engine
assumes conversation and TV, plus dining when the room's name says so
("Living / Dining"). Sizes follow the floor area: compact below 14 m² or in a
room narrower than 3 m (1.8 m sofa), generous from 26 m² (2.5 m sofa), standard
between. A rug is added from 16 m², a floor lamp from 22 m², a storage cabinet
from 30 m².

**What a floor plan does not say.** Doors are assumed to open *inward* with the
hinge on the lower side. Window sills are taken as 900 mm, so a sofa may stand
under a window (rule 4 marks it down for covering the glass).

## How it searches

1. The programme is fixed: activities, furniture, sizes and clearances (rules
   5, 7 and 10), and the zones when there is more than one activity area (rule 3).
2. For each layout type the pieces are placed one at a time, required pieces
   first. Every candidate position that breaks a hard limit is discarded; the
   rest are ranked by a fast local estimate of the same rules, and the best few
   partial layouts are kept (beam search).
3. Every finished layout is marked against the ten rules, and each piece is
   then re-placed in turn wherever that raises the mark (hill climbing).
4. If the layout still breaks a hard limit, optional pieces are left out until
   it does not; if a required piece found no place, the layout is tried again
   one furniture size down.

The search is deterministic. All six layouts take about 15 seconds for an
11 m² room, 40–50 seconds for 20 m² and about two minutes for 38 m².

## `POST /generate-all`

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
  "activities": ["conversation", "tv", "dining"],   // optional: conversation | tv | reading | work | dining
  "accessible": false,                  // optional: an occupant has mobility needs
  "purpose": "family_social",           // optional: used to assume the activities when none are given
  "preferred_layout": null,             // optional, /generate only: force one of the 6 layouts
  "required_furniture": ["sofa", "coffee_table", "tv", "tv_console"],   // optional: overrides the programme
  "optional_furniture": ["chair", "side_table"],                        // optional
  "scale_m_per_px": 0.01875             // optional: recovered from the door widths if left out
}
```

Response:

```jsonc
{
  "roomId": "room-2",
  "roomType": "living_room",
  "scaleSource": "door",     // "provided" | "door" | "default"
  "doorsUsed": ["det-5"],
  "windowsUsed": ["det-9"],
  "notes": [ "door 'det-5' sits 12 px inside the room; projected onto the south wall" ],
  "activities": ["conversation", "tv", "dining"],
  "activitiesSource": "provided",       // "inferred" when the engine assumed them
  "accessible": false,
  "accessibleSource": "provided",       // "default" when the request did not say
  "programme": { "size_tier": "standard", "summary": "Standard sizes for 20.0 m2: 2.2 m sofa, ...", /* ... */ },
  "layouts": [ /* six entries, one per layout type — see below */ ],
  "bestLayout": "conversation"          // valid, nothing required left out, highest score
}
```

Each entry of `layouts` (and `layout` in a `/generate` response) holds:

- `layout` — `type`, `title`, `score` (0–100, the ten rules) and `suitability_score`
- `rules` — the ten rules, each with `status`, `score`, `points`, `max_points`
  and a `detail` sentence with the measured numbers
- `furniture` — every placed piece with its `bbox`, `rotation` and `reasons`; a
  dining set is listed as a `dining_table` and its `dining_chair`s
- `validation` — the hard limits, including the walking-path check
- `programme` and `zones` — what was planned and the floor band of each zone
- `scoring` — `components` and `contributions`, both keyed by rule
- `unplaced_furniture`, `explanation`, `reason`, `openings`, `room_analysis`,
  `layout_selection` and `search` (the trace of the search itself)

**Scale recovery.** Detected floor plans have no real-world units. If the
room has a detected door, the engine recovers millimetres-per-pixel from a
standard 900 mm leaf; only if there's no door at all does it fall back to
`DEFAULT_MM_PER_PX` (20, i.e. ~a 5000×4000 mm room from a ~250×200 px box) —
tune that in `.env` for your typical image resolution.

**No rendering here.** The frontend draws the room, openings and furniture
itself as inline SVG from this JSON (`frontend/src/app/components/LivingRoomPlan.tsx`),
so it matches the app's theme and stays interactive.

## Frontend wiring

`frontend/.env`:

```
VITE_LIVING_ROOM_LAYOUT_URL=http://localhost:8100
```

`frontend/src/app/lib/livingRoomLayout.ts` calls this from `ViewLayouts.tsx`
whenever the room selected on `/select-room` has "living" in its (OCR'd) name.
The page offers the daily activities and the mobility-needs choice, and the
plan viewer shows the rule check beside the drawing.
