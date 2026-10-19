import { supabase } from "./supabaseClient";

const BUCKET = "avatars";
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_PICKED_BYTES = 10 * 1024 * 1024;
/** Pictures are shown small, so they are scaled down before they are stored. */
const MAX_SIDE_PX = 512;

/** Why a picked file cannot be used as a profile picture, or null when it can. */
export function checkAvatarFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) return "Choose a JPEG, PNG or WebP picture.";
  if (file.size > MAX_PICKED_BYTES) return "That picture is larger than 10 MB. Choose a smaller one.";
  return null;
}

/** The picture scaled to fit MAX_SIDE_PX, as WebP; the original if the browser cannot do that. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const g = canvas.getContext("2d");
    if (!g) return file;
    g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.88));
    return blob && blob.size > 0 ? blob : file;
  } catch {
    return file;
  }
}

async function currentUserId(): Promise<string> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Your session expired. Please sign in again.");
  return user.id;
}

/** Deletes every picture of the user's except the one named (if any). */
async function removeOldPictures(userId: string, keep?: string): Promise<void> {
  const { data } = await supabase.storage.from(BUCKET).list(userId, { limit: 100 });
  const stale = (data ?? []).map((f) => `${userId}/${f.name}`).filter((path) => path !== keep);
  if (stale.length > 0) await supabase.storage.from(BUCKET).remove(stale);
}

/**
 * Saves a new profile picture: scales it down, stores it, and records its
 * public address on the user's row. Returns that address.
 */
export async function uploadAvatar(file: File): Promise<string> {
  const problem = checkAvatarFile(file);
  if (problem) throw new Error(problem);
  const userId = await currentUserId();

  const picture = await shrink(file);
  const type = picture.type || file.type;
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  // A new name every time, so browsers never show a stale cached picture.
  const path = `${userId}/avatar-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, picture, { contentType: type, cacheControl: "31536000" });
  if (uploadError) throw new Error(`The picture could not be uploaded: ${uploadError.message}`);

  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const { error: saveError } = await supabase.from("User").update({ AvatarUrl: publicUrl }).eq("UserID", userId);
  if (saveError) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error(`The picture could not be saved: ${saveError.message}`);
  }

  await removeOldPictures(userId, path);
  return publicUrl;
}

/** Removes the user's profile picture, going back to their initials. */
export async function removeAvatar(): Promise<void> {
  const userId = await currentUserId();
  const { error } = await supabase.from("User").update({ AvatarUrl: null }).eq("UserID", userId);
  if (error) throw new Error(`The picture could not be removed: ${error.message}`);
  await removeOldPictures(userId);
}
