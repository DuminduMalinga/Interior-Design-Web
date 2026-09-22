"""
Wall Detector inference service.

Loads the YOLO floor-plan model (best.pt — classes: Wall, Room, Door, Window)
and exposes a single detection endpoint the frontend calls during the
Upload -> Processing -> Select Room flow.

Run:
    python -m venv venv
    venv\\Scripts\\activate        (Windows)   |   source venv/bin/activate   (POSIX)
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000

The model file is expected at ./models/best.pt. Override with MODEL_PATH.
This service remains stateless and returns detections as JSON. The frontend
persists the result in Supabase so the detector does not need database
credentials.

For every detected room the service also OCRs the printed label inside the box
(EasyOCR) to recover the human room name, and writes a per-floor-plan JSON file
of room names + pixel dimensions to ./output/.
"""

from __future__ import annotations

import base64
import io
import json
import math
import os
import re
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from functools import lru_cache

import numpy as np
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

# ── Config ─────────────────────────────────────────────────────────────
HERE = os.path.dirname(os.path.abspath(__file__))

try:  # optional: load a local .env if python-dotenv is installed
    from dotenv import load_dotenv

    load_dotenv(os.path.join(HERE, ".env"))
except ImportError:
    pass

MODEL_PATH = os.getenv("MODEL_PATH", os.path.join(HERE, "models", "best.pt"))
DEFAULT_CONF = float(os.getenv("DETECT_CONF", "0.25"))
DEFAULT_IOU = float(os.getenv("DETECT_IOU", "0.45"))
MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_BYTES", str(12 * 1024 * 1024)))
OUTPUT_DIR = os.getenv("OUTPUT_DIR", os.path.join(HERE, "output"))
OCR_ENABLED = os.getenv("OCR_ENABLED", "true").lower() not in ("0", "false", "no")
OCR_MIN_CONF = float(os.getenv("OCR_MIN_CONF", "0.30"))
os.makedirs(OUTPUT_DIR, exist_ok=True)
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if o.strip()
]


@lru_cache(maxsize=1)
def get_model():
    """Load the YOLO model once and cache it for the process lifetime."""
    from ultralytics import YOLO

    if not os.path.exists(MODEL_PATH):
        raise RuntimeError(
            f"Model file not found at {MODEL_PATH}. "
            "Copy best.pt into backend/wall_detector/models/ or set MODEL_PATH."
        )
    model = YOLO(MODEL_PATH)
    return model


@lru_cache(maxsize=1)
def get_reader():
    """Load the EasyOCR reader once (downloads ~64 MB of models on first run)."""
    import easyocr

    return easyocr.Reader(["en"], gpu=False, verbose=False)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Warm the model (and OCR reader) on startup so the first request isn't slow.
    try:
        get_model()
        print(f"[wall_detector] model loaded from {MODEL_PATH}")
    except Exception as exc:  # noqa: BLE001 - surface load errors at startup
        print(f"[wall_detector] WARNING: model not loaded yet: {exc}")
    if OCR_ENABLED:
        try:
            get_reader()
            print("[wall_detector] EasyOCR reader ready")
        except Exception as exc:  # noqa: BLE001
            print(f"[wall_detector] WARNING: OCR reader not loaded: {exc}")
    yield


