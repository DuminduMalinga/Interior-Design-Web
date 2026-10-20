import { supabase } from "./supabaseClient";

const BUCKET = "floorplans";
const PUBLIC_MARKER = `/storage/v1/object/public/${BUCKET}/`;
/** How long a viewing link works. Short, because floor plans show the inside of someone's home. */
const LINK_SECONDS = 60 * 60;

/**
 * The file's path inside the floorplans bucket, from what the FloorPlan row
 * stores: a plain path (new uploads) or the old public link (earlier uploads).
 * Anything else, such as an outside address, has no path.
 */
export function floorPlanStoragePath(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const at = stored.indexOf(PUBLIC_MARKER);
  if (at >= 0) return decodeURIComponent(stored.slice(at + PUBLIC_MARKER.length).split("?")[0]);
  if (/^[a-z][a-z0-9+.-]*:/i.test(stored)) return null;
  return stored;
}

/**
 * Viewing links for the stored values, in the same order. The bucket is private,
 * so each link is signed for the signed-in user and expires after an hour.
 * A value that cannot be signed comes back as null.
 */
export async function signFloorPlanImages(stored: (string | null | undefined)[]): Promise<(string | null)[]> {
  const paths = stored.map(floorPlanStoragePath);
  const wanted = [...new Set(paths.filter((p): p is string => p !== null))];
  if (wanted.length === 0) return stored.map(() => null);

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(wanted, LINK_SECONDS);
  if (error || !data) return stored.map(() => null);

  const linkByPath = new Map<string, string>();
  for (const entry of data) {
    if (entry.path && entry.signedUrl && !entry.error) linkByPath.set(entry.path, entry.signedUrl);
  }
  return paths.map((p) => (p ? linkByPath.get(p) ?? null : null));
}
