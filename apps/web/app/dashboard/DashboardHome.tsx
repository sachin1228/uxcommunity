"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { DashboardSingleColumn } from "./ContentLoader";
import { HomeFeed } from "./HomeFeed";
import { HomeFeedFilters } from "./HomeFeedFilters";
import {
  DEFAULT_HOME_FEED_SCOPE,
  HOME_FEED_FILTER_SCOPES,
  type HomeFeedFilterScope,
  readStoredHomeFeedScope,
  storeHomeFeedScope,
} from "@/lib/feeds/home-feed-options";

interface DashboardHomeProps {
  userId: string;
  /**
   * The sidebar rail, rendered on the server (HomeRail) and slotted in here so
   * this client shell can own the two-column layout without owning the data.
   */
  rail?: ReactNode;
}

export function DashboardHome({ userId, rail }: DashboardHomeProps) {
  const [refreshToken, setRefreshToken] = useState(0);

  // Feed source choice. The server cannot see localStorage, so the scope
  // starts on the default and swaps to the stored choice right after
  // hydration — a hydration-safe pattern.
  const [scope, setScope] = useState<HomeFeedFilterScope>(DEFAULT_HOME_FEED_SCOPE);

  useEffect(() => {
    setScope(readStoredHomeFeedScope() ?? DEFAULT_HOME_FEED_SCOPE);
  }, []);

  const handleScopeChange = useCallback((next: HomeFeedFilterScope) => {
    if (!(HOME_FEED_FILTER_SCOPES as readonly string[]).includes(next)) return;
    setScope(next);
    storeHomeFeedScope(next);
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-6xl items-start justify-center gap-6 px-4 lg:px-6">
      <DashboardSingleColumn>
        <HomeFeedFilters scope={scope} onScopeChange={handleScopeChange} />
        {/* Keyed by scope: switching filters remounts the feed, so the new view
            either renders from its cached page instantly or shows the standard
            loader while it loads — the old filter's cards never linger. */}
        <HomeFeed
          key={scope}
          currentUserId={userId}
          refreshToken={refreshToken}
          scope={scope}
        />
      </DashboardSingleColumn>
      {rail}
    </div>
  );
}
