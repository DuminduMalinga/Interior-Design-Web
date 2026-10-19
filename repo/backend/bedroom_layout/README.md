# Bedroom Layout service

A small FastAPI wrapper around a rule-based (no ML) bedroom furniture layout
engine. Given a bedroom's bounding box plus the doors and windows detected on
the floor plan, it picks the furniture for the room, arranges it according to
twelve furniture-arrangement rules, and returns every layout it found — best
first, each with a rule-by-rule report of how it did.

The engine itself (`bedroom_layout/`) is pure Python with **zero** third-party
dependencies; `api.py` only adds the HTTP layer.

This is called from the app's Upload → Processing → Select Room → **View
Layouts** flow whenever the selected room's OCR'd name contains "bed". It does
not touch the database.

## Setup

```bash
cd backend/bedroom_layout
python -m venv venv
source venv/Scripts/activate     # Git Bash on Windows
# venv\Scripts\activate          # PowerShell / cmd
# source venv/bin/activate       # macOS / Linux
pip install -r requirements.txt
```

## Run

```bash
uvicorn api:app --port 8200
```

- Health: `GET http://localhost:8200/health`
- Docs: `http://localhost:8200/docs`
- The rules: `GET http://localhost:8200/rules`
- Generate: `POST http://localhost:8200/generate-all` (or `/generate` for the best layout only)

Without the web server:

```bash
python -m bedroom_layout request.json --summary
```

## The twelve rules

Each rule is applied in up to three ways. **Built in**: the generator never
proposes a position that breaks it. **Hard**: a position that breaks it is
discarded, and the limit is re-checked on the finished layout. **Scored**: a
0–1 mark, weighted into the 0–100 total and reported with the measured numbers.

| # | Rule | Hard limit | Scored on | Points |
|---|------|-----------|-----------|--------|
| 1 | Position the bed so the occupant can see the bedroom entrance where practical. | — | Angle between the sleeper's line of sight and the doorway; tall furniture in the way | 10 |
| 2 | Consider the distance between the bed and the doorway. | — | Gap between bed and door opening (full marks from 1.5 m) | 6 |
| 3 | Consider the door-opening direction when positioning the bed. | Nothing in the area the leaf sweeps or on the 900 mm landing | Open floor straight ahead of the doorway | 8 |
| 4 | Consider window positions when selecting the bed location. | No bed in front of full-height glazing | Share of the headboard under a window; window access the bed takes away | 10 |
| 5 | Leave sufficient space beside the bed for comfortable access. | 600 mm on every side an occupant uses | Up to 750 mm beside, 900 mm at the foot | 12 |
| 6 | Place bedside tables within convenient reach of the bed. | Built in: a table always touches the bed at the pillow end | Tables placed out of tables wanted | 8 |
| 7 | Leave sufficient clearance in front of wardrobes and drawers. | 750 mm (wardrobe), 700 mm (drawers) | Up to 900 mm | 10 |
| 8 | Keep the walking path between the bedroom entrance, bed, and wardrobe clear. | A continuous path ≥ 600 mm reaches the bed, the storage and the desk | Path width (750 / 900 mm); floor that is cut off | 12 |
| 9 | Position study desks and chairs so they do not block essential walking paths. | Desk and chair stay out of every keep-clear zone | The route still works with the chair pulled out | 6 |
| 10 | Avoid placing tall furniture where it blocks windows or ventilation openings. | Nothing ≥ 1.1 m, or taller than the sill, in front of a window | 300 mm margin from the window edge | 5 |
| 11 | Arrange furniture according to room dimensions and the number of occupants. | Decides the furniture list | Bed fit, pieces placed, open floor, floor covered, leftover gaps | 9 |
| 12 | Keep frequently used items at convenient heights and within comfortable reach. | — | Bedside surface level with the mattress and in arm's reach; walk from bed to wardrobe | 4 |

Every number above lives in `bedroom_layout/config.py` and can be overridden per
request with a `config` block.

**Rule 11 — what a room gets.** One occupant below 10 m² (or narrower than
2.6 m), otherwise two, unless the request says. One occupant: single bed, a
double from 13 m². Two: double, queen from 13 m², king from 18 m². One bedside
table per occupant, a 2/3/4-door wardrobe by size, drawers from 13 m², a study
desk from 9 m² (one occupant) or 13 m² (two). If the first-choice bed does not
fit with every clearance intact, the next size down is tried.

