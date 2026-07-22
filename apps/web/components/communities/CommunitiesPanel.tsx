"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MessageSquare, Search } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { createBrowserClient } from "@/lib/supabase/browser";
import {
  msgCache,
  msgFetchedAt,
  inFlightMsgFetch,
  metaCache,
  META_STALE_MS,
  inFlightMetaFetch,
  evictIfNeeded,
  MSG_STALE_MS,
  sidebarStore,
  SIDEBAR_STALE_MS,
  initUserCache,
  lastReadAtOnOpen,
  type CachedMeta,
  type CachedSidebarCommunity,
} from "@/lib/communities/cache";

type Community = CachedSidebarCommunity;

/**
 * Mark a community as read on the server.
 *
 * The PATCH endpoint returns `previousLastReadAt` — the last_read_at value
 * BEFORE it was overwritten.  We store it in `lastReadAtOnOpen` so that
 * CommunityChat can position the unread divider by timestamp comparison even
 * when sidebarStore.data was null (user arrived from another page) and the
 * synchronous snapshot in the activeCommunityId effect couldn't be taken.
 *
 * We only store the async fallback if the synchronous path didn't already
 * set the value (hasOwnProperty check via .has()).
 */
async function markReadOnServer(communityId: string) {
  // Capture the timestamp before the fetch so it matches what the server stores.
  const newLastReadAt = new Date().toISOString();
  try {
    const res = await fetch(`/api/communities/${communityId}/read`, { method: "PATCH" });
    if (res.ok) {
      const data = await res.json();
      // Only use as fallback — don't overwrite a value the sync path already set.
      if (!lastReadAtOnOpen.has(communityId) && "previousLastReadAt" in data) {
        lastReadAtOnOpen.set(communityId, data.previousLastReadAt ?? null);
      }
      // Update sidebarStore with the new last_read_at so that if the user
      // navigates away and comes back, handleNavigate captures the updated
      // value instead of the stale pre-read timestamp. Without this, every
      // return visit would re-show the same unread divider.
      if (sidebarStore.data) {
        sidebarStore.data = {
          ...sidebarStore.data,
          communities: sidebarStore.data.communities.map((c) =>
            c.id === communityId ? { ...c, last_read_at: newLastReadAt } : c
          ),
        };
      }
    }
  } catch {}
}

const TYPE_EMOJI: Record<string, string> = {
  city:             "📍",
  sector:           "🏢",
  interest:         "✦",
  company:          "🏬",
  experience_level: "🎯",
};


function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function CommunityAvatar({
  imageUrl,
  name,
  type,
  active,
}: {
  imageUrl: string | null;
  name: string;
  type: string;
  active: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const fallback = TYPE_EMOJI[type] ?? "💬";
  if (imageUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={name}
        width={40}
        height={40}
        loading="lazy"
        decoding="async"
        className="h-10 w-10 rounded-full object-cover shrink-0"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div
      className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 text-lg font-medium select-none ${
        active ? "bg-accent/20" : "bg-surface-raised"
      }`}
    >
      {fallback}
    </div>
  );
}

/**
 * Prefetch both messages AND metadata for a community on hover.
 *
 * - 200 ms debounce prevents spurious requests when the cursor moves quickly.
 * - Each fetch skips independently if its data is already fresh.
 * - Deduplicates in-flight requests so hover + click don't double-fetch.
 */
function usePrefetch() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onEnter = useCallback((communityId: string) => {
    const msgFetchedAt_ = msgFetchedAt.get(communityId);
    const msgFresh = msgFetchedAt_ && Date.now() - msgFetchedAt_ < MSG_STALE_MS;
    const metaCached = metaCache.get(communityId);
    const metaFresh = metaCached && Date.now() - metaCached.fetchedAt < META_STALE_MS;

    // Both caches are warm — nothing to do.
    if (msgFresh && metaFresh) return;
    // Both fetches already in-flight — let them finish.
    if (
      (msgFresh || inFlightMsgFetch.has(communityId)) &&
      (metaFresh || inFlightMetaFetch.has(communityId))
    ) return;

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      // ── Messages ──────────────────────────────────────────────────────────
      if (!inFlightMsgFetch.has(communityId)) {
        const fa = msgFetchedAt.get(communityId);
        if (!fa || Date.now() - fa >= MSG_STALE_MS) {
          const p: Promise<void> = fetch(`/api/communities/${communityId}/messages`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
              if (d?.messages) {
                msgCache.set(communityId, d.messages);
                msgFetchedAt.set(communityId, Date.now());
                evictIfNeeded();
              }
            })
            .catch(() => {})
            .finally(() => inFlightMsgFetch.delete(communityId));
          inFlightMsgFetch.set(communityId, p);
        }
      }

      // ── Metadata + members ────────────────────────────────────────────────
      if (!inFlightMetaFetch.has(communityId)) {
        const mc = metaCache.get(communityId);
        if (!mc || Date.now() - mc.fetchedAt >= META_STALE_MS) {
          const p: Promise<void> = fetch(`/api/communities/${communityId}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
              if (d?.community) {
                const cached: CachedMeta = {
                  community: d.community,
                  members: d.members ?? [],
                  fetchedAt: Date.now(),
                };
                metaCache.set(communityId, cached);
              }
            })
            .catch(() => {})
            .finally(() => inFlightMetaFetch.delete(communityId));
          inFlightMetaFetch.set(communityId, p);
        }
      }
    }, 200);
  }, []);

  const onLeave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { onEnter, onLeave };
}

