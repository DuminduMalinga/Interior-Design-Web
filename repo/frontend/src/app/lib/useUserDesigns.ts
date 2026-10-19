import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { useCurrentUserProfile } from "../context/UserContext";
import type { DetectionResult } from "./wallDetector";

export type DesignStatus = "Uploaded" | "Detected" | "LayoutReady" | "LayoutSelected";

/** One uploaded floor plan and how far it has been taken through the design flow. */
export interface UserDesign {
  floorPlanId: string;
  imageUrl: string | null;
  uploadedAt: string | null;
  updatedAt: string | null;
  status: DesignStatus;
  /** The stored detection result (without the annotated image), or null if analysis never finished. */
  detection: DetectionResult | null;
  roomCount: number;
  selectedRoom: { id: string; name: string } | null;
  layoutTitle: string | null;
  /** Score of the chosen layout out of 100, or null when no layout is chosen yet. */
  score: number | null;
}

type FloorPlanRow = {
  FloorPlanID: string;
  UploadDateTime: string | null;
  ImagePath: string | null;
};

type AnalysisRow = {
  FloorPlanID: string;
  Status: "Detected" | "LayoutReady" | "LayoutSelected";
  SelectedRoomID: string | null;
  DetectionJSON: DetectionResult | null;
  SelectedLayoutJSON: { layout?: { title?: string; score?: number } } | null;
  UpdatedAt: string | null;
};

const MAX_DESIGNS = 60;

function toDesign(plan: FloorPlanRow, analysis: AnalysisRow | undefined): UserDesign {
  const detection = analysis?.DetectionJSON ?? null;
  const rooms = detection?.rooms ?? [];
  const room = analysis?.SelectedRoomID ? rooms.find((r) => r.id === analysis.SelectedRoomID) : undefined;
  const layout = analysis?.SelectedLayoutJSON?.layout;
  const score = typeof layout?.score === "number" ? Math.round(layout.score) : null;

  return {
    floorPlanId: plan.FloorPlanID,
    imageUrl: plan.ImagePath,
    uploadedAt: plan.UploadDateTime,
    updatedAt: analysis?.UpdatedAt ?? plan.UploadDateTime,
    status: analysis?.Status ?? "Uploaded",
    detection,
    roomCount: rooms.length,
    selectedRoom: room ? { id: room.id, name: room.name } : null,
    layoutTitle: layout?.title ?? null,
    score,
  };
}

/**
 * The signed-in user's floor plans, newest first, joined with their saved
 * analysis. Row-level security already limits both tables to the owner; the
 * UserID filter is there so the query is explicit.
 */
export function useUserDesigns() {
  const { authStatus } = useCurrentUserProfile();
  const [designs, setDesigns] = useState<UserDesign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (authStatus === "loading") return;
    if (authStatus === "unauthenticated") {
      setDesigns([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) {
        setDesigns([]);
        return;
      }

      const [plans, analyses] = await Promise.all([
        supabase
          .from("FloorPlan")
          .select("FloorPlanID, UploadDateTime, ImagePath")
          .eq("UserID", userId)
          .order("UploadDateTime", { ascending: false })
          .limit(MAX_DESIGNS),
        supabase
          .from("FloorPlanAnalysis")
          .select("FloorPlanID, Status, SelectedRoomID, DetectionJSON, SelectedLayoutJSON, UpdatedAt")
          .eq("UserID", userId),
      ]);

      if (plans.error) throw new Error(plans.error.message);
      if (analyses.error) throw new Error(analyses.error.message);

      const byPlan = new Map((analyses.data as AnalysisRow[]).map((row) => [row.FloorPlanID, row]));
      setDesigns((plans.data as FloorPlanRow[]).map((plan) => toDesign(plan, byPlan.get(plan.FloorPlanID))));
    } catch (err) {
      setDesigns([]);
      setError(err instanceof Error ? err.message : "Your designs could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [authStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  return { designs, loading, error, reload: load };
}
