import { supabase } from "./supabaseClient";
import type { DetectionResult } from "./wallDetector";
import type { GenerateAllLivingRoomLayoutsResponse, LivingRoomLayoutResult } from "./livingRoomLayout";

export interface FloorPlanAnalysisState {
  floorPlanId: string;
  detection: DetectionResult;
  selectedRoomId?: string | null;
  selectedLayout?: LivingRoomLayoutResult | null;
}

function withoutAnnotatedImage(detection: DetectionResult): DetectionResult {
  const { annotatedImage: _annotatedImage, ...persistable } = detection;
  return persistable;
}

export async function saveDetectionAnalysis(
  floorPlanId: string,
  detection: DetectionResult,
): Promise<void> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error("Your session expired. Please sign in again before saving the analysis.");
  }

  const { error } = await supabase.from("FloorPlanAnalysis").upsert(
    {
      FloorPlanID: floorPlanId,
      UserID: user.id,
      DetectionJSON: withoutAnnotatedImage(detection),
      Status: "Detected",
      UpdatedAt: new Date().toISOString(),
    },
    { onConflict: "FloorPlanID" },
  );

  if (error) throw new Error(`Saving wall detection failed: ${error.message}`);
}

export async function saveLivingRoomAnalysis(
  floorPlanId: string,
  roomId: string,
  layouts: GenerateAllLivingRoomLayoutsResponse,
  selectedLayout: LivingRoomLayoutResult | null,
): Promise<void> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error("Your session expired. Please sign in again before saving the layout.");
  }

  const { error } = await supabase
    .from("FloorPlanAnalysis")
    .update({
      UserID: user.id,
      SelectedRoomID: roomId,
      LayoutJSON: layouts,
      SelectedLayoutJSON: selectedLayout,
      Status: selectedLayout ? "LayoutReady" : "Detected",
      UpdatedAt: new Date().toISOString(),
    })
    .eq("FloorPlanID", floorPlanId)
    .eq("UserID", user.id);

  if (error) throw new Error(`Saving living-room layout failed: ${error.message}`);
}

export async function saveSelectedLivingRoomLayout(
  floorPlanId: string,
  roomId: string,
  selectedLayout: LivingRoomLayoutResult,
): Promise<void> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error("Your session expired. Please sign in again before saving the layout.");
  }

  const { error } = await supabase
    .from("FloorPlanAnalysis")
    .update({
      SelectedRoomID: roomId,
      SelectedLayoutJSON: selectedLayout,
      Status: "LayoutSelected",
      UpdatedAt: new Date().toISOString(),
    })
    .eq("FloorPlanID", floorPlanId)
    .eq("UserID", user.id);

  if (error) throw new Error(`Saving the selected layout failed: ${error.message}`);
}
