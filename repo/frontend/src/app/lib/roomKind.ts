/** The room types that have a layout engine. */
export type RoomKind = "living" | "bathroom" | "bedroom" | "master_bedroom" | "kitchen" | "dining";

/**
 * Which layout engine a room gets, from its OCR'd name - null when there is none yet.
 * The order matters: an en-suite ("Bedroom 1 Bath") gets the bathroom engine, and a
 * "Kitchen / Dining" room the kitchen engine, which seats a table itself.
 */
export function roomKind(name: string): RoomKind | null {
  if (/living/i.test(name)) return "living";
  if (/bath|toilet|w\.?c|wash\s*room|shower|rest\s*room|lavatory/i.test(name)) return "bathroom";
  if (/bed/i.test(name)) return /master|primary|main|\bm\.?\s*bed/i.test(name) ? "master_bedroom" : "bedroom";
  if (/kitchen/i.test(name)) return "kitchen";
  if (/din/i.test(name)) return "dining";
  return null;
}
