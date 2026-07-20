"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Users, MessageSquare, Search } from "lucide-react";
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
  type CachedMeta,
  type CachedSidebarCommunity,
} from "@/lib/communities/cache";

type Community = CachedSidebarCommunity;

const TYPE_EMOJI: Record<string, string> = {
  city:             "📍",
  sector:           "🏢",
  interest:         "✦",
  company:          "🏬",
  experience_level: "🎯",
};

const SECTIONS: { label: string; type: Community["type"] }[] = [
  { label: "Company",    type: "company"          },
  { label: "Industry",   type: "sector"            },
  { label: "Interest",   type: "interest"          },
  { label: "Experience", type: "experience_level"  },
  { label: "City",       type: "city"              },
];

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
      <img
        src={imageUrl}
        alt={name}
        className="h-10 w-10 rounded-full object-cover shrink-0"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div
      className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 text-base font-medium select-none ${
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
        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
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
            <span className="font-body text-xs font-medium truncate text-foreground">
              {c.name}
            </span>
            {c.last_message && (
              <span className="font-mono text-[10px] text-foreground-muted shrink-0">
                {timeAgo(c.last_message.created_at)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {c.last_message ? (
              <p className="font-body text-[11px] text-foreground-muted truncate flex-1">
                {c.last_message.user && (
                  <span className="font-medium">
                    {c.last_message.user.name.split(" ")[0]}:
                  </span>
                )}{" "}
                {c.last_message.content}
              </p>
            ) : (
              <p className="font-body text-[11px] text-foreground-muted/60 italic flex-1">
                No messages yet
              </p>
            )}
            <span className="flex items-center gap-0.5 text-foreground-muted shrink-0">
              <Users size={10} />
              <span className="font-mono text-[10px]">{c.member_count}</span>
            </span>
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
      <div className="px-4 pt-4 pb-1">
        <span className="font-body text-[10px] font-semibold uppercase tracking-widest text-foreground-muted">
          {label}
        </span>
      </div>
      <ul>
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

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Realtime subscription — scoped to the ACTIVE community only.
   *
   * Subscribing to every joined community (N channels) caused high WebSocket
   * traffic and cascading re-renders on every incoming message. Now we open
   * exactly one channel that follows the user as they switch communities.
   *
   * Responsibilities:
   * 1. Update the sidebar last_message preview for the active community in real time.
   * 2. Keep sidebarStore.data in sync so the next mount reflects live data.
   *
   * CommunityChat has its own subscription that handles full message updates
   * for the selected community, so we don't need to duplicate that here.
   */
  useEffect(() => {
    if (!activeCommunityId) return;

    let supabase: ReturnType<typeof createBrowserClient>;
    try {
      supabase = createBrowserClient();
    } catch {
      return;
    }

    const channel = supabase
      .channel(`panel:${activeCommunityId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "community_messages",
          filter: `community_id=eq.${activeCommunityId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            community_id: string;
            content: string;
            created_at: string;
            user_id: string;
          };

          // Update sidebar last_message for the active community, re-sort by
          // recency, and keep sidebarStore.data in sync for the next mount.
          setCommunities((prev) => {
            const updated = [...prev]
              .map((comm) =>
                comm.id === row.community_id
                  ? {
                      ...comm,
                      last_message: {
                        content: row.content,
                        created_at: row.created_at,
                        user: comm.last_message?.user ?? null,
                      },
                    }
                  : comm
              )
              .sort((a, b) => {
                const ta = a.last_message?.created_at ?? "";
                const tb = b.last_message?.created_at ?? "";
                return tb > ta ? 1 : -1;
              });

            if (sidebarStore.data) {
              sidebarStore.data = { ...sidebarStore.data, communities: updated };
            }

            return updated;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeCommunityId]);

  function handleNavigate(id: string) {
    // Navigate immediately — CommunityChat will show cached data right away
    router.push(`/dashboard/communities/${id}`);
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

      <div className="mx-3 mb-1" />

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
          <div className="py-1">
            {SECTIONS.map((section) => {
              const group = communities.filter((c) => c.type === section.type);
              return (
                <SectionGroup
                  key={section.type}
                  label={section.label}
                  communities={group}
                  activeCommunityId={activeCommunityId}
                  onNavigate={handleNavigate}
                  onPrefetchEnter={onEnter}
                  onPrefetchLeave={onLeave}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
