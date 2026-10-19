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