**What a floor plan does not say.** The detector reports a door as a box in the
wall, with no swing. Doors are assumed to open *inward*, and the whole
door-width square is kept clear so the result holds whichever jamb the door is
hinged on. Send `"swing": "outward"` (or `"sliding"`) on a door detection to
override. Windows stand in for ventilation openings, with an assumed 900 mm sill.

## How it searches

1. Rule 11 fixes the furniture list.
2. The bed is tried at every position along every wall; illegal positions are
   dropped and the rest ranked by rules 1–6. Bedside tables are attached as the
   bed is placed.
3. The best bed positions on each wall are grown into complete layouts —
   wardrobe, then desk and chair, then drawers — each piece at every legal
   position on every wall. A partial layout is kept only while everything in it
   can still be walked to from the door.
4. Each finished layout is scored against all twelve rules.
5. The best layout for each distinct bed position is returned, best first.

Walkability is exact rather than pixel-based: the floor is cut along the edges
of every piece (grown by half a walker's width) and flood-filled, so a 600 mm gap
passes and a 590 mm one does not. The search is deterministic and takes well
under a second for an ordinary bedroom.

## `POST /generate-all`

Request body — the same shape the living-room service takes, plus two optional
bedroom fields:

```jsonc
{
  "room": { "id": "room-4", "name": "Bedroom 2",
            "bbox": { "x1": 574.6, "y1": 147.1, "x2": 779.0, "y2": 387.9 } },
  "detections": [   // every Door / Window on the plan; only those on this room's walls are used
    { "id": "det-23", "class": "Door",   "bbox": { "x1": 568.7, "y1": 334.0, "x2": 575.0, "y2": 382.2 } },
    { "id": "det-13", "class": "Window", "bbox": { "x1": 613.5, "y1": 131.4, "x2": 736.0, "y2": 147.7 } }
  ],
  "rooms": [ /* optional: every room { id, name, bbox } - tells the entrance from an en-suite door */ ],
  "occupants": 2,                      // optional: 1 or 2; inferred from the floor area if left out
  "bed_size": "queen",                 // optional: single | double | queen | king
  "excluded_furniture": ["desk"],      // optional; also required_furniture / optional_furniture
  "scale_m_per_px": 0.01875            // optional: recovered from the door widths if left out
}
```

Response:

```jsonc
{
  "roomId": "room-4",
  "scaleSource": "door",              // "provided" | "door" | "default"
  "doorsUsed": ["det-23"], "windowsUsed": ["det-13"],
  "notes": [ "No scale came with the plan; 18.8 mm per pixel was recovered from the 6 detected doors ..." ],
  "occupants": 2, "occupantsSource": "inferred",
  "programme": { "summary": "queen bed, 2 bedside tables, 4-door wardrobe, chest of drawers, study desk and chair" },
  "bestLayout": "bed_east_open",
  "layouts": [ /* one per bed position, best first */ ]
}
```

Each layout has the living-room engine's fields (`room`, `layout` with `type` /
`title` / `score`, `furniture[]` with `bbox` and `reasons`, `validation`,
`explanation`, `reason`, `scoring`, `openings`), so the frontend draws both with
the same plan viewer. On top of that it carries `rules[]` — one entry per rule
with `status`, `points`, `max_points` and the measured `detail`.

A layout that could only be produced by giving something up (a shared bed
reachable from one side, no room for the wardrobe) comes back with
`validation.valid: false` and the broken limits listed; it is never passed off
as valid. A room too small for any bed returns a single `{ "error": ... }` entry.

## Tests

```bash
python -m unittest bedroom_layout.tests.test_engine -v
```

Standard library only. Every layout of eleven test rooms is re-checked against
the hard limits with geometry written in the test file, independently of the
engine's own checks.

## Frontend wiring

`frontend/.env` (optional — this is the default):

```
VITE_BEDROOM_LAYOUT_URL=http://localhost:8200
```

`frontend/src/app/lib/bedroomLayout.ts` calls this from `ViewLayouts.tsx`
whenever the room selected on `/select-room` has "bed" in its (OCR'd) name.
