"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { DashboardSingleColumn } from "./ContentLoader";
import { HomeFeed } from "./HomeFeed";
import { HomeFeedFilters } from "./HomeFeedFilters";
import { DeferredHomeRail } from "./DeferredHomeRail";
import type { FeedItem } from "@/components/feeds/types";
import {
  DEFAULT_HOME_FEED_SCOPE,
  HOME_FEED_FILTER_SCOPES,
  type HomeFeedFilterScope,
  readStoredHomeFeedScope,
  storeHomeFeedScope,
  subscribeHomeFeedScope,
} from "@/lib/feeds/home-feed-options";

interface DashboardHomeProps {
  userId: string;
  initialScope?: HomeFeedFilterScope;
  initialItems?: FeedItem[];
}

export function DashboardHome({ userId, initialScope = DEFAULT_HOME_FEED_SCOPE, initialItems }: DashboardHomeProps) {
  const [bootstrap, setBootstrap] = useState(initialItems);

  // Feed source choice. The server cannot see localStorage, so the scope
  // starts on the default and swaps to the stored choice right after
  // hydration — a hydration-safe pattern.
  const storedScope = useSyncExternalStore(
    subscribeHomeFeedScope,
    () => readStoredHomeFeedScope() ?? initialScope,
    () => initialScope,
  );
  const [selectedScope, setScope] = useState<HomeFeedFilterScope | null>(null);
  const scope = selectedScope ?? storedScope;

  useEffect(() => {
    const stored = readStoredHomeFeedScope();
    // Migrate older localStorage-only preferences for the next server render.
    storeHomeFeedScope(stored ?? initialScope);
  }, [initialScope]);

  const handleScopeChange = useCallback((next: HomeFeedFilterScope) => {
    if (!(HOME_FEED_FILTER_SCOPES as readonly string[]).includes(next)) return;
    setBootstrap(undefined);
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
          scope={scope}
          initialItems={scope === initialScope ? bootstrap : undefined}
        />
      </DashboardSingleColumn>
      <DeferredHomeRail userId={userId} />
    </div>
  );
}
