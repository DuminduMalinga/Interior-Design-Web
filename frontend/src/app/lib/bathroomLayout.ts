/**
 * Client for the Bathroom Layout service (backend/bathroom_layout).
 *
 * Sends the selected room's bounding box + the door/window detections from
 * the wall detector; gets back the best bathroom for each shower corner, best
 * first, each scored against the fifteen bathroom fixture-arrangement rules.
 *
 * The response has the same shape as the living-room service's, so the same
 * plan viewer draws it; the bathroom-only extras are typed here.
 */

import type { GenerateAllLivingRoomLayoutsResponse } from "./livingRoomLayout";

const LAYOUT_URL = (
  import.meta.env.VITE_BATHROOM_LAYOUT_URL ?? "http://localhost:8400"
).replace(/\/$/, "");

type Bbox = { x1: number; y1: number; x2: number; y2: number };

/** Rule 14: the floor specification returned with every bathroom layout. */
export interface BathroomFloor {
  finish: string;
  slip_rating: string;
  /** e.g. "1:80" */
  fall: string;
  /** Drain position in room millimetres. */
  drain: [number, number];
  drain_in_shower: boolean;
  longest_run_mm: number;
}

export interface GenerateAllBathroomLayoutsResponse extends GenerateAllLivingRoomLayoutsResponse {
  roomType: "bathroom";
  /** Planned for a user with mobility needs (rules 13 and 15). */
  accessible: boolean;
  accessibleSource: "provided" | "default";
  programme: {
    accessible: boolean;
    levels: string[];
    shower: boolean;
    storage_cabinet: boolean;
    /** e.g. "900 x 900 shower, close-coupled toilet, 600 mm vanity basin" */
    summary: string;
  };
}

export interface GenerateBathroomLayoutsRequest {
  /** polygon: the room's outline traced from the walls (image px); the engine keeps furniture inside it. */
  room: { id: string; name?: string; bbox: Bbox; polygon?: [number, number][] };
  detections: Array<{ id: string; class: string; bbox: Bbox }>;
  /** Every room on the plan — lets the engine tell the bathroom entrance from
   * a second door. */
  rooms?: Array<{ id: string; name: string; bbox: Bbox }>;
  /** The user has mobility needs: wheelchair space and grab bars are planned. */
  accessible?: boolean;
  /** Real-world metres-per-pixel, when the wall detector recovered one. */
  scaleMPerPx?: number;
  signal?: AbortSignal;
}

/** The best bathroom for every shower corner the room allows, best first. */
export async function generateAllBathroomLayouts(
  req: GenerateBathroomLayoutsRequest,
): Promise<GenerateAllBathroomLayoutsResponse> {
  let res: Response;
  try {
    res = await fetch(`${LAYOUT_URL}/generate-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room: req.room,
        detections: req.detections,
        rooms: req.rooms,
        accessible: req.accessible,
        scale_m_per_px: req.scaleMPerPx,
      }),
      signal: req.signal,
    });
  } catch (err) {
    throw new Error(
      `Could not reach the bathroom layout service at ${LAYOUT_URL}. ` +
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

  return (await res.json()) as GenerateAllBathroomLayoutsResponse;
}
