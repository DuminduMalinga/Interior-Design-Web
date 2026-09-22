# Wall Detector service

FastAPI wrapper around the YOLO floor-plan model (`best.pt`).
Classes: **Wall, Room, Door, Window**. Task: object detection (bounding boxes).

The frontend calls this during the **Upload → Processing → Select Room** flow.
It reads an image and returns detections as JSON. It does **not** touch the database.

For every detected room the service also **OCRs the printed label** inside the box
(EasyOCR) to recover the human room name, and writes a per-floor-plan
`output/<floorPlanId>.json` file of room names + pixel dimensions. The same
structure is returned inline as `roomsJson` in the `/detect` response.

## Setup

```bash
cd backend/wall_detector

python -m venv venv

# activate the venv — pick the line for your shell:
source venv/Scripts/activate     # Git Bash / MSYS on Windows
# venv\Scripts\activate          # PowerShell / cmd on Windows
# source venv/bin/activate       # macOS / Linux

pip install -r requirements.txt
```

> If `pip install` prints "Requirement already satisfied ... in
> `...\miniconda3\...`", the venv is **not** active — activate it first, or call
> the venv's pip directly: `./venv/Scripts/python.exe -m pip install -r requirements.txt`.

Put the weights at `backend/wall_detector/models/best.pt` (already copied from
`C:/Users/HashTag/Desktop/WallDetectoor/best.pt`). To use a different location,
set `MODEL_PATH` in `.env` (copy `.env.example`).

## Run

```bash
uvicorn main:app --reload --port 8000
```

- Health:   `GET  http://localhost:8000/health`
- Docs:     `http://localhost:8000/docs`
- Detect:   `POST http://localhost:8000/detect`  (multipart form field `file`)

### `POST /detect`

Query params: `conf` (default 0.25), `iou` (default 0.45),
`room_conf` (default 0.35 — min confidence for the curated `rooms[]` list),
`annotate` (default true), `ocr` (default true — read room labels),
`floor_plan_id` (optional — names the `output/<id>.json` file; a UUID is used if omitted).

Response shape:

```jsonc
{
  "floorPlanId": "fp-a1b2c3d4e5f6",
  "imageWidth": 1024,
  "imageHeight": 768,
  "inferenceMs": 180,
  "counts": { "Wall": 24, "Room": 5, "Door": 6, "Window": 4 },
  "detectionCount": 39,
  "detections": [
    {
      "id": "det-0", "class": "Wall", "classId": 0, "confidence": 0.91,
      "bbox": { "x1": 12, "y1": 40, "x2": 480, "y2": 52 },
      "bboxPct": { "x": 1.17, "y": 5.21, "w": 45.7, "h": 1.56 }
    }
  ],
  "rooms": [
    {
      "id": "room-1",
      "name": "Master Bedroom",          // OCR'd label, or "Room 1" if none found
      "fallbackName": "Room 1",
      "labelDetected": true,
      "label": { "name": "Master Bedroom", "confidence": 0.82,
                 "raw": ["MASTER BEDROOM", "12'x14'"], "rawDimensions": ["12'x14'"] },
      "confidence": 0.88,
      "bbox": { "x1": 20, "y1": 60, "x2": 300, "y2": 260 },
      "bboxPct": { "x": 1.95, "y": 7.81, "w": 27.3, "h": 26.0 },
      "widthPx": 280, "heightPx": 200, "areaPx": 56000
    }
  ],
  "roomsJson": {
    "floorPlanId": "fp-a1b2c3d4e5f6",
    "generatedAt": "2026-09-03T09:15:00+00:00",
    "source": "plan.png",
    "unit": "px",
    "imageWidth": 1024, "imageHeight": 768,
    "roomCount": 5,
    "rooms": [
      {
        "id": "room-1", "name": "Master Bedroom", "labelDetected": true,
        "detectionConfidence": 0.88, "labelConfidence": 0.82,
        "ocrText": ["MASTER BEDROOM", "12'x14'"],
        "dimensions": { "widthPx": 280, "heightPx": 200, "areaPx": 56000 },
        "bbox": { "x1": 20, "y1": 60, "x2": 300, "y2": 260 }
      }
    ]
  },
  "roomsJsonFile": "fp-a1b2c3d4e5f6.json",   // written under ./output/
  "annotatedImage": "data:image/jpeg;base64,..."
}
```

`GET /rooms-json/<filename>` returns a previously written `output/*.json` file.

> **OCR notes.** EasyOCR downloads ~64 MB of models to `~/.EasyOCR/` on first run
> (needs internet once). Dimensions are always reported in **source-image pixels**;
> any dimension text found in a label is kept under `label.rawDimensions` /
> `ocrText` for reference but not used as the room size. Set `OCR_ENABLED=false`
> (or `?ocr=false`) to skip OCR — rooms then fall back to `Room 1`, `Room 2`, …

## Frontend wiring

`frontend/.env` must contain:

```
VITE_DETECTOR_URL=http://localhost:8000
```

`frontend/src/app/lib/wallDetector.ts` posts the uploaded file here from
`UploadFloorPlan`, and the result is carried through router state to
`Processing` → `SelectRoom`.
