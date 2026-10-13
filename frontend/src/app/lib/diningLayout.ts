/**
 * Client for the Dining Layout service (backend/dining_layout).
 *
 * Sends the selected room's bounding box + the door/window detections from
 * the wall detector; gets back the best dining layout for each part of the
 * room the table can stand in, best first, each scored against the twelve
 * dining-area furniture-arrangement rules.
 *
 * The response has the same shape as the living-room service's, so the same
 * plan viewer draws it; the dining-only extras are typed here.
 */

import type { GenerateAllLivingRoomLayoutsResponse } from "./livingRoomLayout";

const LAYOUT_URL = (
  import.meta.env.VITE_DINING_LAYOUT_URL ?? "http://localhost:8500"
).replace(/\/$/, "");

type Bbox = { x1: number; y1: number; x2: number; y2: number };

export type DiningSeats = 2 | 4 | 6 | 8;

export interface GenerateAllDiningLayoutsResponse extends GenerateAllLivingRoomLayoutsResponse {
  roomType: "dining";
  /** Seats the layouts were planned for. */
  seats: number;
  /** "inferred" when the engine chose the seats from the floor area. */
  seatsSource: "provided" | "inferred";
  programme: {
    seats: number;
    seat_options: number[];
    sideboard: boolean;
    use: "everyday" | "entertaining";
    /** e.g. "1.8 m table for six, 6 chairs, sideboard, pendant light" */
    summary: string;
  };
}

export interface GenerateDiningLayoutsRequest {
  room: { id: string; name?: string; bbox: Bbox };
  detections: Array<{ id: string; class: string; bbox: Bbox }>;
  /** Every room on the plan — this is how the engine finds the kitchen (rule 8). */
  rooms?: Array<{ id: string; name: string; bbox: Bbox }>;
  /** Leave out to let the engine decide from the room size. */
  seats?: DiningSeats;
  /** Real-world metres-per-pixel, when the wall detector recovered one. */
  scaleMPerPx?: number;
  signal?: AbortSignal;
}

/** The best dining layout for every part of the room, best first. */
export async function generateAllDiningLayouts(
  req: GenerateDiningLayoutsRequest,
): Promise<GenerateAllDiningLayoutsResponse> {
  let res: Response;
  try {
    res = await fetch(`${LAYOUT_URL}/generate-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room: req.room,
        detections: req.detections,
        rooms: req.rooms,
        seats: req.seats,
        scale_m_per_px: req.scaleMPerPx,
      }),
      signal: req.signal,
    });
  } catch (err) {
    throw new Error(
      `Could not reach the dining layout service at ${LAYOUT_URL}. ` +
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

  return (await res.json()) as GenerateAllDiningLayoutsResponse;
}
