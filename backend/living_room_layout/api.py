"""
Living Room Layout service.

Wraps the rule-based `living_room_layout` engine (no ML, no third-party deps
in the engine itself) behind a small API. Given the selected room's bounding
box (source-image pixels, from the wall detector) plus the door/window boxes
detected on the same floor plan, it:

  1. works out which door/window detections belong to *this* room,
  2. converts everything into the engine's own "floor-plan detector" input
     dialect (see living_room_layout/io_json.py: normalise_floorplan),
  3. runs the full rule pipeline (room analysis -> layout selection ->
     candidate generation -> hard/soft constraints -> optimisation),
  4. returns the generated furniture layout plus the analysed room structure.

This service remains stateless and takes detections in and returns a layout as
JSON. The frontend persists the result in Supabase, while rendering is left to
the frontend (inline SVG), so nothing here depends on database credentials or
matplotlib.

Run:
    python -m venv venv
    source venv/Scripts/activate     (Git Bash)   |   venv\\Scripts\\activate (PowerShell)
    pip install -r requirements.txt
    uvicorn api:app --reload --port 8100
"""

from __future__ import annotations

import contextlib
import copy
import io
import os
import sys
from typing import Any, Dict, List, Optional, Tuple

from fastapi import Body, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # so "import living_room_layout" resolves to the copied package

try:  # optional: load a local .env if python-dotenv is installed
    from dotenv import load_dotenv

    load_dotenv(os.path.join(HERE, ".env"))
except ImportError:
    pass

from living_room_layout.engine.pipeline import LayoutGenerator  # noqa: E402
from living_room_layout.io_json import InputError, Scenario, parse_scenario  # noqa: E402
from living_room_layout.layouts import ALL_LAYOUTS  # noqa: E402

# ── Config ─────────────────────────────────────────────────────────────
#: mm/px used ONLY when the room has no door to recover the real scale from
DEFAULT_MM_PER_PX = float(os.getenv("DEFAULT_MM_PER_PX", "20"))
#: how far (in source px) a door/window box may sit from the room bbox and
#: still count as belonging to it, as a fraction of the room's shorter side
OPENING_MARGIN_RATIO = float(os.getenv("OPENING_MARGIN_RATIO", "0.10"))
OPENING_MARGIN_MIN = float(os.getenv("OPENING_MARGIN_MIN", "15"))
OPENING_MARGIN_MAX = float(os.getenv("OPENING_MARGIN_MAX", "90"))
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if o.strip()
]
#: extra *optional* furniture added once the room's real area (only known
#: after scale recovery) crosses each threshold, so a large room doesn't end
#: up mostly empty with just a sofa and a coffee table. Purely additive —
#: every one of these is placed only if it fits (never required).
FURNITURE_BY_AREA_M2: List[Tuple[float, List[str]]] = [
    (16.0, ["rug"]),
    (22.0, ["lamp"]),
    (30.0, ["storage_cabinet"]),
]
#: which sofa variant each layout's own plan() actually calls "sofa" - see
#: the note in generate_all() for why this has to be corrected per layout.
SOFA_TYPES = ("sofa", "l_sofa", "loveseat")
SOFA_TYPE_BY_LAYOUT: Dict[str, str] = {"l_shaped": "l_sofa"}