function CommunityRow({
  c,
  active,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  c: Community;
  active: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
          active
            ? "bg-accent/10 border-l-2 border-l-accent"
            : "hover:bg-surface-raised border-l-2 border-l-transparent"
        }`}
      >
        <CommunityAvatar
          imageUrl={c.image_url}
          name={c.name}
          type={c.type}
          active={active}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <span className="font-body text-[13px] font-medium truncate text-foreground">
              {c.name}
            </span>
            {c.last_message && (
              <span className="font-mono text-xs text-foreground-muted shrink-0">
                {timeAgo(c.last_message.created_at)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {c.last_message ? (
              <p className="font-body text-xs text-foreground-muted truncate flex-1">
                {c.last_message.user && (
                  <span className="font-medium">
                    {c.last_message.user.name.split(" ")[0]}:
                  </span>
                )}{" "}
                {c.last_message.content}
              </p>
            ) : (
              <p className="font-body text-xs text-foreground-muted/60 italic flex-1">
                No messages yet
              </p>
            )}
            {c.message_count > 0 && !active && (
              <span className="flex items-center justify-center p-1 min-w-[20px] h-[16px] rounded-full bg-green-500 text-white font-mono text-[11px] leading-[10px] font-semibold shrink-0">
                {c.message_count > 99 ? "99+" : c.message_count}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

function SectionGroup({
  label,
  communities,
  activeCommunityId,
  onNavigate,
  onPrefetchEnter,
  onPrefetchLeave,
}: {
  label: string;
  communities: Community[];
  activeCommunityId: string | undefined;
  onNavigate: (id: string) => void;
  onPrefetchEnter: (id: string) => void;
  onPrefetchLeave: () => void;
}) {
  if (communities.length === 0) return null;

  return (
    <div>
      <div className="px-3 pt-2 pb-0.5">
        <span className="font-body text-[8px] font-semibold uppercase tracking-widest text-foreground-muted">
          {label}
        </span>
      </div>
      <ul className="space-y-px">
        {communities.map((c) => (
          <CommunityRow
            key={c.id}
            c={c}
            active={c.id === activeCommunityId}
            onClick={() => onNavigate(c.id)}
            onMouseEnter={() => onPrefetchEnter(c.id)}
            onMouseLeave={onPrefetchLeave}
          />
        ))}
      </ul>
    </div>
  );
}

export function CommunitiesPanel({ userId }: { userId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { onEnter, onLeave } = usePrefetch();

  const activeCommunityId = pathname.match(
    /\/dashboard\/communities\/([^/]+)/
  )?.[1];

  /**
   * Seed React state from the module-level cache synchronously during render,
   * BEFORE any effects run.
   *
   * initUserCache(userId) is called here so that if the active account changed
   * (e.g. user A logged out and user B logged in without a hard refresh), all
   * caches are wiped before we read them — preventing data leakage.
   */
  const [communities, setCommunities] = useState<Community[]>(() => {
    initUserCache(userId);
    return sidebarStore.data?.communities ?? [];
  });

  /**
   * Show the loading spinner only when there is NO usable cached data.
   * On revisits the cached list renders immediately with no spinner.
   */
  const [loading, setLoading] = useState(() => sidebarStore.data === null);

  /**
   * Stale-while-revalidate load function.
   *
   * - Fresh cache  → skip fetch entirely (0 API calls).
   * - Stale cache  → render cached data immediately, revalidate in background.
   * - No cache     → show spinner, fetch, then render.
   * - In-flight    → attach to the existing promise, no duplicate request.
   */
  const load = useCallback(() => {
    // Cache is fresh — nothing to do.
    if (
      sidebarStore.data &&
      Date.now() - sidebarStore.data.fetchedAt < SIDEBAR_STALE_MS
    ) {
      setLoading(false);
      return;
    }

    // A fetch is already running — join it instead of firing a second request.
    if (sidebarStore.inflight) {
      sidebarStore.inflight.then(() => {
        if (sidebarStore.data) setCommunities(sidebarStore.data.communities);
        setLoading(false);
      });
      // Stale data is already showing — hide the spinner while we wait.
      if (sidebarStore.data) setLoading(false);
      return;
    }

    // Start a new fetch and register it so concurrent consumers can share it.
    const p: Promise<void> = fetch("/api/communities")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (!d) return;
        const fresh = d.communities ?? [];
        sidebarStore.data = { communities: fresh, fetchedAt: Date.now() };
        setCommunities(fresh);
      })
      .catch(() => {})
      .finally(() => {
        sidebarStore.inflight = null;
        setLoading(false);
      });

    sidebarStore.inflight = p;

    // Keep stale data visible during revalidation — no spinner flash.
    if (sidebarStore.data) setLoading(false);
  }, []);

  /**
   * Tracks whether a background unread-count revalidation is already in
   * progress. Prevents duplicate concurrent requests on rapid navigations.
   */
  const revalidateInFlight = useRef(false);

  /**
   * Background unread-count reconciliation.
   *
   * Called on every CommunitiesPanel mount when load() short-circuits because
   * the sidebar cache is still "fresh" (< SIDEBAR_STALE_MS). During that
   * window the user may have been on another page and messages arrived that
   * never triggered the panel's realtime handlers (those are only active while
   * this component is mounted). The cached message_count values are therefore
   * stale, causing realtime increments to build on the wrong baseline.
   *
   * This fetch re-asks the server for authoritative unread counts and merges
   * them into state using Math.max so that any counts already incremented by
   * realtime during the request are never rolled back.
   *
   * Race-condition safety:
   *   fetch starts → server count = 8
   *   realtime fires → UI count becomes 9
   *   fetch resolves → Math.max(8, 9) = 9  ✓  (no rollback)
   */
  const revalidateUnreadCounts = useCallback(() => {
    if (revalidateInFlight.current) return;
    revalidateInFlight.current = true;

    fetch("/api/communities")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (!d?.communities) return;
        const fresh: CachedSidebarCommunity[] = d.communities;

        setCommunities((prev) => {
          const prevMap = new Map(prev.map((c) => [c.id, c]));
          // Snapshot sidebarStore communities so we can preserve optimistic
          // last_read_at values that may be ahead of what the server returns.
          // (markReadOnServer may still be in-flight when this fetch resolves.)
          const storeById = new Map(
            (sidebarStore.data?.communities ?? []).map((c) => [c.id, c])
          );
          const currentActiveId = activeCommunityIdRef.current;
          const merged = fresh.map((server) => {
            const local = prevMap.get(server.id);
            const stored = storeById.get(server.id);
            // Keep the later of the server's and optimistic last_read_at so
            // that an in-flight markReadOnServer is never rolled back.
            const serverMs = server.last_read_at
              ? new Date(server.last_read_at).getTime()
              : -Infinity;
            const storedMs = stored?.last_read_at
              ? new Date(stored.last_read_at).getTime()
              : -Infinity;
            const bestLastReadAt =
              !stored?.last_read_at || serverMs >= storedMs
                ? server.last_read_at
                : stored.last_read_at;
            return {
              ...server,
              last_read_at: bestLastReadAt,
              // Active community is always 0 — user is reading it right now.
              // For others: never roll back a count already incremented by
              // realtime while this fetch was in-flight.
              message_count:
                server.id === currentActiveId
                  ? 0
                  : Math.max(server.message_count, local?.message_count ?? 0),
            };
          });
          // Keep sidebarStore in sync so subsequent realtime increments and
          // the next navigation both start from the reconciled baseline.
          if (sidebarStore.data) {
            sidebarStore.data = {
              ...sidebarStore.data,
              communities: merged,
              fetchedAt: Date.now(),
            };
          }
          return merged;
        });
      })
      .catch(() => {})
      .finally(() => {
        revalidateInFlight.current = false;
      });
  }, []);

  useEffect(() => {
    // Remember whether the cache was already fresh before load() runs so we
    // can decide whether a separate unread-count revalidation is needed.
    const cacheWasFresh =
      !!sidebarStore.data &&
      Date.now() - sidebarStore.data.fetchedAt < SIDEBAR_STALE_MS;

    load();

    // If load() short-circuited (cache was fresh), the sidebar data renders
    // instantly from the module-level cache — but that cache may contain stale
    // unread counts from before the user left the Communities page. Messages
    // that arrived while Communities was unmounted were never handled by the
    // panel's realtime subscriptions, so those counts were never incremented.
    //
    // Fix: always run a background revalidation on mount so the authoritative
    // server counts replace the stale cached ones. If load() already fired a
    // fresh fetch (cache was stale/missing), that fetch already returns correct
    // counts — no need to double-fetch.
    if (cacheWasFresh) {
      revalidateUnreadCounts();
    }
  }, [load, revalidateUnreadCounts]);

  /**
   * Keep a ref to activeCommunityId so realtime callbacks always read the
   * latest value without needing to be recreated on every navigation.
   */
  const activeCommunityIdRef = useRef(activeCommunityId);

  // Sync the ref AND clear the unread badge whenever the active community changes.
  useEffect(() => {
    activeCommunityIdRef.current = activeCommunityId;
    if (!activeCommunityId) return;

    // Snapshot last_read_at SYNCHRONOUSLY in the effect body — NOT inside the
    // setCommunities updater.  React calls updaters lazily during the next render,
    // so anything written inside an updater is invisible to sibling-component
    // effects that fire in the same flush (e.g. CommunityChat's communityId effect).
    //
    // We use last_read_at (not message_count) so that CommunityChat can find the
    // first unread message by timestamp comparison.  This is immune to the
    // count-mismatch bug where message_count only counts other users' messages
    // but the old index-from-end approach indexed into all messages.
    //
    // If sidebarStore.data is null (user arrived from another page before the
    // sidebar had a chance to load), snapshot is undefined and we can't set the
    // value synchronously.  markReadOnServer's async fallback will store it from
    // the PATCH response instead, and CommunityChat's late-arrival check in the
    // scroll effect will pick it up once messages finish loading.
    // Only capture last_read_at if handleNavigate didn't already do it
    // synchronously (handleNavigate sets it before router.push so CommunityChat's
    // layout effect always finds it; this effect fires later and must not overwrite).
    if (!lastReadAtOnOpen.has(activeCommunityId)) {
      const snapshot = sidebarStore.data?.communities.find(
        (c) => c.id === activeCommunityId
      );
      if (snapshot) {
        // "last_read_at" in snapshot only when the sidebar API has been fetched at
        // least once; fall back gracefully if the field is absent.
        lastReadAtOnOpen.set(activeCommunityId, snapshot.last_read_at ?? null);

        // Optimistically advance last_read_at in sidebarStore to NOW so that
        // if the user returns to this community before markReadOnServer resolves,
        // handleNavigate re-snapshots the fresh timestamp instead of the stale
        // pre-read one — preventing the unread divider from reappearing.
        const optimisticReadAt = new Date().toISOString();
        if (sidebarStore.data) {
          sidebarStore.data = {
            ...sidebarStore.data,
            communities: sidebarStore.data.communities.map((c) =>
              c.id === activeCommunityId
                ? { ...c, last_read_at: optimisticReadAt }
                : c
            ),
          };
        }
      }

      // markReadOnServer is now async and stores previousLastReadAt as a fallback
      // for the case where the synchronous snapshot above was not available.
      markReadOnServer(activeCommunityId);
    }

    setCommunities((prev) => {
      const updated = prev.map((c) =>
        c.id === activeCommunityId ? { ...c, message_count: 0 } : c
      );
      if (sidebarStore.data) {
        // Preserve the optimistic last_read_at from sidebarStore — do not
        // overwrite it with the stale value in React state.
        const storeById = new Map(
          sidebarStore.data.communities.map((c) => [c.id, c])
        );
        sidebarStore.data = {
          ...sidebarStore.data,
          communities: updated.map((c) => ({
            ...c,
            last_read_at: storeById.get(c.id)?.last_read_at ?? c.last_read_at,
          })),
        };
      }
      return updated;
    });
  }, [activeCommunityId]);

  /**
   * Realtime subscriptions — one channel per joined community.
   *
   * Each channel handles two jobs:
   *   1. Update the last_message preview in the sidebar in real time.
   *   2. Increment the unread badge for communities the user is NOT currently
   *      viewing, counting only messages from other users.
   *
   * Channels are torn down and re-created only when the list of joined
   * community IDs changes (not on every message or navigation).
   */
  // Sort IDs before joining so this string is order-independent — a re-sort
  // of the sidebar list won't change this value and won't tear down / recreate
  // all Supabase subscriptions unnecessarily on every new message.
  const communityIds = [...communities].map((c) => c.id).sort().join(",");
  useEffect(() => {
    if (!communities.length) return;

    let supabase: ReturnType<typeof createBrowserClient>;
    try {
      supabase = createBrowserClient();
    } catch {
      return;
    }

    const channels = communities.map((comm) =>
      supabase
        .channel(`panel:${comm.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "community_messages",
            filter: `community_id=eq.${comm.id}`,
          },
          (payload) => {
            const row = payload.new as {
              id: string;
              community_id: string;
              content: string;
              created_at: string;
              user_id: string;
            };

            const isOwn = row.user_id === userId;
            const isActive = row.community_id === activeCommunityIdRef.current;

            setCommunities((prev) => {
              // Only update the community that received the message — don't
              // re-sort here. The render always sorts, so mutating the sort
              // order in state would cause two different sort algorithms to
              // fight each other and produce non-deterministic orderings for
              // communities with equal or empty timestamps.
              const updated = prev.map((c) =>
                c.id === row.community_id
                  ? {
                      ...c,
                      last_message: {
                        content: row.content,
                        created_at: row.created_at,
                        user: c.last_message?.user ?? null,
                      },
                      // Increment unread only for messages from others in non-active communities
                      message_count:
                        !isOwn && !isActive
                          ? c.message_count + 1
                          : c.message_count,
                    }
                  : c
              );

              if (sidebarStore.data) {
                // Preserve optimistic last_read_at from sidebarStore so that
                // real-time message arrivals don't overwrite it with stale
                // React state, which would cause the unread divider to
                // reappear on return visits.
                const storeById = new Map(
                  sidebarStore.data.communities.map((c) => [c.id, c])
                );
                sidebarStore.data = {
                  ...sidebarStore.data,
                  communities: updated.map((c) => ({
                    ...c,
                    last_read_at:
                      storeById.get(c.id)?.last_read_at ?? c.last_read_at,
                  })),
                };
              }

              return updated;
            });
          }
        )
        .subscribe()
    );

    return () => {
      channels.forEach((ch) => supabase.removeChannel(ch));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityIds, userId]);

  function handleNavigate(id: string) {
    // STEP 1: Capture the OLD last_read_at SYNCHRONOUSLY before anything else.
    // This must happen before:
    //   - message_count is cleared (badge disappears)
    //   - markReadOnServer overwrites last_read_at on the server
    //   - router.push triggers navigation (CommunityChat effects fire)
    //
    // By writing to lastReadAtOnOpen here (before router.push), the fast-path
    // layout effect in CommunityChat will always find the value immediately —
    // no race condition with the activeCommunityId effect below.
    if (!lastReadAtOnOpen.has(id)) {
      const snapshot = sidebarStore.data?.communities.find((c) => c.id === id);
      if (snapshot) {
        lastReadAtOnOpen.set(id, snapshot.last_read_at ?? null);

        // Optimistically advance last_read_at in sidebarStore to NOW so that
        // if the user returns here before markReadOnServer resolves, the
        // re-snapshot uses the fresh timestamp and the divider stays gone.
        const optimisticReadAt = new Date().toISOString();
        if (sidebarStore.data) {
          sidebarStore.data = {
            ...sidebarStore.data,
            communities: sidebarStore.data.communities.map((c) =>
              c.id === id ? { ...c, last_read_at: optimisticReadAt } : c
            ),
          };
        }
      }
    }

    // STEP 2: Clear the unread badge immediately (optimistic UI).
    setCommunities((prev) => {
      const updated = prev.map((c) =>
        c.id === id ? { ...c, message_count: 0 } : c
      );
      if (sidebarStore.data) {
        // Merge with sidebarStore so the optimistic last_read_at advancement
        // written above is not overwritten by the stale value in React state.
        // Without this, every return visit would re-show the unread divider.
        const storeById = new Map(
          sidebarStore.data.communities.map((c) => [c.id, c])
        );
        sidebarStore.data = {
          ...sidebarStore.data,
          communities: updated.map((c) => ({
            ...c,
            last_read_at: storeById.get(c.id)?.last_read_at ?? c.last_read_at,
          })),
        };
      }
      return updated;
    });

    // STEP 3: Navigate.
    router.push(`/dashboard/communities/${id}`);

    // STEP 4: Persist the read state in the background — this is pure server
    // persistence and must NOT block or influence the visual scroll position.
    void markReadOnServer(id);
  }

  return (
    <div className="flex flex-col h-full w-72 shrink-0 border-r border-border bg-surface">
      {/* Explore communities button */}
      <button
        onClick={() => router.push("/dashboard/communities")}
        className={`flex items-center gap-2 mx-3 mt-3 mb-1 px-3 py-2 rounded-lg font-body text-xs font-medium transition-colors text-left ${
          pathname === "/dashboard/communities"
            ? "bg-accent/10 text-accent"
            : "text-foreground-muted hover:text-foreground hover:bg-surface-raised"
        }`}
      >
        <Search size={13} />
        Explore Communities
      </button>

      <div className="mx-2 mb-0.5" />

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-4 w-4 text-foreground-muted" />
          </div>
        ) : communities.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <MessageSquare
              size={24}
              className="mx-auto text-foreground-muted mb-2 opacity-40"
            />
            <p className="font-body text-xs text-foreground-muted">
              No communities yet
            </p>
          </div>
        ) : (
          <div className="py-0.5">
            <div className="px-3 pt-2 pb-0.5">
              <span className="font-body text-[8px] font-semibold uppercase tracking-widest text-foreground-muted">
                All
              </span>
            </div>
            <ul className="space-y-px">
              {[...communities]
                .sort((a, b) => {
                  const ta = a.last_message?.created_at ?? "";
                  const tb = b.last_message?.created_at ?? "";
                  // Primary: most-recent message first (ISO strings sort lexicographically)
                  if (tb > ta) return 1;
                  if (ta > tb) return -1;
                  // Secondary: alphabetical by name — stable tiebreaker so communities
                  // with equal/empty timestamps never jump on re-render
                  return a.name.localeCompare(b.name);
                })
                .map((c) => (
                  <CommunityRow
                    key={c.id}
                    c={c}
                    active={c.id === activeCommunityId}
                    onClick={() => handleNavigate(c.id)}
                    onMouseEnter={() => onEnter(c.id)}
                    onMouseLeave={onLeave}
                  />
                ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
