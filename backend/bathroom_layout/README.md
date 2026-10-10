# Bathroom Layout service

A small FastAPI wrapper around a rule-based (no ML) bathroom layout engine.
Given a bathroom's bounding box plus the doors and windows detected on the floor
plan, it arranges a shower, a toilet, a washbasin and a storage cabinet, fixes
the mirror, the towel rails, the floor drain and any grab bars, and returns the
best layout for each shower corner, best first, each with a report against
fifteen fixture-arrangement rules.

The engine itself (`bathroom_layout/`) is pure Python with **zero** third-party
dependencies; `api.py` only adds the HTTP layer.

This is called from the app's Upload → Processing → Select Room → **View
Layouts** flow whenever the selected room's OCR'd name looks like a bathroom
("bath", "toilet", "WC", "washroom", "shower", "restroom", "lavatory"). It does
not touch the database.

## Setup

```bash
cd backend/bathroom_layout
python -m venv venv
source venv/Scripts/activate     # Git Bash on Windows
# venv\Scripts\activate          # PowerShell / cmd
# source venv/bin/activate       # macOS / Linux
pip install -r requirements.txt
```

## Run

```bash
uvicorn api:app --port 8400
```

- Health: `GET http://localhost:8400/health`
- Docs: `http://localhost:8400/docs`
- The rules: `GET http://localhost:8400/rules`
- Generate: `POST http://localhost:8400/generate-all` (or `/generate` for the best layout only)

Without the web server:

```bash
python -m bathroom_layout request.json --summary
```

## The fifteen rules

**Built in**: the generator never proposes a position that breaks it.
**Hard**: a position that breaks it is discarded, and the limit is re-checked on
the finished layout. **Scored**: a 0–1 mark, weighted into the 0–100 total and
reported with the measured numbers.

| # | Rule | Hard limit / built in | Scored on | Points |
|---|------|-----------------------|-----------|--------|
| 1 | Position the washbasin where it can be easily accessed from the bathroom entrance. | Reachable from the door (rule 4) | Distance from the doorway (full marks to 1.2 m), first fixture reached, nothing in the direct line | 8 |
| 2 | Arrange the toilet to provide sufficient space for comfortable use. | 380 mm from the pan's centre line to anything beside it; 500 mm clear in front | Up to 450 mm and 750 mm; out of the direct view from the door | 9 |
| 3 | Position the shower area to allow safe entry and exit. | Built in: in a corner, with a 700 mm way in. 600 mm of dry floor to step out on to | Up to 800 mm; clear of the room door's swing | 9 |
| 4 | Keep clear walking paths between the entrance, washbasin, toilet, and shower. | One continuous path ≥ 600 mm wide from the entrance to all three | 750 or 900 mm wide; floor that is cut off | 10 |
| 5 | Provide sufficient space in front of the washbasin for standing and washing. | 550 mm in front, 700 mm wide | Up to 750 mm in front, 450 mm of elbow room | 8 |
| 6 | Position bathroom cabinets so they do not obstruct movement or access to fixtures. | A cabinet never stands in the floor a fixture or a door needs, nor in front of a window | Clear of the direct lines from the door to each fixture and of the floor straight ahead of the door | 6 |
| 7 | Ensure cabinet doors and drawers can open without blocking essential walking paths. | An open door never hits a fixture | Each door is opened in turn: 500 mm must remain to reach the other fixtures; out of the room door's swing | 6 |
| 8 | Place towel racks within convenient reach of the shower or washbasin. | Built in: rail on the free wall nearest the way out of the shower, ring nearest the basin | The reach to each, full marks within 700 mm | 6 |
| 9 | Position mirrors above or near the washbasin at a suitable height. | Built in: above the basin, 1.1–1.9 m above the floor (from 0.9 m for a seated user) | Above the basin; on the side wall when a window is in the way; nowhere | 5 |
| 10 | Keep frequently used toiletries within easy reach. | Built in: a shelf inside the shower | Mirror cabinet over the basin; paper holder within 600 mm of the pan; storage one step from the basin | 5 |
| 11 | Arrange fixtures to reduce water splashing onto walking areas. | — | Shower furthest from the door; the route to basin and toilet avoids the wet floor outside the shower; walls enclosing the shower; not against a window | 7 |
| 12 | Keep the floor area unobstructed to reduce tripping risks. | Built in: every fixture against a wall; nothing in a door's swing | Floor covered, largest clear square, straight lines from the door to each fixture | 6 |
| 13 | Provide sufficient space for wheelchair or mobility-aid access where required. | When required: 1.5 m clear turning square, 800 mm beside the pan, 900 mm path | Those three and the door width. **Not applicable unless asked for** | 5 |
| 14 | Use suitable non-slip flooring and provide effective drainage to reduce water accumulation. | Built in: non-slip finish, 1:80 fall, drain in the wall corner of the shower | Water runs away from the door; longest run to the drain | 5 |
| 15 | Install appropriate grab bars near the toilet and shower when required by the user's mobility needs. | When required, built in: a bar in the shower and bars at the pan | Fixed bar on a side wall within 500 mm of the pan, rather than drop-down rails. **Not applicable unless asked for** | 5 |