app = FastAPI(title="Wall Detector", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Helpers ────────────────────────────────────────────────────────────
def _pct_box(x1: float, y1: float, x2: float, y2: float, w: int, h: int) -> dict:
    """Bounding box as percentages of image size — ready for CSS overlays."""
    return {
        "x": round(x1 / w * 100, 3),
        "y": round(y1 / h * 100, 3),
        "w": round((x2 - x1) / w * 100, 3),
        "h": round((y2 - y1) / h * 100, 3),
    }


def _annotated_data_uri(result) -> str:
    """result.plot() -> BGR ndarray -> base64 JPEG data URI."""
    bgr = result.plot()  # ndarray, H x W x 3, BGR
    rgb = bgr[:, :, ::-1]
    buf = io.BytesIO()
    Image.fromarray(rgb).save(buf, format="JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


_DIMENSION_HINT = re.compile(r"[x×]|\d\s*['\"′″]|mm|cm|\bm\b|\bft\b|sq", re.IGNORECASE)


def _looks_like_dimension(text: str) -> bool:
    """True for tokens like 12'x14', 3.5 m, 150 sq ft — not a room name."""
    if not any(c.isalpha() for c in text):
        return True
    return bool(re.search(r"\d", text)) and bool(_DIMENSION_HINT.search(text))


def _clean_name(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip(" .,:;-_/\\|")
    if text and (text.isupper() or text.islower()):
        text = text.title()
    return text


# Many floor-plan generators print each room's real area right in its label
# (e.g. "Living & Dining 28.5 m²") — when that's legible, it is a far better
# source of real-world scale than guessing, so it's worth pulling out.
_AREA_M2_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:sq\.?\s*m\b|sqm\b|m\s*[²2]\b)", re.IGNORECASE)
_AREA_SQFT_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:sq\.?\s*ft\b|sqft\b|ft\s*[²2]\b)", re.IGNORECASE)
#: OCR routinely drops the superscript "²" ("28.5 m²" -> "28.5 m"). A bare
#: "<number> m" is ambiguous in general (could be a wall length), but inside
#: a room's own OCR crop - and as long as it isn't part of a "12 x 14 m"
#: style width-by-length string - it is almost always the printed area, so
#: it is used as a last-resort fallback rather than dropped entirely.
_AREA_BARE_M_RE = re.compile(r"\b(\d+(?:\.\d+)?)\s*m\b", re.IGNORECASE)
_XY_DIMENSION_RE = re.compile(r"\d\s*[a-z\"'′″]*\s*[x×]\s*\d", re.IGNORECASE)
#: some floor-plan generators print each room's actual width x length
#: instead of (or as well as) its area - e.g. "Living Room 4.8 m x 4.0 m".
#: When that is legible it beats area-only text: it gives both real
#: dimensions directly rather than an area with the shape guessed from the
#: detected box's pixel aspect ratio.
_WXL_M_RE = re.compile(r"(\d+(?:\.\d+)?)\s*m?\s*[x×]\s*(\d+(?:\.\d+)?)\s*m\b", re.IGNORECASE)
SQFT_TO_M2 = 0.09290304


def _parse_wxl_m(raw_tokens: list[str]) -> tuple[float, float] | None:
    """Pull a printed "<width> m x <length> m" pair out of a room's raw OCR
    text, in the order printed. None if no such pair is legible."""
    joined = " ".join(raw_tokens)
    match = _WXL_M_RE.search(joined)
    if not match:
        return None
    try:
        return round(float(match.group(1)), 3), round(float(match.group(2)), 3)
    except ValueError:
        return None


def _parse_area_m2(raw_tokens: list[str]) -> float | None:
    """Pull a printed room area (e.g. "28.5 m²", "10.5m2", "150 sq ft", or
    "28.5 m" with a dropped superscript) out of a room's raw OCR text,
    normalised to square metres."""
    joined = " ".join(raw_tokens)
    match = _AREA_M2_RE.search(joined)
    if match:
        try:
            return round(float(match.group(1)), 3)
        except ValueError:
            pass
    match = _AREA_SQFT_RE.search(joined)
    if match:
        try:
            return round(float(match.group(1)) * SQFT_TO_M2, 3)
        except ValueError:
            pass
    if not _XY_DIMENSION_RE.search(joined):
        match = _AREA_BARE_M_RE.search(joined)
        if match:
            try:
                return round(float(match.group(1)), 3)
            except ValueError:
                pass
    return None


def _ocr_room_label(image: Image.Image, bbox: dict) -> dict:
    """OCR the text printed inside a room bounding box to recover its name."""
    empty = {"name": None, "confidence": None, "raw": [], "rawDimensions": []}
    try:
        reader = get_reader()
    except Exception:  # noqa: BLE001 - OCR is best-effort
        return empty

    w, h = image.size
    bw = bbox["x2"] - bbox["x1"]
    bh = bbox["y2"] - bbox["y1"]
    pad_x = max(6.0, bw * 0.04)
    pad_y = max(6.0, bh * 0.04)
    left = int(max(0, bbox["x1"] - pad_x))
    top = int(max(0, bbox["y1"] - pad_y))
    right = int(min(w, bbox["x2"] + pad_x))
    bottom = int(min(h, bbox["y2"] + pad_y))
    if right - left < 4 or bottom - top < 4:
        return empty

    crop = image.crop((left, top, right, bottom))
    if crop.width < 220:  # upscale small crops so OCR has something to work with
        factor = min(3, max(2, 220 // max(crop.width, 1)))
        crop = crop.resize((crop.width * factor, crop.height * factor))

    try:
        found = reader.readtext(np.asarray(crop), detail=1, paragraph=False)
    except Exception:  # noqa: BLE001
        return empty

    raw: list[str] = []
    name_tokens: list[str] = []
    dims: list[str] = []
    confs: list[float] = []
    for entry in found:
        text = str(entry[1]).strip()
        conf = float(entry[2]) if len(entry) > 2 else 0.0
        if not text:
            continue
        raw.append(text)
        if conf < OCR_MIN_CONF:
            continue
        if _looks_like_dimension(text):
            dims.append(text)
            continue
        alpha = sum(c.isalpha() for c in text)
        if alpha < 2:
            continue
        name_tokens.append(text)
        confs.append(conf)

    name = _clean_name(" ".join(name_tokens))
    return {
        "name": name or None,
        "confidence": round(max(confs), 4) if confs else None,
        "raw": raw,
        "rawDimensions": dims,
    }


# ── Routes ─────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    ok = os.path.exists(MODEL_PATH)
    return {
        "status": "ok" if ok else "model-missing",
        "modelPath": MODEL_PATH,
        "modelLoaded": get_model.cache_info().currsize > 0,
        "ocrEnabled": OCR_ENABLED,
        "ocrLoaded": get_reader.cache_info().currsize > 0,
        "outputDir": OUTPUT_DIR,
    }


@app.post("/detect")
async def detect(
    file: UploadFile = File(...),
    conf: float = Query(DEFAULT_CONF, ge=0.0, le=1.0),
    iou: float = Query(DEFAULT_IOU, ge=0.0, le=1.0),
    room_conf: float = Query(0.35, ge=0.0, le=1.0, description="Min confidence for the rooms[] list"),
    annotate: bool = Query(True),
    ocr: bool = Query(True, description="OCR the label inside each room box to recover its name"),
    floor_plan_id: str | None = Query(
        None, description="Used to name the output/<id>.json file; a UUID is generated if omitted"
    ),
):
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty file.")
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image exceeds the size limit.")

    try:
        image = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception:  # noqa: BLE001
        raise HTTPException(400, "File is not a readable image.")

    try:
        model = get_model()
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))

    width, height = image.size
    started = time.perf_counter()
    results = model.predict(source=image, conf=conf, iou=iou, verbose=False)
    elapsed_ms = round((time.perf_counter() - started) * 1000)

    result = results[0]
    names = result.names  # {0: 'Wall', 1: 'Room', ...}

    detections: list[dict] = []
    rooms: list[dict] = []
    counts: dict[str, int] = {}
    room_index = 0

    boxes = result.boxes
    if boxes is not None:
        for i in range(len(boxes)):
            cls_id = int(boxes.cls[i].item())
            label = names.get(cls_id, str(cls_id))
            score = round(float(boxes.conf[i].item()), 4)
            x1, y1, x2, y2 = (round(float(v), 2) for v in boxes.xyxy[i].tolist())

            counts[label] = counts.get(label, 0) + 1
            det = {
                "id": f"det-{i}",
                "class": label,
                "classId": cls_id,
                "confidence": score,
                "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                "bboxPct": _pct_box(x1, y1, x2, y2, width, height),
            }
            detections.append(det)

            if label.lower() == "room" and score >= room_conf:
                room_index += 1
                fallback_name = f"Room {room_index}"
                label_info = (
                    _ocr_room_label(image, det["bbox"])
                    if (ocr and OCR_ENABLED)
                    else {"name": None, "confidence": None, "raw": [], "rawDimensions": []}
                )
                area_px = round((x2 - x1) * (y2 - y1), 2)
                # a printed "W m x L m" beats area-only text: it gives both
                # real dimensions directly instead of an area whose shape has
                # to be guessed from the detected box's pixel aspect ratio.
                label_wxl = _parse_wxl_m(label_info["raw"]) if (ocr and OCR_ENABLED) else None
                label_area = (
                    round(label_wxl[0] * label_wxl[1], 3)
                    if label_wxl
                    else (_parse_area_m2(label_info["raw"]) if (ocr and OCR_ENABLED) else None)
                )
                rooms.append(
                    {
                        "id": f"room-{room_index}",
                        "name": label_info["name"] or fallback_name,
                        "fallbackName": fallback_name,
                        "labelDetected": label_info["name"] is not None,
                        "label": label_info,
                        "class": label,
                        "confidence": score,
                        "bbox": det["bbox"],
                        "bboxPct": det["bboxPct"],
                        "widthPx": round(x2 - x1, 2),
                        "heightPx": round(y2 - y1, 2),
                        "areaPx": area_px,
                        # populated below, once a scale can be resolved
                        "areaM2": label_area,
                        "labelWidthM": label_wxl[0] if label_wxl else None,
                        "labelHeightM": label_wxl[1] if label_wxl else None,
                        "areaSource": None,
                        "widthM": None,
                        "heightM": None,
                    }
                )

    # ── Real-world scale, recovered from any room's printed area ────────
    # Many floor-plan exports print each room's true area right in its
    # label (e.g. "Living & Dining 28.5 m²"). Where that's legible it beats
    # guessing: back out mm-per-pixel from area_m2 = (scale_mm_per_px/1000)^2
    # * area_px, take the median across every room that had one (robust to
    # a single OCR misread), then apply that ONE scale to every room so
    # figures stay consistent across the floor plan — including rooms whose
    # own label didn't include an area.
    scale_samples = [
        1000.0 * math.sqrt(r["areaM2"] / r["areaPx"])
        for r in rooms
        if r["areaM2"] and r["areaPx"] > 0
    ]
    scale_mm_per_px = None
    if scale_samples:
        scale_samples.sort()
        scale_mm_per_px = scale_samples[len(scale_samples) // 2]

    for r in rooms:
        if r["areaM2"]:
            r["areaSource"] = "ocr"
        if r["labelWidthM"] and r["labelHeightM"]:
            # exact printed dimensions for this room - use them as-is rather
            # than the scale-derived estimate below.
            r["widthM"] = r["labelWidthM"]
            r["heightM"] = r["labelHeightM"]
            r["areaSource"] = "ocr"
        elif scale_mm_per_px:
            scale_m_per_px = scale_mm_per_px / 1000.0
            r["widthM"] = round(r["widthPx"] * scale_m_per_px, 2)
            r["heightM"] = round(r["heightPx"] * scale_m_per_px, 2)
            if not r["areaM2"]:
                r["areaM2"] = round(r["widthM"] * r["heightM"], 2)
                r["areaSource"] = "estimated"

    # ── Per-floor-plan room JSON (names + pixel dimensions) ─────────────
    fp_id = floor_plan_id or f"fp-{uuid.uuid4().hex[:12]}"
    rooms_json = {
        "floorPlanId": fp_id,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": file.filename,
        "unit": "px",
        "scaleMmPerPx": round(scale_mm_per_px, 4) if scale_mm_per_px else None,
        "scaleSource": "ocr_area" if scale_mm_per_px else None,
        "imageWidth": width,
        "imageHeight": height,
        "roomCount": len(rooms),
        "rooms": [
            {
                "id": r["id"],
                "name": r["name"],
                "labelDetected": r["labelDetected"],
                "detectionConfidence": r["confidence"],
                "labelConfidence": r["label"]["confidence"],
                "ocrText": r["label"]["raw"],
                "dimensions": {
                    "widthPx": r["widthPx"],
                    "heightPx": r["heightPx"],
                    "areaPx": r["areaPx"],
                    "widthM": r["widthM"],
                    "heightM": r["heightM"],
                    "areaM2": r["areaM2"],
                    "areaSource": r["areaSource"],
                },
                "bbox": r["bbox"],
            }
            for r in rooms
        ],
    }
    safe_id = re.sub(r"[^A-Za-z0-9._-]", "_", fp_id)
    json_filename = f"{safe_id}.json"
    try:
        with open(os.path.join(OUTPUT_DIR, json_filename), "w", encoding="utf-8") as fh:
            json.dump(rooms_json, fh, indent=2, ensure_ascii=False)
        json_written: str | None = json_filename
    except OSError as exc:  # noqa: BLE001
        print(f"[wall_detector] WARNING: could not write {json_filename}: {exc}")
        json_written = None

    payload = {
        "floorPlanId": fp_id,
        "imageWidth": width,
        "imageHeight": height,
        "inferenceMs": elapsed_ms,
        "conf": conf,
        "iou": iou,
        "classNames": names,
        "counts": counts,
        "detectionCount": len(detections),
        "detections": detections,
        "rooms": rooms,
        # real-world scale recovered from printed room areas, if any were
        # legible — null when nothing on the plan gave a usable area
        "scaleMmPerPx": round(scale_mm_per_px, 4) if scale_mm_per_px else None,
        "scaleSource": "ocr_area" if scale_mm_per_px else None,
        "roomsJson": rooms_json,
        "roomsJsonFile": json_written,
    }
    if annotate:
        payload["annotatedImage"] = _annotated_data_uri(result)

    return payload


@app.get("/rooms-json/{filename}")
def get_rooms_json(filename: str):
    """Fetch a previously written output/<id>.json file."""
    safe = os.path.basename(filename)
    path = os.path.join(OUTPUT_DIR, safe)
    if not safe.endswith(".json") or not os.path.exists(path):
        raise HTTPException(404, "No such rooms JSON file.")
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)
