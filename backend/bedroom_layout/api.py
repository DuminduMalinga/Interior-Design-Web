"""
Bedroom Layout service.

Wraps the rule-based `bedroom_layout` engine (pure Python, no third-party deps
in the engine itself) behind a small API. Given the selected room's bounding
box (source-image pixels, from the wall detector) plus the door/window boxes
detected on the same floor plan, it:

  1. works out which door/window detections lie on *this* room's walls and
     which door is the bedroom entrance,
  2. recovers the real-world scale and converts everything to millimetres,
  3. picks the furniture for the room size and the number of occupants,
  4. arranges it according to twelve bedroom furniture-arrangement rules,
  5. converts each layout's rules score (out of 100) to 90 points and adds up
     to 10 for the furniture it fits, the fullest layout earning all 10,
  6. returns every layout it found, best first, each with a rule-by-rule report.

The request and the response follow the living-room service, so the frontend
calls both the same way and draws both with the same plan viewer. The service
is stateless: detections in, layouts out, as JSON.

Run:
    python -m venv venv
    source venv/Scripts/activate     (Git Bash)   |   venv\\Scripts\\activate (PowerShell)
    pip install -r requirements.txt
    uvicorn api:app --port 8200
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict

from fastapi import Body, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # so "import bedroom_layout" resolves to the package next to this file

try:  # optional: load a local .env if python-dotenv is installed
    from dotenv import load_dotenv

    load_dotenv(os.path.join(HERE, ".env"))
except ImportError:
    pass

from bedroom_layout import InputError, generate_bedroom_layouts, rule_catalogue  # noqa: E402

# ── Config ─────────────────────────────────────────────────────────────
#: mm/px used ONLY when the plan has no door to recover the real scale from
DEFAULT_MM_PER_PX = float(os.getenv("DEFAULT_MM_PER_PX", "20"))
#: how far (in source px) a door/window box may sit from a wall line of the room
#: and still count as lying on that wall, as a fraction of the room's shorter side
OPENING_MARGIN_RATIO = float(os.getenv("OPENING_MARGIN_RATIO", "0.08"))
OPENING_MARGIN_MIN = float(os.getenv("OPENING_MARGIN_MIN", "10"))
OPENING_MARGIN_MAX = float(os.getenv("OPENING_MARGIN_MAX", "60"))
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if o.strip()
]

app = FastAPI(title="Bedroom Layout", version="1.0.0")
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


@app.get("/rules")
def rules():
    """The twelve rules and the extra furniture rule as written, and how the engine applies each one."""
    return {"rules": rule_catalogue()}


def _generate(payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        return generate_bedroom_layouts(
            payload,
            default_mm_per_px=DEFAULT_MM_PER_PX,
            margin_ratio=OPENING_MARGIN_RATIO,
            margin_min=OPENING_MARGIN_MIN,
            margin_max=OPENING_MARGIN_MAX,
        )
    except InputError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:  # noqa: BLE001 - surface engine failures, don't 500 silently
        raise HTTPException(500, f"layout generation failed: {exc}")


@app.post("/generate-all")
def generate_all(payload: Dict[str, Any] = Body(...)):
    """Every layout the room allows, best first - one per distinct bed position."""
    return _generate(payload)


@app.post("/generate")
def generate(payload: Dict[str, Any] = Body(...)):
    """The single best layout."""
    result = _generate(payload)
    best = result.pop("layouts")[0]
    if "error" in best:
        raise HTTPException(422, best["error"])
    return {**result, "layout": best}
