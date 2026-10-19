/**
 * Client for the Master Bedroom Layout service (backend/master_bedroom_layout).
 *
 * Sends the selected room's bounding box + the door/window detections from
 * the wall detector; gets back one layout per bed position, best first, each
 * scored against the fifteen master-bedroom furniture-arrangement rules.
 *
 * The request and the response are the bedroom service's (the engine is built
 * on it), so the same types and the same plan viewer are used.
 */

import type { GenerateAllBedroomLayoutsResponse, GenerateBedroomLayoutsRequest } from "./bedroomLayout";

const LAYOUT_URL = (
  import.meta.env.VITE_MASTER_BEDROOM_LAYOUT_URL ?? "http://localhost:8600"
).replace(/\/$/, "");

export type GenerateAllMasterBedroomLayoutsResponse = Omit<GenerateAllBedroomLayoutsResponse, "roomType"> & {
  roomType: "master_bedroom";
};

/** Every layout the room allows, best first — one per distinct bed position. */
export async function generateAllMasterBedroomLayouts(
  req: GenerateBedroomLayoutsRequest,
): Promise<GenerateAllMasterBedroomLayoutsResponse> {
  let res: Response;
  try {
    res = await fetch(`${LAYOUT_URL}/generate-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room: req.room,
        detections: req.detections,
        // the room list is how the engine recognises the en-suite door (rule 15)
        rooms: req.rooms,
        occupants: req.occupants,
        scale_m_per_px: req.scaleMPerPx,
      }),
      signal: req.signal,
    });
  } catch (err) {
    throw new Error(
      `Could not reach the master bedroom layout service at ${LAYOUT_URL}. ` +
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

  return (await res.json()) as GenerateAllMasterBedroomLayoutsResponse;
}
