"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { CachedContentEvent, ContentEventKind } from "@/lib/communities/cache";
import {
  advanceTabSeen,
  isNewerThan,
  newestIso,
  readTabSeen,
  subscribeTabSeen,
  type CommunityTabSeenKey,
} from "@/lib/communities/tab-seen";
import type { ChatTab } from "./ChatHeader";

type ContentTab = "threads" | "showcase" | "resources" | "events";

/** Which content kind each dot-bearing tab tracks. */
const CONTENT_TABS: ReadonlyArray<readonly [ContentTab, ContentEventKind]> = [
  ["threads", "thread"],
  ["showcase", "showcase"],
  ["resources", "resource"],
  ["events", "event"],
];

type LatestKind = ContentEventKind | "activity";
type LatestMap = Partial<Record<LatestKind, string | null>>;

interface UseCommunityTabDotsOptions {
  communityId: string;
  currentUserId: string;
  /** The tab actually rendered (a hidden tab falls back to "chat"). */
  activeTab: ChatTab;
  /** Live content events (bootstrap + realtime) the chat timeline holds. */
  contentEvents: CachedContentEvent[];
  /** Manager tier only: the Activity tab (and its dot) exists for them. */
  canSeeActivity: boolean;
  /** Manager of a private community — the only member who sees join requests. */
  canSeeRequests: boolean;
}

/**
 * The community nav's per-tab "new since you last looked" dots.
 *
 * Every dot except Members comes from a watermark (lib/communities/tab-seen):
 * a tab carries a dot while its newest item is newer than the last time the
 * member opened that tab. Opening the tab advances the watermark, and the next
 * item created afterwards raises the dot again. Threads / Showcase / Resources
 * / Events compare the community's newest item of their kind; Activity
 * compares the newest management-audit row.
 *
 * The `/content-latest` baseline exists because the chat timeline's own
 * content-event window can be up to COMMUNITY_BOOTSTRAP_STALE_MS old — an item
 * created while the member was away must still raise its dot the moment they
 * open the community. While the page is open, realtime content events update
 * the same comparison live.
 *
 * Members is an outstanding-work dot, not a watermark: it stays while any join
 * request is pending and clears only when the queue is empty.
 */
