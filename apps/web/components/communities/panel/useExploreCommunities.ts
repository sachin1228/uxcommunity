"use client";

/**
 * Explore communities for the sidebar's "Suggested" list.
 *
 * Shares `exploreStore` with the Explore page: whichever surface mounts first
 * performs the `/api/communities/all` call, the other joins the in-flight
 * request or reads the cache. The fetch is deferred a tick so it never competes
 * with the sidebar's own `/api/communities` request for the first paint.
 */

import { useEffect, useState } from "react";
import {
  exploreStore,
  EXPLORE_STALE_MS,
  SIDEBAR_CHANGED_EVENT,
  type CachedExploreCommunity,
} from "@/lib/communities/cache";

export function useExploreCommunities(userId: string): {
  communities: CachedExploreCommunity[];
  loading: boolean;
} {
  const [communities, setCommunities] = useState<CachedExploreCommunity[]>(
    () => exploreStore.data?.communities ?? [],
  );
  const [loading, setLoading] = useState(() => exploreStore.data === null);

  useEffect(() => {
    // Fresh cache: the initial state already holds it, so there is nothing to
    // fetch and nothing to set — a synchronous setState here would only cause a
    // cascading render.
    const cached = exploreStore.data;
    if (cached && Date.now() - cached.fetchedAt < EXPLORE_STALE_MS) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;

      // Another surface (Explore page, another sidebar) is already fetching.
      if (exploreStore.inflight) {
        setLoading(exploreStore.data === null);
        void exploreStore.inflight.then(() => {
          if (cancelled) return;
          setCommunities(exploreStore.data?.communities ?? []);
          setLoading(false);
        });
        return;
      }

      setLoading(true);
      const request: Promise<void> = fetch("/api/communities/all")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data) return;
          const fresh = (data.communities ?? []) as CachedExploreCommunity[];
          exploreStore.data = { communities: fresh, fetchedAt: Date.now() };
          if (!cancelled) setCommunities(fresh);
        })
        .catch(() => {})
        .finally(() => {
          exploreStore.inflight = null;
          if (!cancelled) setLoading(false);
        });
      exploreStore.inflight = request;
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [userId]);

  // Joins and leaves are patched into exploreStore and announced on the
  // sidebar-changed event (see cache.ts) — mirror them so a community joined
  // from anywhere drops out of the suggestions immediately.
  useEffect(() => {
    const sync = () => {
      setCommunities(exploreStore.data?.communities ?? []);
      setLoading(exploreStore.data === null);
    };
    window.addEventListener(SIDEBAR_CHANGED_EVENT, sync);
    return () => window.removeEventListener(SIDEBAR_CHANGED_EVENT, sync);
  }, []);

  return { communities, loading };
}
