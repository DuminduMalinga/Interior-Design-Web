/**
 * Client for the Kitchen Layout service (backend/kitchen_layout).
 *
 * Sends the selected room's bounding box + the door/window detections from
 * the wall detector; gets back the best kitchen of every shape the room allows
 * (one-wall, L-shaped, U-shaped, galley), best first, each scored against the
 * twelve kitchen-arrangement rules.
 *
 * The response has the same shape as the living-room service's, so the same
 * plan viewer draws it; the kitchen-only extras are typed here.
 */

import type { GenerateAllLivingRoomLayoutsResponse } from "./livingRoomLayout";

const LAYOUT_URL = (
  import.meta.env.VITE_KITCHEN_LAYOUT_URL ?? "http://localhost:8300"
).replace(/\/$/, "");

type Bbox = { x1: number; y1: number; x2: number; y2: number };

/** Sink, stove and refrigerator fronts, in room millimetres — drawn over the plan. */
export interface WorkTriangle {
  points: [number, number][];
  legs_mm: { sink_stove: number; sink_fridge: number; stove_fridge: number };
  perimeter_mm: number;
}

export interface GenerateAllKitchenLayoutsResponse extends GenerateAllLivingRoomLayoutsResponse {
  roomType: "kitchen";
  diningTable: boolean;
  /** "inferred" when the engine decided from the floor area whether to try a table */
  diningTableSource: "provided" | "inferred";
  programme: {
    appliance_sizes: string[];
    dining_table: boolean;
    table_seats: number[];
    /** e.g. "sink with drainer, 600 mm cooker, refrigerator, dining table for two" */
    summary: string;
  };
}

export interface GenerateKitchenLayoutsRequest {
  /** polygon: the room's outline traced from the walls (image px); the engine keeps furniture inside it. */
  /** width_m / length_m: the size printed on the plan; the room is planned at exactly this size. */
  room: { id: string; name?: string; bbox: Bbox; polygon?: [number, number][]; width_m?: number; length_m?: number };
  detections: Array<{ id: string; class: string; bbox: Bbox }>;
  /** Every room on the plan — lets the engine tell the kitchen entrance from
   * the door to a pantry or the back yard. */
  rooms?: Array<{ id: string; name: string; bbox: Bbox }>;
  /** Leave out to let the engine decide from the room size. */
  diningTable?: boolean;
  /** Real-world metres-per-pixel, when the wall detector recovered one. */
  scaleMPerPx?: number;
  signal?: AbortSignal;
}

/** The best kitchen of every shape the room allows, best first. */
export async function generateAllKitchenLayouts(
  req: GenerateKitchenLayoutsRequest,
): Promise<GenerateAllKitchenLayoutsResponse> {
  let res: Response;
  try {
    res = await fetch(`${LAYOUT_URL}/generate-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room: req.room,
        detections: req.detections,
        rooms: req.rooms,
        dining_table: req.diningTable,
        scale_m_per_px: req.scaleMPerPx,
      }),
      signal: req.signal,
    });
  } catch (err) {
    throw new Error(
      `Could not reach the kitchen layout service at ${LAYOUT_URL}. ` +
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

  return (await res.json()) as GenerateAllKitchenLayoutsResponse;
}