export function useCommunityTabDots({
  communityId,
  currentUserId,
  activeTab,
  contentEvents,
  canSeeActivity,
  canSeeRequests,
}: UseCommunityTabDotsOptions) {
  // The watermarks are an external store (localStorage + module mirror), read
  // through useSyncExternalStore: the server snapshot is null so the server
  // HTML and the hydrating paint carry no dots, and the first post-hydration
  // read supplies the persisted watermarks. `null` also gates the anchor
  // effect below — it must never run before the real watermarks are in.
  const seen = useSyncExternalStore(
    subscribeTabSeen,
    () => readTabSeen(currentUserId, communityId),
    () => null,
  );

  const [fetched, setFetched] = useState<{ communityId: string; latest: LatestMap } | null>(null);
  const [requests, setRequests] = useState<{ communityId: string; count: number } | null>(null);

  const fetchLatest = useCallback(async (): Promise<LatestMap> => {
    const data = await fetch(`/api/communities/${communityId}/content-latest`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    return (data as { latest?: LatestMap } | null)?.latest ?? {};
  }, [communityId]);

  // The fresh per-kind baseline. Community-keyed: a switch to another
  // community must not compare against the previous one's timestamps, so
  // `latestReady` stays false until this community's own fetch settles.
  useEffect(() => {
    let cancelled = false;
    void fetchLatest().then((latest) => {
      if (!cancelled) setFetched({ communityId, latest });
    });
    return () => { cancelled = true; };
  }, [communityId, fetchLatest]);

  // Opening the Activity tab re-reads the baseline: an audit row that landed
  // between page open and tab open is on screen now and must count as seen.
  useEffect(() => {
    if (activeTab !== "activity" || !canSeeActivity) return;
    let cancelled = false;
    void fetchLatest().then((latest) => {
      if (!cancelled) setFetched({ communityId, latest });
    });
    return () => { cancelled = true; };
  }, [activeTab, canSeeActivity, communityId, fetchLatest]);

  // Pending join requests (manager of a private community only — the same gate
  // MembersView applies). A failure leaves the count unknown, which shows no
  // dot rather than a wrong one.
  useEffect(() => {
    if (!canSeeRequests) return;
    let cancelled = false;
    fetch(`/api/communities/${communityId}/requests`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { requests?: unknown[] } | null) => {
        if (!cancelled && data) setRequests({ communityId, count: data.requests?.length ?? 0 });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [communityId, canSeeRequests]);

  const advance = useCallback(
    (tab: CommunityTabSeenKey, value: string) => {
      // Writes the external store; subscribers (this hook's snapshot read)
      // re-render on a real change only — monotonic no-ops notify nobody.
      advanceTabSeen(currentUserId, communityId, tab, value);
    },
    [currentUserId, communityId],
  );

  const fetchedLatest = fetched && fetched.communityId === communityId ? fetched.latest : null;
  const latestReady = fetchedLatest !== null;

  // The newest item per kind: the timeline's live window merged with the
  // fetched baseline (realtime keeps the former current while on the page).
  const kindLatest = useMemo(() => {
    const next: Record<LatestKind, string | null> = {
      thread: null,
      showcase: null,
      resource: null,
      event: null,
      activity: null,
    };
    for (const event of contentEvents) {
      next[event.kind] = newestIso(next[event.kind] ?? null, event.created_at);
    }
    if (fetchedLatest) {
      for (const kind of Object.keys(next) as LatestKind[]) {
        next[kind] = newestIso(next[kind], fetchedLatest[kind] ?? null);
      }
    }
    return next;
  }, [contentEvents, fetchedLatest]);

  const globalBaseline = useMemo(() => {
    let baseline: string | null = null;
    for (const iso of Object.values(kindLatest)) baseline = newestIso(baseline, iso);
    return baseline;
  }, [kindLatest]);

  // Anchor never-tracked tabs and keep the open tab's watermark current.
  useEffect(() => {
    if (seen === null || !latestReady) return;
    for (const [tab, kind] of CONTENT_TABS) {
      const latest = kindLatest[kind];
      if (seen[tab] === undefined) {
        // First ever look at this tab: everything that exists right now counts
        // as seen — only items arriving afterwards raise a dot.
        advance(tab, latest ?? globalBaseline ?? "");
      } else if (activeTab === tab && latest) {
        // The tab is open — whatever its kind holds right now has been seen.
        advance(tab, latest);
      }
    }
    if (canSeeActivity) {
      if (seen.activity === undefined) {
        advance("activity", kindLatest.activity ?? globalBaseline ?? "");
      } else if (activeTab === "activity" && kindLatest.activity) {
        advance("activity", kindLatest.activity);
      }
    }
  }, [seen, latestReady, kindLatest, globalBaseline, activeTab, canSeeActivity, advance]);

  const tabDots = useMemo(() => {
    const dots: Partial<Record<ChatTab, boolean>> = {};
    for (const [tab, kind] of CONTENT_TABS) {
      // The tab being looked at never wears a dot — its content is on screen.
      if (activeTab === tab) continue;
      if (isNewerThan(kindLatest[kind], seen?.[tab])) dots[tab] = true;
    }
    if (
      canSeeActivity &&
      activeTab !== "activity" &&
      isNewerThan(kindLatest.activity, seen?.activity)
    ) {
      dots.activity = true;
    }
    const pendingCount =
      canSeeRequests && requests?.communityId === communityId ? requests.count : 0;
    if (pendingCount > 0) dots.members = true;
    return dots;
  }, [kindLatest, seen, activeTab, canSeeActivity, canSeeRequests, requests, communityId]);

  /**
   * MembersView reports its own pending-request count here — it owns the list
   * (this hook's fetch only seeds the dot before the tab has ever been
   * opened), so accepting or declining the last request brings the dot down
   * immediately.
   */
  const reportPendingRequests = useCallback(
    (count: number) => setRequests({ communityId, count }),
    [communityId],
  );

  return { tabDots, reportPendingRequests };
}
