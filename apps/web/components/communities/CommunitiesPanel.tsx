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
  evictIfNeeded,
  MSG_STALE_MS,
  type CachedMessage,
} from "@/lib/communities/cache";

interface LastMessage {
  content: string;
  created_at: string;
  user: { name: string } | null;
}

interface Community {
  id: string;
  name: string;
  type: "city" | "sector" | "interest" | "company" | "experience_level";
  image_url: string | null;
  member_count: number;
  last_message: LastMessage | null;
}

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
 * Prefetch messages for a community on hover.
 *
 * - 200 ms debounce prevents spurious requests when the cursor moves quickly.
 * - Skips if data is already fresh (within MSG_STALE_MS).
 * - Deduplicates: if a fetch for this community is already in-flight (e.g.
 *   started by a previous hover or a click), reuses the existing promise
 *   instead of firing a second identical request.
 */
function usePrefetch() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onEnter = useCallback((communityId: string) => {
    // Already have fresh data — nothing to do.
    const fetchedAt = msgFetchedAt.get(communityId);
    if (fetchedAt && Date.now() - fetchedAt < MSG_STALE_MS) return;

    // A fetch is already in-flight for this community — let it finish.
    if (inFlightMsgFetch.has(communityId)) return;

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      // Re-check after the debounce window in case a click already started a fetch.
      if (inFlightMsgFetch.has(communityId)) return;
      const fetchedAt2 = msgFetchedAt.get(communityId);
      if (fetchedAt2 && Date.now() - fetchedAt2 < MSG_STALE_MS) return;

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

export function CommunitiesPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const { onEnter, onLeave } = usePrefetch();

  const activeCommunityId = pathname.match(
    /\/dashboard\/communities\/([^/]+)/
  )?.[1];

  /**
   * Ref that always holds the latest activeCommunityId.
   * Used inside the Realtime callback to decide whether to update msgCache
   * for the selected community (CommunityChat owns that) vs a background one.
   */
  const activeCommunityIdRef = useRef<string | undefined>(activeCommunityId);
  useEffect(() => {
    activeCommunityIdRef.current = activeCommunityId;
  }, [activeCommunityId]);

  // Fetch community list exactly once on mount
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/communities");
      if (!res.ok) return;
      const data = await res.json();
      setCommunities(data.communities ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Realtime subscriptions — one channel per community.
   *
   * Responsibilities:
   * 1. Update the sidebar last_message preview for ALL communities in real time.
   * 2. For NON-selected communities: append the new message to msgCache so the
   *    next visit renders instantly without a spinner. We store it with
   *    `users: null` (sender name not available from the raw payload); the
   *    background fetchMessages() that runs on selection will hydrate it.
   *    We intentionally do NOT fire an extra API call here — CommunityChat's
   *    Realtime handler covers the selected community, and for unselected ones
   *    a partial message in cache is better than no cache at all.
   *
   * Effect re-runs only when the set of community IDs changes (e.g. user joins
   * a new community), not on every navigation.
   */
  const communityIdsKey = communities.map((c) => c.id).join(",");

  useEffect(() => {
    if (!communities.length) return;

    let supabase: ReturnType<typeof createBrowserClient>;
    try {
      supabase = createBrowserClient();
    } catch {
      return;
    }

    const channels = communities.map((c) =>
      supabase
        .channel(`panel:${c.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "community_messages",
            filter: `community_id=eq.${c.id}`,
          },
          (payload) => {
            const row = payload.new as {
              id: string;
              community_id: string;
              content: string;
              created_at: string;
              user_id: string;
            };

            // 1. Update sidebar last_message and re-sort by recency.
            setCommunities((prev) =>
              [...prev]
                .map((comm) =>
                  comm.id === row.community_id
                    ? {
                        ...comm,
                        last_message: {
                          content: row.content,
                          created_at: row.created_at,
                          // Keep existing sender name if we have it; the
                          // full fetch on next visit will correct it.
                          user: comm.last_message?.user ?? null,
                        },
                      }
                    : comm
                )
                .sort((a, b) => {
                  const ta = a.last_message?.created_at ?? "";
                  const tb = b.last_message?.created_at ?? "";
                  return tb > ta ? 1 : -1;
                })
            );

            // 2. For non-selected communities: append partial message to cache.
            //    CommunityChat's own Realtime handler owns the selected community.
            if (activeCommunityIdRef.current === row.community_id) return;

            const cached = msgCache.get(row.community_id) ?? [];
            if (cached.some((m) => m.id === row.id)) return; // already there

            const partial: CachedMessage = {
              id: row.id,
              content: row.content,
              created_at: row.created_at,
              user_id: row.user_id,
              users: null, // hydrated on next selection via fetchMessages()
            };
            msgCache.set(row.community_id, [...cached, partial]);
            // Invalidate the fetch timestamp so the next visit always runs a
            // full fetchMessages() to hydrate sender info. Without this, if
            // msgFetchedAt[id] was set recently (< MSG_STALE_MS ago), the
            // partial message with users:null would be treated as fully fresh
            // and fetchMessages() would be skipped, leaving the sender name
            // permanently missing.
            msgFetchedAt.delete(row.community_id);
            evictIfNeeded();
          }
        )
        .subscribe()
    );

    return () => {
      for (const ch of channels) supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityIdsKey]);

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
