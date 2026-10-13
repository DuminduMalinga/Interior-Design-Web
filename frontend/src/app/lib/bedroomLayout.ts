/**
 * Client for the Bedroom Layout service (backend/bedroom_layout).
 *
 * Sends the selected room's bounding box + the door/window detections from
 * the wall detector; gets back every layout the rule-based engine found, best
 * first, each scored against the twelve bedroom furniture-arrangement rules.
 *
 * The response has the same shape as the living-room service's, so the same
 * plan viewer draws it; the bedroom-only extras are typed here.
 */

import type { GenerateAllLivingRoomLayoutsResponse } from "./livingRoomLayout";

const LAYOUT_URL = (
  import.meta.env.VITE_BEDROOM_LAYOUT_URL ?? "http://localhost:8200"
).replace(/\/$/, "");

type Bbox = { x1: number; y1: number; x2: number; y2: number };

/** How one layout does against one of the twelve rules. */
export interface BedroomRuleResult {
  id: string;
  key: string;
  title: string;
  /** The rule as written. */
  rule: string;
  status: "satisfied" | "partly_satisfied" | "not_satisfied" | "not_applicable";
  /** 0..1 */
  score: number;
  points: number;
  max_points: number;
  /** The measured numbers behind the score. */
  detail: string;
}

export interface GenerateAllBedroomLayoutsResponse extends GenerateAllLivingRoomLayoutsResponse {
  roomType: "bedroom";
  occupants: 1 | 2;
  /** "inferred" when the engine guessed the head count from the floor area */
  occupantsSource: "provided" | "inferred";
  programme: {
    occupants: number;
    bed_sizes: string[];
    bedside_tables: number;
    wardrobe_sizes: string[];
    dresser: boolean;
    desk: boolean;
    /** e.g. "queen bed, 2 bedside tables, 4-door wardrobe" */
    summary: string;
  };
}

export interface GenerateBedroomLayoutsRequest {
  room: { id: string; name?: string; bbox: Bbox };
  detections: Array<{ id: string; class: string; bbox: Bbox }>;
  /** Every room on the plan — lets the engine tell the bedroom entrance from
   * the door to an en-suite. */
  rooms?: Array<{ id: string; name: string; bbox: Bbox }>;
  /** Leave out to let the engine infer it from the room size. */
  occupants?: 1 | 2;
  /** Real-world metres-per-pixel, when the wall detector recovered one. */
  scaleMPerPx?: number;
  signal?: AbortSignal;
}

/** Every layout the room allows, best first — one per distinct bed position. */
export async function generateAllBedroomLayouts(
  req: GenerateBedroomLayoutsRequest,
): Promise<GenerateAllBedroomLayoutsResponse> {
  let res: Response;
  try {
    res = await fetch(`${LAYOUT_URL}/generate-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room: req.room,
        detections: req.detections,
        rooms: req.rooms,
        occupants: req.occupants,
        scale_m_per_px: req.scaleMPerPx,
      }),
      signal: req.signal,
    });
  } catch (err) {
    throw new Error(
      `Could not reach the bedroom layout service at ${LAYOUT_URL}. ` +
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

  return (await res.json()) as GenerateAllBedroomLayoutsResponse;
}
