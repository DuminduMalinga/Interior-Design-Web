import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

export interface SiteStats {
  users: number;
  floorPlans: number;
  layouts: number;
}

type SiteStatsRow = {
  UserCount: number | string;
  FloorPlanCount: number | string;
  LayoutCount: number | string;
};

/** Live totals for the landing page; null until loaded or if the lookup fails. */
export function useSiteStats(): SiteStats | null {
  const [stats, setStats] = useState<SiteStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.rpc("get_site_stats").then(({ data, error }) => {
      const row = (Array.isArray(data) ? data[0] : data) as SiteStatsRow | null;
      if (cancelled || error || !row) return;
      setStats({
        users: Number(row.UserCount),
        floorPlans: Number(row.FloorPlanCount),
        layouts: Number(row.LayoutCount),
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return stats;
}
