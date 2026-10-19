import { supabase } from "./supabaseClient";
import type { LivingRoomLayoutResult } from "./livingRoomLayout";

const BUCKET = "designs";

export interface SaveDesignInput {
  floorPlanId: string;
  roomId: string;
  roomName: string;
  layout: LivingRoomLayoutResult;
  /** The 3D model (.glb) and a preview picture (PNG data URL); both are optional. */
  model?: Blob | null;
  previewDataUrl?: string | null;
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

/**
 * Keeps one furnished room as a saved design: the layout data, plus the exported
 * 3D model and a preview picture when the 3D view supplied them. Saving the same
 * room and layout again replaces the earlier copy.
 */
export async function saveDesign(input: SaveDesignInput): Promise<void> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error("Your session expired. Please sign in again before saving the design.");
  }

  const layoutType = input.layout.layout.type;
  const stem = `${user.id}/${input.floorPlanId}/${input.roomId}-${layoutType}`.replace(/[^A-Za-z0-9_/.-]+/g, "-");

  let modelPath: string | null = null;
  if (input.model) {
    modelPath = `${stem}.glb`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(modelPath, input.model, { upsert: true, contentType: "model/gltf-binary" });
    if (error) throw new Error(`Saving the 3D model failed: ${error.message}`);
  }

  let previewPath: string | null = null;
  if (input.previewDataUrl) {
    previewPath = `${stem}.png`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(previewPath, await dataUrlToBlob(input.previewDataUrl), { upsert: true, contentType: "image/png" });
    if (error) throw new Error(`Saving the preview picture failed: ${error.message}`);
  }

  const { error } = await supabase.from("SavedDesign").upsert(
    {
      UserID: user.id,
      FloorPlanID: input.floorPlanId,
      RoomID: input.roomId,
      RoomName: input.roomName,
      LayoutType: layoutType,
      Title: input.layout.layout.title,
      Score: input.layout.layout.score,
      LayoutJSON: input.layout,
      ModelPath: modelPath,
      PreviewPath: previewPath,
      UpdatedAt: new Date().toISOString(),
    },
    { onConflict: "FloorPlanID,RoomID,LayoutType" },
  );
  if (error) throw new Error(`Saving the design failed: ${error.message}`);
}

/** A saved design as the dashboard lists it. */
export interface SavedDesign {
  designId: string;
  floorPlanId: string;
  roomId: string;
  roomName: string;
  title: string | null;
  score: number | null;
  layout: LivingRoomLayoutResult;
  modelPath: string | null;
  previewPath: string | null;
  /** A short-lived link to the preview picture (the bucket is private). */
  previewUrl: string | null;
  updatedAt: string;
}

type SavedDesignRow = {
  DesignID: string;
  FloorPlanID: string;
  RoomID: string;
  RoomName: string | null;
  Title: string | null;
  Score: number | string | null;
  LayoutJSON: LivingRoomLayoutResult;
  ModelPath: string | null;
  PreviewPath: string | null;
  UpdatedAt: string;
};

const PREVIEW_LINK_SECONDS = 60 * 60;

/** The signed-in user's saved designs, newest first. */
export async function listSavedDesigns(userId: string): Promise<SavedDesign[]> {
  const { data, error } = await supabase
    .from("SavedDesign")
    .select("DesignID, FloorPlanID, RoomID, RoomName, Title, Score, LayoutJSON, ModelPath, PreviewPath, UpdatedAt")
    .eq("UserID", userId)
    .order("UpdatedAt", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as SavedDesignRow[];

  const paths = rows.map((r) => r.PreviewPath).filter((p): p is string => !!p);
  const links = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, PREVIEW_LINK_SECONDS);
    for (const s of signed ?? []) if (s.path && s.signedUrl) links.set(s.path, s.signedUrl);
  }

  return rows.map((r) => ({
    designId: r.DesignID,
    floorPlanId: r.FloorPlanID,
    roomId: r.RoomID,
    roomName: r.RoomName ?? "Room",
    title: r.Title,
    score: r.Score === null ? null : Math.round(Number(r.Score)),
    layout: r.LayoutJSON,
    modelPath: r.ModelPath,
    previewPath: r.PreviewPath,
    previewUrl: r.PreviewPath ? links.get(r.PreviewPath) ?? null : null,
    updatedAt: r.UpdatedAt,
  }));
}

/** Removes a saved design and its files. */
export async function deleteSavedDesign(design: SavedDesign): Promise<void> {
  const files = [design.modelPath, design.previewPath].filter((p): p is string => !!p);
  if (files.length > 0) {
    const { error } = await supabase.storage.from(BUCKET).remove(files);
    if (error) throw new Error(`Removing the design files failed: ${error.message}`);
  }
  const { error } = await supabase.from("SavedDesign").delete().eq("DesignID", design.designId);
  if (error) throw new Error(`Removing the design failed: ${error.message}`);
}
