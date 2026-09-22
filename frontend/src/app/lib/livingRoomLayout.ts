/**
 * Client for the Living Room Layout service (backend/living_room_layout).
 *
 * Sends the selected room's bounding box + the door/window detections from
 * the wall detector; gets back a fully-explained, validated furniture layout
 * from the rule-based engine. Nothing here is persisted — the result flows
 * through router state only.
 */

const LAYOUT_URL = (
  import.meta.env.VITE_LIVING_ROOM_LAYOUT_URL ?? "http://localhost:8100"
).replace(/\/$/, "");

export type Wall = "north" | "south" | "east" | "west";
export type Facing = "north" | "south" | "east" | "west";

export interface LayoutDoor {
  id: string;
  wall: Wall;
  position: number;
  width: number;
  swing: "inward" | "outward" | "sliding" | "none";
  hinge: "left" | "right";
  is_main: boolean;
  center?: [number, number];
  clearance_zone?: [number, number, number, number];
  swing_area_m2?: number;
}

export interface LayoutWindow {
  id: string;
  wall: Wall;
  position: number;
  width: number;
  height: number;
  sill_height: number;
  center?: [number, number];
  access_zone?: [number, number, number, number];
  wall_coverage?: number;
}

export interface LayoutFurnitureItem {
  id: string;
  type: string;
  role: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  facing: Facing;
  bbox: [number, number, number, number];
  placement_strategy: string;
  reasons: string[];
  shape?: "l";
  variant?: "left" | "right";
  parts?: [number, number, number, number][];
}

export interface LivingRoomLayoutResult {
  room: { width: number; length: number; height: number; area_m2: number };
  layout: { type: string; title: string; score: number; suitability_score: number };
  furniture: LayoutFurnitureItem[];
  validation: {
    valid: boolean;
    inside_room_boundary: boolean;
    furniture_overlap: boolean;
    door_blocked: boolean;
    door_swing_blocked: boolean;
    window_blocked: boolean;
    circulation_valid: boolean;
    circulation: {
      valid: boolean;
      corridor_width_mm: number;
      walkable_reached_ratio: number;
      notes?: string[];
    } | null;
    hard_constraint_violations: unknown[];
    notes: string[];
    unplaced_required_furniture: unknown[];
  };
  explanation: string[];
  selected_layout: string;
  reason: string[];
  unplaced_furniture: Array<{ type: string; role: string; required: boolean; reasons: string[] }>;
  scoring: { total: number; components: Record<string, number>; contributions?: unknown[] };
  layout_selection: {
    ranking: Array<{ layout: string; score: number; feasible: boolean; reasons?: string[]; blockers?: string[] }>;
    rejected_layouts?: unknown[];
  };
  openings: { doors: LayoutDoor[]; windows: LayoutWindow[] };
  // Present but not strictly typed here — room_analysis, search, rules_applied, etc.
  [key: string]: unknown;
}

export interface GenerateLivingRoomLayoutResponse {
  roomId: string | null;
  scaleSource: "provided" | "door" | "default";
  doorsUsed: string[];
  windowsUsed: string[];
  notes: string[];
  layout: LivingRoomLayoutResult;
}

export interface GenerateLivingRoomLayoutRequest {
  room: { id: string; name?: string; bbox: { x1: number; y1: number; x2: number; y2: number } };
  detections: Array<{ id: string; class: string; bbox: { x1: number; y1: number; x2: number; y2: number } }>;
  purpose?: string;
  preferredLayout?: string;
  requiredFurniture?: string[];
  optionalFurniture?: string[];
  /** Real-world metres-per-pixel, when the wall detector recovered one from
   * the plan's own printed room areas — overrides the engine's own guess
   * (a detected door's width, or a fixed default) with the real scale. */
  scaleMPerPx?: number;
  signal?: AbortSignal;
}

/** One of the six layout entries in a /generate-all response — either a full
 * result, or an error if that particular forced layout blew up. */
export type LayoutOrError = LivingRoomLayoutResult | { layout: { type: string; title: string; score: number; suitability_score: number }; error: string };

export function isLayoutError(entry: LayoutOrError): entry is Extract<LayoutOrError, { error: string }> {
  return "error" in entry;
}

export interface GenerateAllLivingRoomLayoutsResponse {
  roomId: string | null;
  scaleSource: "provided" | "door" | "default";
  doorsUsed: string[];
  windowsUsed: string[];
  notes: string[];
  layouts: LayoutOrError[];
  /** layout `type` the engine would pick automatically, or null if none were valid */
  bestLayout: string | null;
}

async function postLayoutRequest<T>(path: string, req: GenerateLivingRoomLayoutRequest): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${LAYOUT_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room: req.room,
        detections: req.detections,
        purpose: req.purpose,
        preferred_layout: req.preferredLayout,
        required_furniture: req.requiredFurniture,
        optional_furniture: req.optionalFurniture,
        scale_m_per_px: req.scaleMPerPx,
      }),
      signal: req.signal,
    });
  } catch (err) {
    throw new Error(
      `Could not reach the living-room layout service at ${LAYOUT_URL}. ` +
        `Is it running? (${err instanceof Error ? err.message : "network error"})`,
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
    throw new Error(`Layout generation failed: ${detail}`);
  }

  return (await res.json()) as T;
}

/** The single best layout the automatic selector would pick. */
export async function generateLivingRoomLayout(
  req: GenerateLivingRoomLayoutRequest,
): Promise<GenerateLivingRoomLayoutResponse> {
  return postLayoutRequest<GenerateLivingRoomLayoutResponse>("/generate", req);
}

/** All six layouts for the room, side by side — for the comparison grid. */
export async function generateAllLivingRoomLayouts(
  req: GenerateLivingRoomLayoutRequest,
): Promise<GenerateAllLivingRoomLayoutsResponse> {
  return postLayoutRequest<GenerateAllLivingRoomLayoutsResponse>("/generate-all", req);
}
