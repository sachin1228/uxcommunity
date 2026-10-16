/**
 * The community nav's per-tab "new since you last looked" dots — a port of
 * the web chat header's `useCommunityTabDots`, minus Members and Activity
 * (mobile's nav carries neither).
 *
 * Every dot comes from a watermark (lib/tabSeen.ts): a tab carries a dot
 * while its newest item is newer than the last time the member opened that
 * tab. Opening the tab advances the watermark, and the next item created
 * afterwards raises the dot again.
 *
 * A tab that was never opened anchors to the member's read watermark as of
 * page load (`anchorAt`): content created since their last visit dots — they
 * have not seen it, however they got here — content older than that does
 * not. Opening the COMMUNITY never advances a tab watermark; only opening
 * the tab does.
 *
 * The `/content-latest` baseline exists because mobile's content views only
 * fetch when their tab is opened — an item created while the member was away
 * must still raise its dot the moment they open the community. The chat's
 * content-event stream (useChatContentEvents) feeds the timeline, not these
 * watermarks, so a slow poll (plus every tab switch and every foreground)
 * stands in — one tiny four-limit-1 read a minute.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { communityTabSeen } from '@/lib/communityTabSeen';
import { getContentLatest, type CommunityContentLatest } from '@/lib/communities';
import { isNewerThan, type TabSeenKey, type TabSeenMap } from '@/lib/tabSeen';
import type { CommunityTab } from '@/lib/communityContent';

/** Which content area each dot-bearing tab tracks. */
const CONTENT_TABS: ReadonlyArray<readonly [TabSeenKey, keyof CommunityContentLatest]> = [
  ['threads', 'thread'],
  ['showcase', 'showcase'],
  ['resources', 'resource'],
  ['events', 'event'],
];

/** How often the baseline re-reads while the chat screen is open. */
const LATEST_REFRESH_MS = 60_000;

interface UseCommunityTabDotsOptions {
  communityId: string;
  currentUserId: string;
  /** The tab actually rendered (see the chat screen's tab state). */
  activeTab: CommunityTab;
  /**
   * The member's read watermark as of page load (`last_read_at` before this
   * open marks the community read) — the anchor for tabs that were never
   * opened. Null/absent (never read) starts the tab at a baseline.
   */
  anchorAt?: string | null;
}

export function useCommunityTabDots({
  communityId,
  currentUserId,
  activeTab,
  anchorAt = null,
}: UseCommunityTabDotsOptions) {
  // The watermarks are an external store (AsyncStorage + module mirror).
  // `seen` stays null until hydration lands — never anchor or compare before
  // that, or persisted watermarks would read as missing on every launch.
  const [seen, setSeen] = useState<TabSeenMap | null>(null);
  const [latest, setLatest] = useState<{ communityId: string; data: CommunityContentLatest } | null>(
    null,
  );

  useEffect(() => {
    if (!currentUserId) {
      setSeen(null);
      return;
    }
    setSeen(communityTabSeen.read(currentUserId, communityId));
    void communityTabSeen.hydrate(currentUserId, communityId).then(() => {
      setSeen(communityTabSeen.read(currentUserId, communityId));
    });
    return communityTabSeen.subscribe(() => {
      setSeen(communityTabSeen.read(currentUserId, communityId));
    });
  }, [currentUserId, communityId]);

  const refresh = useCallback(async () => {
    try {
      const data = await getContentLatest(communityId);
      setLatest({ communityId, data });
    } catch {
      // Best effort — a failed baseline costs dots, never the tabs.
    }
  }, [communityId]);

  // Community-keyed: a switch must not compare one community's items against
  // another's, so the effect below stays gated until this community's own
  // fetch settles. Re-runs on every tab switch, so opening a tab reads a
  // fresh baseline, too.
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), LATEST_REFRESH_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [refresh, activeTab]);

  const latestData = latest && latest.communityId === communityId ? latest.data : null;

  // Anchor never-tracked tabs and keep the open tab's watermark current.
  useEffect(() => {
    if (seen === null || latestData === null || !currentUserId) return;
    for (const [tab, kind] of CONTENT_TABS) {
      const newest = latestData[kind];
      if (seen[tab] === undefined) {
        // First look at this tab since it is tracked: anchor to the member's
        // read watermark as of page load — content created after their last
        // visit dots, older content does not. Opening the tab clears it.
        communityTabSeen.advance(currentUserId, communityId, tab, anchorAt ?? '');
      } else if (activeTab === tab && newest) {
        // The tab is open — whatever its kind holds right now has been seen.
        communityTabSeen.advance(currentUserId, communityId, tab, newest);
      }
    }
  }, [seen, latestData, activeTab, anchorAt, currentUserId, communityId]);

  const tabDots = useMemo(() => {
    const dots: Partial<Record<TabSeenKey, boolean>> = {};
    if (seen === null || latestData === null) return dots;
    for (const [tab, kind] of CONTENT_TABS) {
      // The tab being looked at never wears a dot — its content is on screen.
      if (activeTab === tab) continue;
      if (isNewerThan(latestData[kind], seen[tab])) dots[tab] = true;
    }
    return dots;
  }, [seen, latestData, activeTab]);

  return { tabDots };
}
