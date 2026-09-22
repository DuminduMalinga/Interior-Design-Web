/**
 * Client for the Wall Detector service (backend/wall_detector).
 *
 * Sends a floor-plan image to the YOLO model and returns detected
 * walls / rooms / doors / windows. Results are carried through router
 * state (Upload -> Processing -> Select Room); nothing is persisted.
 */

const DETECTOR_URL = (
  import.meta.env.VITE_DETECTOR_URL ?? "http://localhost:8000"
).replace(/\/$/, "");

export interface BBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Bounding box as percentages of the image — drop straight into CSS. */
export interface BBoxPct {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type DetectionClass = "Wall" | "Room" | "Door" | "Window" | string;

export interface Detection {
  id: string;
  class: DetectionClass;
  classId: number;
  confidence: number;
  bbox: BBox;
  bboxPct: BBoxPct;
}

/** What OCR read from the label printed inside a room box. */
export interface RoomLabel {
  name: string | null;
  confidence: number | null;
  raw: string[];
  rawDimensions: string[];
}

export type AreaSource = "ocr" | "estimated" | null;

export interface DetectedRoom {
  id: string;
  /** OCR'd room name, or the fallback ("Room 1", "Room 2", …). */
  name: string;
  fallbackName: string;
  labelDetected: boolean;
  label: RoomLabel;
  class: "Room";
  confidence: number;
  bbox: BBox;
  bboxPct: BBoxPct;
  widthPx: number;
  heightPx: number;
  areaPx: number;
  /** Real-world size, derived from a printed area on this room's own label
   * ("ocr") or from the floor plan's shared scale ("estimated") — null when
   * nothing on the whole plan gave a usable scale. */
  widthM: number | null;
  heightM: number | null;
  areaM2: number | null;
  areaSource: AreaSource;
}

/** The per-floor-plan room summary the service also writes to output/<id>.json. */
export interface RoomsJson {
  floorPlanId: string;
  generatedAt: string;
  source: string | null;
  unit: "px";
  scaleMmPerPx: number | null;
  scaleSource: "ocr_area" | null;
  imageWidth: number;
  imageHeight: number;
  roomCount: number;
  rooms: Array<{
    id: string;
    name: string;
    labelDetected: boolean;
    detectionConfidence: number;
    labelConfidence: number | null;
    ocrText: string[];
    dimensions: {
      widthPx: number;
      heightPx: number;
      areaPx: number;
      widthM: number | null;
      heightM: number | null;
      areaM2: number | null;
      areaSource: AreaSource;
    };
    bbox: BBox;
  }>;
}

export interface DetectionResult {
  floorPlanId: string;
  imageWidth: number;
  imageHeight: number;
  inferenceMs: number;
  conf: number;
  iou: number;
  classNames: Record<string, string>;
  counts: Partial<Record<DetectionClass, number>>;
  detectionCount: number;
  detections: Detection[];
  rooms: DetectedRoom[];
  /** Real-world mm-per-pixel recovered from any room's printed area, or null. */
  scaleMmPerPx: number | null;
  scaleSource: "ocr_area" | null;
  roomsJson: RoomsJson;
  roomsJsonFile: string | null;
  annotatedImage?: string;
}

export interface DetectOptions {
  conf?: number;
  iou?: number;
  annotate?: boolean;
  ocr?: boolean;
  /** Names the server-side output/<id>.json file. */
  floorPlanId?: string;
  signal?: AbortSignal;
}

/** POST the image to /detect. Throws on network / non-2xx responses. */
export async function detectFloorPlan(
  file: File,
  opts: DetectOptions = {},
): Promise<DetectionResult> {
  const params = new URLSearchParams();
  if (opts.conf != null) params.set("conf", String(opts.conf));
  if (opts.iou != null) params.set("iou", String(opts.iou));
  if (opts.annotate != null) params.set("annotate", String(opts.annotate));
  if (opts.ocr != null) params.set("ocr", String(opts.ocr));
  if (opts.floorPlanId) params.set("floor_plan_id", opts.floorPlanId);

  const form = new FormData();
  form.append("file", file, file.name);

  const qs = params.toString();
  let res: Response;
  try {
    res = await fetch(`${DETECTOR_URL}/detect${qs ? `?${qs}` : ""}`, {
      method: "POST",
      body: form,
      signal: opts.signal,
    });
  } catch (err) {
    throw new Error(
      `Could not reach the wall detector at ${DETECTOR_URL}. ` +
        `Is the service running? (${err instanceof Error ? err.message : "network error"})`,
    );
  }

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* keep status text */
    }
    throw new Error(`Wall detection failed: ${detail}`);
  }

  return (await res.json()) as DetectionResult;
}

export async function detectorHealth(signal?: AbortSignal) {
  const res = await fetch(`${DETECTOR_URL}/health`, { signal });
  if (!res.ok) throw new Error(`Detector health check failed: ${res.status}`);
  return res.json() as Promise<{
    status: string;
    modelPath: string;
    modelLoaded: boolean;
  }>;
}