app = FastAPI(title="Living Room Layout", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


# ── Helpers ────────────────────────────────────────────────────────────
BBox = Tuple[float, float, float, float]


def _bbox_xyxy(b: Dict) -> BBox:
    try:
        return float(b["x1"]), float(b["y1"]), float(b["x2"]), float(b["y2"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(400, "bbox needs numeric x1, y1, x2, y2")


def _overlaps(a: BBox, b: BBox, margin: float) -> bool:
    """True when box `b` intersects box `a` inflated by `margin` on every side."""
    ax1, ay1, ax2, ay2 = a[0] - margin, a[1] - margin, a[2] + margin, a[3] + margin
    bx1, by1, bx2, by2 = b
    return ax1 < bx2 and ax2 > bx1 and ay1 < by2 and ay2 > by1


def _prepare_scenario(payload: Dict[str, Any]) -> Tuple[Scenario, Dict[str, Any]]:
    """Shared setup for both endpoints: room+detections -> a parsed Scenario.

    Returns the scenario plus a metadata dict (roomId, scaleSource, doorsUsed,
    windowsUsed, notes) describing every assumption that had to be made.
    """
    room = payload.get("room") or {}
    room_bbox_in = room.get("bbox")
    if not room_bbox_in:
        raise HTTPException(400, "room.bbox is required")
    room_box = _bbox_xyxy(room_bbox_in)
    rx1, ry1, rx2, ry2 = room_box
    room_w_px, room_h_px = rx2 - rx1, ry2 - ry1
    if room_w_px <= 0 or room_h_px <= 0:
        raise HTTPException(400, "room.bbox has zero or negative size")

    margin = min(
        max(OPENING_MARGIN_RATIO * min(room_w_px, room_h_px), OPENING_MARGIN_MIN),
        OPENING_MARGIN_MAX,
    )

    # -- which detections belong to this room? -----------------------------
    doors: List[Dict] = []
    windows: List[Dict] = []
    for i, det in enumerate(payload.get("detections") or []):
        cls = str(det.get("class", "")).lower()
        bbox = det.get("bbox")
        if cls not in ("door", "window") or not bbox:
            continue
        box = _bbox_xyxy(bbox)
        if not _overlaps(room_box, box, margin):
            continue
        entry = {"id": det.get("id") or f"{cls}_{i + 1}", "x1": box[0], "y1": box[1], "x2": box[2], "y2": box[3]}
        (doors if cls == "door" else windows).append(entry)

    # -- scale: caller-provided, recovered from a door leaf, or a default --
    scale_m_per_px: Optional[float] = payload.get("scale_m_per_px")
    if scale_m_per_px:
        scale_source = "provided"
    elif doors:
        scale_source = "door"
        scale_m_per_px = None  # let the engine recover it from the median door box
    else:
        scale_source = "default"
        scale_m_per_px = DEFAULT_MM_PER_PX / 1000.0

    detector_payload: Dict[str, Any] = {
        "room_name": room.get("name") or "Living Room",
        "room_type": "Living Room",
        "room_id": room.get("id"),
        "bbox_px": {"x": rx1, "y": ry1, "width": room_w_px, "height": room_h_px},
        "doors": doors,
        "windows": windows,
        "user_requirements": {
            "purpose": payload.get("purpose") or "family_social",
            "preferred_layout": payload.get("preferred_layout"),
            "required_furniture": payload.get("required_furniture")
            or ["sofa", "coffee_table", "tv", "tv_console"],
            "optional_furniture": payload.get("optional_furniture") or ["chair", "side_table"],
            "excluded_furniture": payload.get("excluded_furniture") or [],
        },
    }
    if scale_m_per_px:
        detector_payload["scale_m_per_px"] = scale_m_per_px
    if payload.get("config"):
        detector_payload["config"] = payload["config"]
    if payload.get("furniture_overrides"):
        detector_payload["furniture_overrides"] = payload["furniture_overrides"]

    # normalise_floorplan() prints "[floorplan] ..." notes on every assumption
    # it has to make - capture them so the caller can see why, instead of
    # hiding them in the server's stdout.
    notes_buffer = io.StringIO()
    try:
        with contextlib.redirect_stdout(notes_buffer):
            scenario = parse_scenario(
                detector_payload, name=str(room.get("id") or room.get("name") or "living_room")
            )
    except InputError as exc:
        raise HTTPException(422, str(exc))

    # A handful of small pieces looks sparse in a genuinely large room (the
    # true size is only known now, after scale recovery) — fill it out a bit
    # more, but only when the caller left the furniture list to us.
    if not payload.get("optional_furniture"):
        for min_area, extra in FURNITURE_BY_AREA_M2:
            if scenario.room.area_m2 >= min_area:
                for extra_type in extra:
                    if extra_type not in scenario.requirements.optional_furniture:
                        scenario.requirements.optional_furniture.append(extra_type)

    notes = [
        (line.split("] ", 1)[1] if "] " in line else line)
        for line in notes_buffer.getvalue().splitlines()
        if line.strip()
    ]

    meta = {
        "roomId": room.get("id"),
        "scaleSource": scale_source,
        "doorsUsed": [d["id"] for d in doors],
        "windowsUsed": [w["id"] for w in windows],
        "notes": notes,
    }
    return scenario, meta


@app.post("/generate")
def generate(payload: Dict[str, Any] = Body(...)):
    """The single best layout the selector would automatically pick."""
    scenario, meta = _prepare_scenario(payload)
    try:
        result = LayoutGenerator(scenario).run()
    except Exception as exc:  # noqa: BLE001 - surface engine failures, don't 500 silently
        raise HTTPException(500, f"layout generation failed: {exc}")

    return {**meta, "layout": result.to_dict()}


@app.post("/generate-all")
def generate_all(payload: Dict[str, Any] = Body(...)):
    """All six layouts for the room, side by side - like `main.py --all-layouts`.

    Each layout is *forced*, so a layout the automatic selector would have
    skipped still produces its own plan and reports `valid: false` with the
    hard constraints it broke, which is the honest comparison.
    """
    base_scenario, meta = _prepare_scenario(payload)

    layouts: List[Dict[str, Any]] = []
    for layout in ALL_LAYOUTS:
        scenario = copy.deepcopy(base_scenario)
        scenario.requirements.preferred_layout = layout.name
        # `required_furniture` names ONE sofa variant and the engine applies
        # it to every layout uniformly - left alone, forcing plain "sofa"
        # (our default) silently replaces l_shaped's own corner l_sofa with a
        # straight one, defeating the one thing that makes it "L-shaped".
        # Swap in whichever sofa type this specific layout actually uses.
        wanted_sofa = SOFA_TYPE_BY_LAYOUT.get(layout.name, "sofa")
        scenario.requirements.required_furniture = [
            wanted_sofa if t in SOFA_TYPES else t for t in scenario.requirements.required_furniture
        ]
        try:
            result = LayoutGenerator(scenario, force_layout=layout.name).run()
            layouts.append(result.to_dict())
        except Exception as exc:  # noqa: BLE001 - one bad layout shouldn't sink the rest
            layouts.append({
                "layout": {"type": layout.name, "title": layout.title, "score": 0, "suitability_score": 0},
                "error": str(exc),
            })

    valid_layouts = [l for l in layouts if "error" not in l]
    best = max(
        valid_layouts,
        key=lambda l: (
            l["validation"]["valid"],
            -len(l["validation"]["unplaced_required_furniture"]),
            l["layout"]["score"],
        ),
        default=None,
    )

    return {
        **meta,
        "layouts": layouts,
        "bestLayout": best["layout"]["type"] if best else None,
    }
