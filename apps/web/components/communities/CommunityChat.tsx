"use client";

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
} from "react";
import { Users, Clock, CheckCheck, ChevronDown } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { LottieLoader } from "@/components/ui/LottieLoader";
import { createBrowserClient } from "@/lib/supabase/browser";
import {
  msgCache,
  metaCache,
  msgFetchedAt,
  inFlightMsgFetch,
  evictIfNeeded,
  META_STALE_MS,
  MSG_STALE_MS,
  sidebarStore,
  type CachedMessage,
  type CachedMeta,
} from "@/lib/communities/cache";

/**
 * useLayoutEffect runs synchronously after DOM mutations but before the browser
 * paints — perfect for seeding React state from SSR props without a visible
 * spinner flash.  On the server, useLayoutEffect is a no-op, so we fall back
 * to useEffect to silence the SSR warning.
 */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

type Message = CachedMessage;

interface Community {
  id: string;
  name: string;
  type: string;
  member_count: number;
  image_url: string | null;
}

interface Member {
  user_id: string;
  users: { name: string; avatar_url: string | null } | null;
}

const TYPE_EMOJI: Record<string, string> = { city: "📍", sector: "🏢", interest: "✦" };

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function Avatar({ name, url, size = 8 }: { name: string; url: string | null; size?: number }) {
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const px = size * 4;
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        width={px}
        height={px}
        className={`rounded-full object-cover h-${size} w-${size} shrink-0`}
      />
    );
  }
  return (
    <div
      className={`h-${size} w-${size} shrink-0 rounded-full bg-accent/20 flex items-center justify-center font-body text-xs font-semibold text-accent select-none`}
    >
      {initials}
    </div>
  );
}

