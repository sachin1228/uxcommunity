"use client";

import { useEffect, useState } from "react";
import { HomeSidebar } from "./HomeSidebar";
import { useDashboardSecondaryReady } from "./DashboardStartup";
import { fetchJsonCached } from "@/lib/request-cache";
import type { SuggestedCommunity } from "@/lib/home/suggested";

export function DeferredHomeRail({ userId }: { userId: string }) {
  const ready = useDashboardSecondaryReady();
  const [suggested, setSuggested] = useState<SuggestedCommunity[] | null>(null);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void fetchJsonCached<{ suggested: SuggestedCommunity[] }>("/api/home/suggestions", {}, userId)
      .then(data => { if (!cancelled) setSuggested(data.suggested); })
      .catch(() => { if (!cancelled) setSuggested([]); });
    return () => { cancelled = true; };
  }, [ready, userId]);
  return <HomeSidebar suggested={suggested ?? []} loading={suggested === null} />;
}