Rules that do not apply to a room are left out and the total is rescaled to
0–100. Every number above lives in `bathroom_layout/config.py` and can be
overridden per request with a `config` block.

**What a bathroom gets.** A 1200 × 900 walk-in shower and a 900 mm vanity from
6 m², a 900 × 900 shower and a 600 mm vanity from 3.6 m², an 800 × 800 shower,
a short-projection toilet and a wall-hung basin below that; a separate tall
cabinet from 5 m². Under 2.4 m² the room is planned as a toilet room with no
shower. A room that cannot take its first choice falls back a size, down to a
760 × 760 shower.

**Mobility needs.** Send `"accessible": true` and the engine plans a
level-access shower, a comfort-height pan with transfer space and grab bars, a
basin with knee space and a lower mirror, and makes the limits of rule 13 hard.
If the room cannot give full wheelchair access, the closest layout is returned
marked *compromised*, listing exactly what is missing.

**What a floor plan does not say.** Doors are assumed to open *inward* and the
whole door-width square is kept clear. If nothing fits that way and the plan did
not state the swing, the room is planned again with those doors opening outward
and every layout says so. Window sills are taken as 900 mm. Existing drains and
soil stacks are not known and not considered. The floor finish, the fall and the
slip rating in rule 14 are a specification returned with the layout (`floor`),
not something measured from the plan.

## How it searches

1. Fixture sizes are fixed for the floor area and the user's needs.
2. The shower is tried in every corner, both ways round, with its way in on
   every open side.
3. For each shower the toilet is tried along every wall and the best positions
   on each wall are kept; for each of those, the same for the basin.
4. The most promising arrangement of each kind (shower corner, toilet wall,
   basin wall) is finished: the cabinet is added where every route stays open,
   the mirror, towels, drain and bars are fixed, the room is walked, and the
   layout is scored against all fifteen rules.
5. The best layout for each shower corner is returned, best first, with other
   toilet and basin walls filling the remaining slots.

The search is deterministic and takes about a second for the largest rooms.

## `POST /generate-all`

The request is the living-room service's, plus optional bathroom fields:

```jsonc
{
  "room": { "id": "room-5", "name": "Bathroom", "bbox": { "x1": 438.6, "y1": 306.4, "x2": 568.6, "y2": 388.8 } },
  "detections": [ /* every Door / Window on the plan; a door may carry "swing": "inward" | "outward" | "sliding" */ ],
  "rooms": [ /* optional: every room { id, name, bbox } */ ],
  "accessible": false,             // optional: the user has mobility needs (rules 13 and 15)
  "shower": true,                  // optional: decided from the floor area if left out
  "storage_cabinet": true,         // optional: decided from the floor area if left out
  "fixture_size": "standard",      // optional: large | standard | compact
  "scale_m_per_px": 0.01875        // optional: recovered from the door widths if left out
}
```

Each layout in the response has the living-room engine's fields, so the
frontend draws it with the same plan viewer, plus `rules[]` (one entry per rule
with `status`, `points`, `max_points`, `detail`), `floor` (finish, fall, drain
position), `fittings` (mirror, towel reach, paper holder, grab bars) and
`clear_square_mm`. Entries in `furniture[]` carry `mounted`: `"floor"` for
fixtures, `"wall"` for the mirror, towels and bars (drawn as thin strips on
their wall, with `mount_height`), `"drain"` for the floor drain.

## Tests

```bash
python -m unittest bathroom_layout.tests.test_engine -v
```

Standard library only. Every layout of ten test bathrooms is re-checked against
the hard limits with geometry written in the test file.

`geometry.py`, `room.py`, `floorplan.py` and `circulation.py` are the same
modules as the bedroom and kitchen engines', so each engine stays
self-contained; a fix to one should be mirrored in the others.

## Frontend wiring

`frontend/.env` (optional — this is the default):

```
VITE_BATHROOM_LAYOUT_URL=http://localhost:8400
```

`frontend/src/app/lib/bathroomLayout.ts` calls this from `ViewLayouts.tsx`
whenever the room selected on `/select-room` has a bathroom name.