export function CommunityChat({
  communityId,
  currentUserId,
  initialMeta,
  initialMessages,
}: {
  communityId: string;
  currentUserId: string;
  /** Provided only on hard browser refresh (SSR). Undefined on client navigation. */
  initialMeta?: CachedMeta;
  /** Provided only on hard browser refresh (SSR). Undefined on client navigation. */
  initialMessages?: CachedMessage[];
}) {
  // ─── Initial state — always start empty to avoid SSR/client hydration mismatch ──
  //
  // "use client" components STILL run on the server for SSR. Module-level caches
  // (metaCache, sidebarStore, msgCache) can hold stale data from a previous
  // server-side request within the same Node.js process.  If we read them here,
  // the server may render actual content while a fresh browser renders a skeleton
  // (or vice-versa) → React throws a hydration error and enters an infinite
  // re-render loop that resets state and drops messages.
  //
  // Solution: always render null/empty/loading on both server and client for
  // the initial render pass.  The layout effect below (client-only) then seeds
  // state from cache or SSR props before the first browser paint — so the user
  // never sees a flash.
  //
  // hasMounted gates any read of module-level caches (e.g. sidebarStore) during
  // render. It starts false on both server and client so the first render is
  // identical (no hydration mismatch). The layout effect sets it to true
  // synchronously before the first browser paint, so the user never sees a flash.
  const [hasMounted, setHasMounted] = useState(false);
  const [community, setCommunity] = useState<Community | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showMembersDropdown, setShowMembersDropdown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const membersDropdownRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Tracks the *currently mounted* communityId.
   * Stale-response guard: async fetches capture `communityId` by closure,
   * then compare against this ref before writing React state.
   */
  const communityIdRef = useRef(communityId);

  /**
   * Tracks the current members list so the realtime callback can resolve sender
   * info without closing over a stale snapshot and without re-subscribing on
   * every members update.
   */
  const membersRef = useRef(members);
  useEffect(() => { membersRef.current = members; }, [members]);

  // ─── Seed state from cache or SSR props — client-only, before first paint ──
  //
  // useLayoutEffect runs synchronously after DOM commit but before the browser
  // paints, so the user never sees the empty/loading state that the initial
  // render produces.  It does NOT run during SSR, which is exactly what we want:
  // both server and client render the same empty/loading initial pass (no
  // hydration mismatch), then this effect immediately fills in the right data
  // before the first pixel is shown.
  //
  // Two cases:
  //   1. Client-side navigation  → module-level caches are warm; read directly.
  //   2. Hard browser refresh    → caches are empty; initialMeta/initialMessages
  //      come from the server and are used to seed both the cache and state.
  useIsomorphicLayoutEffect(() => {
    // Mark as mounted so the render path can safely read module-level caches
    // (e.g. sidebarStore) without causing a hydration mismatch.
    setHasMounted(true);

    const cachedMeta = metaCache.get(communityId);
    const cachedMsgs = msgCache.get(communityId);

    if (cachedMeta) {
      // Case 1: client-nav — cache is warm.
      setCommunity(cachedMeta.community);
      setMembers(cachedMeta.members);
    } else if (initialMeta) {
      // Case 2: hard refresh — seed cache from SSR props.
      metaCache.set(communityId, { ...initialMeta, fetchedAt: Date.now() });
      setCommunity(initialMeta.community);
      setMembers(initialMeta.members);
    }

    if (cachedMsgs?.length) {
      setMessages(cachedMsgs);
    } else if (initialMessages?.length) {
      msgCache.set(communityId, initialMessages);
      msgFetchedAt.set(communityId, Date.now());
      evictIfNeeded();
      setMessages(initialMessages);
    }

    if (cachedMeta || initialMeta) setLoading(false);

    // communityId, initialMeta, initialMessages are stable for this component
    // instance (they come from the page params and never change after mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        membersDropdownRef.current &&
        !membersDropdownRef.current.contains(e.target as Node)
      ) {
        setShowMembersDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ─── Fetch community metadata only (header + members) ────────────────────
  const fetchMeta = useCallback(async () => {
    const targetId = communityId;
    const res = await fetch(`/api/communities/${targetId}`);
    if (!res.ok) return;
    const d = await res.json();

    if (communityIdRef.current !== targetId) return;

    const cached: CachedMeta = {
      community: d.community,
      members: d.members ?? [],
      fetchedAt: Date.now(),
    };
    metaCache.set(targetId, cached);
    setCommunity(d.community);
    setMembers(d.members ?? []);
  }, [communityId]);

  // ─── Fetch messages (full or incremental via ?after=ISO) ─────────────────
  const fetchMessages = useCallback(
    (after?: string): Promise<void> => {
      const targetId = communityId;

      if (!after) {
        const inflight = inFlightMsgFetch.get(targetId);
        if (inflight) {
          // The in-flight promise was most likely started by the hover prefetch
          // in CommunitiesPanel. That prefetch writes to msgCache but never calls
          // setMessages — it has no reference to React state. If we return the
          // bare promise the IIFE will await it, see it resolved, then call
          // setLoading(false) while messages is still [] → empty chat after Lottie.
          //
          // Fix: chain a .then() so that once the prefetch resolves (and msgCache
          // is populated) we immediately sync the cached messages into React state.
          return inflight.then(() => {
            const cached = msgCache.get(targetId);
            if (communityIdRef.current === targetId && cached?.length) {
              setMessages(cached);
            }
          });
        }
      }

      const url = after
        ? `/api/communities/${targetId}/messages?after=${encodeURIComponent(after)}`
        : `/api/communities/${targetId}/messages`;

      const p: Promise<void> = fetch(url)
        .then((res) => (res.ok ? res.json() : undefined))
        .then((d) => {
          if (!d) return;
          const incoming: Message[] = d.messages ?? [];

          if (after) {
            // ── Update the cache FIRST, unconditionally ───────────────────
            // The full-fetch path already does this (msgCache.set is outside
            // setMessages). The incremental path must do the same: if the
            // component unmounts between when the fetch was fired and when
            // React would run the updater, React silently skips the updater —
            // meaning msgCache would never be written and the next mount would
            // read stale data, causing the "needs two navigations" bug.
            //
            // By writing to msgCache here (before setMessages), we guarantee
            // the cache is always current regardless of mount status. The next
            // mount's layout effect will read the fresh cache and display new
            // messages immediately.
            const existing = msgCache.get(targetId) ?? [];
            const existingIds = new Set(existing.map((m) => m.id));
            const toAdd = incoming.filter((m) => !existingIds.has(m.id));
            if (toAdd.length > 0) {
              const cacheSnapshot = [
                ...existing.filter((m) => !m.id.startsWith("temp-")),
                ...toAdd,
              ].sort(
                (a, b) =>
                  new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              );
              msgCache.set(targetId, cacheSnapshot);
            }

            // ── Then sync React state via functional updater ───────────────
            // Uses `prev` (not the cache snapshot) so we correctly incorporate
            // any optimistic messages that are in flight in state but have not
            // yet been confirmed by Realtime. Guarded by communityIdRef to
            // prevent a stale fetch from updating the wrong community's UI.
            setMessages((prev) => {
              if (communityIdRef.current !== targetId) return prev;
              const prevIds = new Set(prev.map((m) => m.id));
              const toAddToPrev = incoming.filter((m) => !prevIds.has(m.id));
              if (toAddToPrev.length === 0) return prev;
              const merged = [
                ...prev.filter((m) => !m.id.startsWith("temp-")),
                ...toAddToPrev,
              ].sort(
                (a, b) =>
                  new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              );
              // Keep cache in sync with actual state (which may include
              // resolved optimistic messages that weren't in cacheSnapshot).
              msgCache.set(targetId, merged);
              return merged;
            });
          } else {
            msgCache.set(targetId, incoming);
            msgFetchedAt.set(targetId, Date.now());
            evictIfNeeded();
            if (communityIdRef.current === targetId) {
              setMessages(incoming);
            }
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!after) inFlightMsgFetch.delete(targetId);
        });

      if (!after) inFlightMsgFetch.set(targetId, p);
      return p;
    },
    [communityId]
  );

  // ─── On communityId change: show cache instantly, always catch up ─────────
  //
  // The SSR seed effect (above) runs before this on the initial mount, so
  // msgFetchedAt and metaCache will already be populated for hard-refresh
  // loads — but we still do an incremental catch-up to pick up any messages
  // that arrived while the browser was on another page or community.
  //
  // Key invariant: if cached messages exist, ALWAYS do an incremental fetch
  // (regardless of MSG_STALE_MS) to pick up anything missed while away.
  // MSG_STALE_MS only gates full refetches when there is no cache at all.
  useEffect(() => {
    communityIdRef.current = communityId;
    let cancelled = false;

    const cachedMsgs = msgCache.get(communityId);
    const cachedMeta = metaCache.get(communityId);

    setMessages(cachedMsgs ?? []);
    if (cachedMeta) {
      setCommunity(cachedMeta.community);
      setMembers(cachedMeta.members);
      setLoading(false);
    } else {
      // Keep the previous community/members in state so the header and members
      // panel stay frozen (showing the old community) while the new one loads.
      // Only clear them on a truly fresh mount where there is no prior state.
      setLoading(true);
    }

    const metaIsStale =
      !cachedMeta || Date.now() - cachedMeta.fetchedAt > META_STALE_MS;

    // Message fetch strategy:
    //   • Cache exists → incremental fetch from the latest real message's
    //     created_at. This catches any messages received while the user was
    //     viewing a different community or a different page entirely.
    //     We do this regardless of MSG_STALE_MS to never miss a message.
    //   • No cache → full fetch (the normal first-load path).
    const msgPromise = (() => {
      if (cachedMsgs?.length) {
        const lastReal = cachedMsgs
          .filter((m) => !m.id.startsWith("temp-"))
          .at(-1);
        return fetchMessages(lastReal?.created_at);
      }
      return fetchMessages();
    })();

    (async () => {
      await Promise.all([
        msgPromise,
        metaIsStale ? fetchMeta() : Promise.resolve(),
      ]);
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId]);

  // ─── Scroll to bottom on new messages ────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /**
   * Tracks user IDs whose profiles are currently being fetched lazily so we
   * never fire more than one request per unknown sender across rapid Realtime
   * events.  Keyed by userId, value is the in-flight Promise.
   */
  const pendingProfileFetchRef = useRef<Map<string, Promise<void>>>(new Map());

  // ─── Supabase Realtime — instant append + reconnect catch-up ─────────────
  //
  // Two responsibilities in one channel:
  //
  // 1. MESSAGE INSERT — append immediately from the payload (zero HTTP round-trip).
  //    Sender info is resolved from membersRef. If the sender is NOT yet in
  //    membersRef (e.g. they just joined), the message is appended immediately
  //    with users:null (gracefully rendered by the UI), and a background fetch
  //    to /api/communities/[id]/members/[userId] patches the sender's name +
  //    avatar into state + membersRef without any full refetch.
  //
  // 2. RECONNECT CATCH-UP — the subscribe status callback fires "SUBSCRIBED"
  //    on every successful (re)connection.  After the first connection we track
  //    this with hasSubscribedRef; on subsequent "SUBSCRIBED" events we do an
  //    incremental fetch from the latest cached message so no messages are
  //    missed during the websocket gap.
  useEffect(() => {
    let supabase: ReturnType<typeof createBrowserClient>;
    try {
      supabase = createBrowserClient();
    } catch {
      return;
    }

    /** True after the very first SUBSCRIBED ack — used to detect reconnects. */
    const hasSubscribedRef = { current: false };

    const channel = supabase
      .channel(`community:${communityId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "community_messages",
          filter: `community_id=eq.${communityId}`,
        },
        (payload) => {
          const newRow = payload.new as {
            id: string;
            community_id: string;
            user_id: string;
            content: string;
            created_at: string;
          };

          setMessages((prev) => {
            // Already in state (optimistic send or duplicate event) — skip.
            if (prev.some((m) => m.id === newRow.id)) return prev;

            // Remove the optimistic temp bubble if this is our own message
            // (the real row just landed from the DB).
            const withoutTemp = prev.filter(
              (m) => !(m.id.startsWith("temp-") && m.user_id === newRow.user_id)
            );

            // Resolve sender info from the members list we already have.
            const senderMember = membersRef.current.find(
              (m) => m.user_id === newRow.user_id
            );
            const users = senderMember?.users ?? null;

            const incoming: Message = {
              id: newRow.id,
              content: newRow.content,
              created_at: newRow.created_at,
              user_id: newRow.user_id,
              users,
              status: "sent",
            };

            const next = [...withoutTemp, incoming].sort(
              (a, b) =>
                new Date(a.created_at).getTime() -
                new Date(b.created_at).getTime()
            );
            msgCache.set(communityId, next);

            // ── Lazy sender profile fetch ─────────────────────────────────
            // If the sender is unknown (not in membersRef yet — e.g. they just
            // joined), fire a single background request to fetch their profile.
            // Deduplicated by pendingProfileFetchRef so rapid events for the
            // same unknown user only trigger one HTTP call.
            if (!senderMember && !pendingProfileFetchRef.current.has(newRow.user_id)) {
              const targetCommunityId = communityId;
              const targetUserId = newRow.user_id;
              const targetMsgId = newRow.id;

              const p: Promise<void> = fetch(
                `/api/communities/${targetCommunityId}/members/${targetUserId}`
              )
                .then((r) => (r.ok ? r.json() : null))
                .then((profile: { name: string; avatar_url: string | null } | null) => {
                  if (!profile) return;

                  const resolvedUsers = {
                    name: profile.name,
                    avatar_url: profile.avatar_url,
                  };

                  // Add to membersRef so future messages from this user resolve instantly.
                  membersRef.current = [
                    ...membersRef.current,
                    { user_id: targetUserId, users: resolvedUsers },
                  ];

                  // Patch the already-appended message with the now-known sender info.
                  setMessages((prev) => {
                    const next = prev.map((m) =>
                      m.id === targetMsgId && m.users === null
                        ? { ...m, users: resolvedUsers }
                        : m
                    );
                    msgCache.set(targetCommunityId, next);
                    return next;
                  });
                })
                .catch(() => {})
                .finally(() => {
                  pendingProfileFetchRef.current.delete(targetUserId);
                });

              pendingProfileFetchRef.current.set(targetUserId, p);
            }

            return next;
          });
        }
      )
      .subscribe((status) => {
        // ── Reconnect catch-up ────────────────────────────────────────────
        // "SUBSCRIBED" fires both on the initial connection and on every
        // reconnect after a websocket drop.  Skip the first one (the
        // communityId effect already runs an incremental fetch on mount/switch).
        // On subsequent "SUBSCRIBED" events, do an incremental catch-up to
        // recover any messages that arrived during the gap.
        if (status === "SUBSCRIBED") {
          if (!hasSubscribedRef.current) {
            hasSubscribedRef.current = true;
          } else {
            // Reconnect — catch up from the latest cached message.
            const cached = msgCache.get(communityId) ?? [];
            const lastReal = cached.filter((m) => !m.id.startsWith("temp-")).at(-1);
            fetchMessages(lastReal?.created_at ?? undefined);
          }
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, fetchMessages]);

  // ─── Polling fallback ─────────────────────────────────────────────────────
  // Catches messages that Supabase Realtime may miss (e.g. if the table is not
  // yet in the realtime publication, or on a flaky connection). Runs every 5 s
  // only when the tab is visible to avoid unnecessary load.
  useEffect(() => {
    const poll = () => {
      if (document.visibilityState !== "visible") return;
      const cached = msgCache.get(communityId) ?? [];
      const lastReal = cached.filter((m) => !m.id.startsWith("temp-")).at(-1);
      fetchMessages(lastReal?.created_at ?? undefined);
    };

    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [communityId, fetchMessages]);

  // ─── Tab visibility / window focus catch-up ───────────────────────────────
  // When the browser tab becomes visible again (after suspension or switching)
  // or the window regains focus, incrementally fetch any messages received
  // while the Realtime connection was paused or the user was away.
  // This is a lightweight point-in-time fetch — not polling.
  useEffect(() => {
    const handleCatchUp = () => {
      if (document.visibilityState !== "visible") return;
      const cached = msgCache.get(communityId) ?? [];
      const lastReal = cached.filter((m) => !m.id.startsWith("temp-")).at(-1);
      fetchMessages(lastReal?.created_at ?? undefined);
    };

    document.addEventListener("visibilitychange", handleCatchUp);
    window.addEventListener("focus", handleCatchUp);
    return () => {
      document.removeEventListener("visibilitychange", handleCatchUp);
      window.removeEventListener("focus", handleCatchUp);
    };
  }, [communityId, fetchMessages]);

  // ─── Send a message ───────────────────────────────────────────────────────
  async function handleSend() {
    const content = input.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);

    const tempId = `temp-${Date.now()}`;
    const optimistic: Message = {
      id: tempId,
      content,
      created_at: new Date().toISOString(),
      user_id: currentUserId,
      users: null,
      status: "sending",
    };

    setMessages((prev) => {
      const next = [...prev, optimistic];
      msgCache.set(communityId, next);
      return next;
    });
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "24px";
    inputRef.current?.focus();

    try {
      const res = await fetch(`/api/communities/${communityId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (res.ok) {
        const { message } = await res.json();
        setMessages((prev) => {
          if (prev.some((m) => m.id === message.id)) {
            const next = prev.filter((m) => m.id !== tempId);
            msgCache.set(communityId, next);
            return next;
          }
          const next = prev.map((m) =>
            m.id === tempId ? { ...message, status: "sent" as const } : m
          );
          msgCache.set(communityId, next);
          return next;
        });
      } else {
        const d = await res.json();
        setMessages((prev) => {
          const next = prev.map((m) =>
            m.id === tempId ? { ...m, status: "failed" as const } : m
          );
          msgCache.set(communityId, next);
          return next;
        });
        setError(d.error ?? "Failed to send.");
      }
    } catch {
      setMessages((prev) => {
        const next = prev.map((m) =>
          m.id === tempId ? { ...m, status: "failed" as const } : m
        );
        msgCache.set(communityId, next);
        return next;
      });
      setError("Network error.");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ─── Group messages by date ───────────────────────────────────────────────
  type Group = { date: string; messages: Message[] };
  const grouped = messages.reduce<Group[]>((acc, msg) => {
    const date = fmtDate(msg.created_at);
    const last = acc[acc.length - 1];
    if (last?.date === date) {
      last.messages.push(msg);
    } else {
      acc.push({ date, messages: [msg] });
    }
    return acc;
  }, []);

  // Resolve display data: prefer live community state, fall back to sidebar
  // cache so the header renders immediately even before fetchMeta completes.
  // This means the loader only ever appears inside the chatbox — never full-area.
  //
  // IMPORTANT: sidebarStore is a module-level cache that persists across client
  // navigations. Reading it during render before `hasMounted` is set would make
  // the server render (empty cache) and the client's first hydration render
  // (warm cache) produce different output → React hydration error.
  // We gate it on `hasMounted` (set synchronously by useLayoutEffect before
  // the first browser paint) so both server and client agree on the initial
  // render, and then the cache is applied immediately without a visible flash.
  const sidebarEntry = hasMounted
    ? sidebarStore.data?.communities.find((c) => c.id === communityId)
    : undefined;
  const displayCommunity = community ?? (sidebarEntry
    ? {
        id: communityId,
        name: sidebarEntry.name,
        type: sidebarEntry.type,
        member_count: sidebarEntry.member_count,
        image_url: sidebarEntry.image_url,
      }
    : null);
  const sidebarType = displayCommunity?.type ?? "";

  // No community in state AND nothing in sidebar cache (e.g. direct URL with
  // an id that's not in the sidebar list) AND not loading = community not found.
  if (!loading && !displayCommunity) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="font-body text-sm text-foreground-muted">
          Community not found.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Chat header — uses displayCommunity so it renders immediately from
          sidebarStore even before fetchMeta completes, preventing any
          full-area flash. */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface shrink-0">
        {displayCommunity ? (
          <>
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-surface-raised flex items-center justify-center text-sm shrink-0 overflow-hidden">
                {displayCommunity.image_url ? (
                  <img
                    src={displayCommunity.image_url}
                    alt={displayCommunity.name}
                    className="h-9 w-9 rounded-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                      e.currentTarget.parentElement!.textContent =
                        TYPE_EMOJI[displayCommunity.type] ?? "💬";
                    }}
                  />
                ) : (
                  TYPE_EMOJI[displayCommunity.type] ?? "💬"
                )}
              </div>
              <div>
                <h3 className="font-display text-sm font-semibold text-foreground leading-none">
                  {displayCommunity.name}
                </h3>
                <p className="font-body text-[11px] text-foreground-muted mt-0.5 flex items-center gap-1">
                  <Users size={10} /> {displayCommunity.member_count} member
                  {displayCommunity.member_count !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Users size={14} className="text-foreground-muted" />
              <span className="font-body text-xs text-foreground-muted">
                {displayCommunity.member_count} member
                {displayCommunity.member_count !== 1 ? "s" : ""}
              </span>
            </div>
          </>
        ) : (
          /* Direct-URL load with nothing in sidebar cache yet: skeleton header */
          <div className="h-5 w-48 rounded bg-surface-raised animate-pulse" />
        )}
      </div>

      {/* Body: messages + members panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Messages */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">
            {/* Loading: show Lottie only inside the messages area.
                The header, members panel, and input stay frozen from the
                previous community so the outer frame never disappears. */}
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <LottieLoader
                  communityId={communityId}
                  communityType={sidebarType}
                  size={200}
                  spinnerClassName="h-5 w-5 text-foreground-muted"
                />
              </div>
            ) : (
              <>
            {grouped.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3 py-16">
                <div className="h-12 w-12 rounded-full bg-surface-raised flex items-center justify-center text-2xl overflow-hidden shrink-0">
                  {displayCommunity?.image_url ? (
                    <img
                      src={displayCommunity.image_url}
                      alt={displayCommunity.name}
                      className="h-12 w-12 rounded-full object-cover"
                    />
                  ) : (
                    TYPE_EMOJI[displayCommunity?.type ?? ""] ?? "💬"
                  )}
                </div>
                <p className="font-body text-sm text-foreground-muted text-center">
                  Welcome to{" "}
                  <span className="font-medium text-foreground">
                    {displayCommunity?.name ?? ""}
                  </span>
                  !
                  <br />
                  <span className="text-xs">Be the first to say something.</span>
                </p>
              </div>
            )}

            {grouped.map((group) => (
              <div key={group.date}>
                <div className="flex items-center justify-center py-3">
                  <span className="font-body text-[11px] text-foreground-muted bg-surface-raised rounded-full px-3 py-0.5 shadow-[0_1px_6px_rgba(0,0,0,0.25)]">
                    {group.date}
                  </span>
                </div>

                {group.messages.map((msg, i) => {
                  const isMe = msg.user_id === currentUserId;
                  const prev = group.messages[i - 1];
                  const isSameAuthor = prev?.user_id === msg.user_id;
                  const sender = msg.users;

                  if (isMe) {
                    return (
                      <div
                        key={msg.id}
                        className={`flex justify-end ${isSameAuthor ? "mt-0.5" : "mt-3"}`}
                      >
                        <div className="max-w-[65%]">
                          <div
                            className={`rounded-2xl rounded-tr-sm px-3 py-2 transition-opacity ${
                              msg.status === "sending"
                                ? "bg-accent opacity-70"
                                : msg.status === "failed"
                                ? "bg-red-500/80"
                                : "bg-accent"
                            }`}
                          >
                            <p className="font-body text-sm text-accent-foreground whitespace-pre-wrap break-words">
                              {msg.content}
                            </p>
                          </div>
                          <div className="flex items-center justify-end gap-1 mt-0.5 pr-1">
                            <span className="font-mono text-[10px] text-foreground-muted">
                              {fmtTime(msg.created_at)}
                            </span>
                            {msg.status === "sending" && (
                              <Clock
                                size={10}
                                className="text-foreground-muted animate-pulse"
                              />
                            )}
                            {(msg.status === "sent" || !msg.status) && (
                              <CheckCheck size={11} className="text-accent" />
                            )}
                            {msg.status === "failed" && (
                              <span className="text-[10px] text-red-400">!</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={msg.id}
                      className={`flex items-start gap-2 ${isSameAuthor ? "mt-0.5" : "mt-3"}`}
                    >
                      <div className="w-7 shrink-0">
                        {!isSameAuthor && sender && (
                          <Avatar
                            name={sender.name}
                            url={sender.avatar_url}
                            size={7}
                          />
                        )}
                      </div>
                      <div className="max-w-[65%]">
                        {!isSameAuthor && sender && (
                          <p className="font-body text-[11px] font-medium text-foreground-muted mb-0.5 ml-0.5">
                            {sender.name}
                          </p>
                        )}
                        <div className="rounded-2xl rounded-tl-sm bg-surface-raised shadow-sm px-3 py-2">
                          <p className="font-body text-sm text-foreground whitespace-pre-wrap break-words">
                            {msg.content}
                          </p>
                        </div>
                        <p className="font-mono text-[10px] text-foreground-muted mt-0.5 ml-0.5">
                          {fmtTime(msg.created_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            <div ref={bottomRef} />
              </>
            )}
          </div>

          {/* Floating Input */}
          <div className="px-4 pb-4 pt-2 shrink-0">
            {error && (
              <p className="font-body text-xs text-red-400 mb-2 pl-1">{error}</p>
            )}
            <div className="flex items-end gap-2 bg-surface-raised rounded-2xl shadow-md px-4 py-3 min-h-[52px]">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                }}
                onKeyDown={handleKeyDown}
                placeholder={`Message ${displayCommunity?.name ?? ""}…`}
                rows={1}
                className="flex-1 resize-none bg-transparent font-body text-sm text-foreground placeholder:text-foreground-muted outline-none overflow-y-auto"
                style={{ lineHeight: "1.5", height: "24px", maxHeight: "120px" }}
              />
              {input.trim() && (
                <button
                  onClick={handleSend}
                  disabled={sending}
                  className="shrink-0 h-8 w-8 flex items-center justify-center rounded-full bg-accent text-accent-foreground hover:bg-accent-hover transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Send"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="w-[15px] h-[15px]"
                    style={{ marginLeft: "1px" }}
                  >
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Members panel */}
        <div className="w-56 shrink-0 border-l border-border bg-surface flex flex-col overflow-hidden">
          <div
            className="px-4 py-3 border-b border-border relative"
            ref={membersDropdownRef}
          >
            <button
              onClick={() => setShowMembersDropdown((v) => !v)}
              className="flex items-center gap-1.5 group"
            >
              <span className="font-body text-sm font-medium text-foreground-muted group-hover:text-foreground transition-colors">
                Members
              </span>
              <ChevronDown
                size={14}
                className={`text-foreground-muted group-hover:text-foreground transition-transform duration-200 ${
                  showMembersDropdown ? "rotate-180" : ""
                }`}
              />
            </button>

            {showMembersDropdown && (
              <div className="absolute left-4 top-full mt-1 z-50 w-40 rounded-lg border border-border bg-surface shadow-lg py-1 overflow-hidden">
                <button
                  className="w-full text-left px-4 py-2.5 font-body text-sm text-foreground hover:bg-surface-raised transition-colors"
                  onClick={() => setShowMembersDropdown(false)}
                >
                  Topics
                </button>
                <button
                  className="w-full text-left px-4 py-2.5 font-body text-sm text-foreground hover:bg-surface-raised transition-colors"
                  onClick={() => setShowMembersDropdown(false)}
                >
                  Settings
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
            {members.map((m) => (
              <div key={m.user_id} className="flex items-center gap-2 py-1.5">
                <Avatar
                  name={m.users?.name ?? "?"}
                  url={m.users?.avatar_url ?? null}
                  size={7}
                />
                <span className="font-body text-xs text-foreground truncate">
                  {m.users?.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
