"use client";

import {
  Fragment,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { Users, Clock, CheckCheck, ChevronDown } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { LottieLoader } from "@/components/ui/LottieLoader";
import { AvatarImg } from "@/components/ui/AvatarImg";
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
  lastReadAtOnOpen,
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
      <AvatarImg
        url={url}
        name={name}
        size={px}
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
  initialLastReadAt,
}: {
  communityId: string;
  currentUserId: string;
  /** Provided only on hard browser refresh (SSR). Undefined on client navigation. */
  initialMeta?: CachedMeta;
  /** Provided only on hard browser refresh (SSR). Undefined on client navigation. */
  initialMessages?: CachedMessage[];
  /**
   * The user's last_read_at for this community at the time of the hard refresh.
   * Used to position the unread divider by timestamp comparison (more reliable
   * than count-from-end, which mismatches when the user also sent messages).
   * null = user never opened this community before.
   * undefined = client-side navigation; lastReadAtOnOpen map is used instead.
   */
  initialLastReadAt?: string | null;
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
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const initialScrollDoneRef = useRef(false);
  const unreadDividerRef = useRef<HTMLDivElement>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [hideUnreadDivider, setHideUnreadDivider] = useState(false);
  /**
   * The last_read_at timestamp captured the moment this community was opened.
   * Used to find the first unread message by timestamp comparison (immune to the
   * count-mismatch bug where message_count only counted other users' messages).
   * null  = community was never read before (all messages are "new").
   * undefined = not yet known (divider is hidden until we get the value).
   */
  const [lastReadAt, setLastReadAt] = useState<string | null | undefined>(undefined);
  /**
   * Frozen snapshot of the unread boundary captured the moment lastReadAt is
   * first known for this chat session.  Never mutated afterward — this is what
   * WhatsApp calls the "unread boundary": it stays at the same chronological
   * position regardless of new messages arriving or the server marking messages
   * read.  null = snapshot not yet taken (divider hidden until ready).
   */
  const unreadAtOpenRef = useRef<{ firstMsgId: string | null; count: number } | null>(null);
  /** Flips to true once unreadAtOpenRef has been populated, triggering a render
   *  so the divider element appears in the DOM before the initial scroll runs. */
  const [snapshotReady, setSnapshotReady] = useState(false);
  /**
   * Flips to true only after the initial message fetch (msgPromise) resolves.
   * Used only by the FALLBACK path when the fast-path layout effect could not
   * compute the snapshot immediately (cold cache or stale cache safety check).
   */
  const [initialMessagesReady, setInitialMessagesReady] = useState(false);
  /**
   * Controls whether the message timeline is visible. Starts false so the
   * browser never paints messages at an incorrect scroll position. Set to true
   * by the initial-scroll layout effect immediately after it positions the
   * viewport — so the FIRST visible frame is already at the correct position.
   *
   * visibility:hidden (not display:none) is used so the DOM exists and its
   * height/scroll metrics can be measured by the layout effect.
   *
   * Header, composer, and members panel remain visible throughout.
   */
  const [initialPositionResolved, setInitialPositionResolved] = useState(false);
  /** Set to true by the realtime INSERT handler before calling setMessages,
   *  so the messages-change effect knows a real insert just happened. */
  const realtimeInsertPendingRef = useRef(false);
  /** Captured by the INSERT handler: was the user near the bottom at that moment? */
  const realtimeWasNearBottomRef = useRef(false);

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

    // Case 2 (hard refresh): seed lastReadAt from the SSR prop so the divider
    // is positioned correctly before lastReadAtOnOpen is populated.
    // On client-nav the communityId effect handles this via lastReadAtOnOpen.
    // Only seed when there are no cached messages; if the cache is warm, the
    // communityId effect's lastReadAtOnOpen read is authoritative.
    if (!cachedMsgs?.length && initialLastReadAt !== undefined) {
      setLastReadAt(initialLastReadAt);
    }

    // communityId, initialMeta, initialMessages, initialLastReadAt are stable
    // for this component instance (from page params, never change after mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Fast-path: compute unread snapshot from cache BEFORE first paint ─────
  //
  // Runs synchronously (layout phase) on every communityId change so the very
  // first browser frame is already positioned at the unread boundary.
  //
  // Why layout effect?
  //   A regular useEffect fires after the browser has had a chance to paint.
  //   By using useIsomorphicLayoutEffect we run in the same synchronous phase as
  //   React DOM commits — before any pixels are drawn. State updates made here
  //   trigger a synchronous re-render (still pre-paint), so the user never sees
  //   the intermediate "scrollTop=0" state.
  //
  // Fast path fires when:
  //   1. cachedMsgs are available (warm cache from hover-prefetch or prior visit)
  //   2. lastReadAtOnOpen has the OLD last_read_at captured by handleNavigate
  //
  // Safety gate: if the sidebar says message_count > 0 but the cached messages
  // produce 0 unread (cache predates the unread messages), we don't freeze an
  // incorrect zero snapshot. Instead we stay hidden and let the incremental
  // fetch + fallback snapshot path handle it.
  useIsomorphicLayoutEffect(() => {
    // ── Reset scroll / unread / visibility state for this community ──────────
    // These MUST be reset in the layout phase so the scroll layout effect (also
    // in the layout phase) sees a clean slate before snapshotReady flips true.
    initialScrollDoneRef.current = false;
    unreadAtOpenRef.current = null;
    setHideUnreadDivider(false);
    setSnapshotReady(false);
    setInitialPositionResolved(false);

    const cachedMsgs = msgCache.get(communityId);
    const hasOpeningLastReadAt = lastReadAtOnOpen.has(communityId);

    if (!cachedMsgs?.length || !hasOpeningLastReadAt) {
      // Cannot fast-path: cache is cold or opening snapshot not yet available.
      // Messages stay hidden (initialPositionResolved=false) until the fallback
      // path (incremental fetch → snapshot effect → scroll layout effect) runs.
      return;
    }

    const openingLastReadAt = lastReadAtOnOpen.get(communityId) ?? null;
    // Consume the map entry so the snapshot effect's fallback poll is skipped.
    lastReadAtOnOpen.delete(communityId);
    // Surface lastReadAt in state so the snapshot effect can use it if needed.
    setLastReadAt(openingLastReadAt);

    // ── Safety check ─────────────────────────────────────────────────────────
    // If the sidebar still shows unread messages but the cached snapshot yields
    // zero unread (e.g. the cache was fetched before those messages arrived),
    // the cache is stale. Fall back to the incremental fetch path rather than
    // freezing a wrong zero count. Messages stay hidden until positioned.
    const sidebarEntry_ = sidebarStore.data?.communities.find(
      (c) => c.id === communityId
    );
    const sidebarUnreadCount = sidebarEntry_?.message_count ?? 0;

    const lastReadTime =
      openingLastReadAt === null ? -Infinity : new Date(openingLastReadAt).getTime();
    const unreadMsgs = cachedMsgs.filter(
      (m) =>
        !m.id.startsWith("temp-") &&
        m.user_id !== currentUserId &&
        new Date(m.created_at).getTime() > lastReadTime
    );

    if (sidebarUnreadCount > 0 && unreadMsgs.length === 0) {
      // Sidebar says there are unreads but they aren't in the message cache —
      // cache is stale. Fall back to the incremental fetch path.
      return;
    }

    if (unreadMsgs.length === 0) {
      // Zero unread in the message cache. We can't confirm the sidebar count is
      // accurate — it may be stale if CommunitiesPanel was unmounted while
      // messages arrived (real-time subscriptions only run while the panel is
      // mounted, e.g. not on /dashboard or /profile). Fall back to the
      // incremental fetch + snapshot-effect path, which re-computes the
      // boundary against fresh server messages. For communities that truly have
      // 0 unreads this adds one network round-trip (~100–200 ms); for
      // communities that DO have missed unreads this prevents the divider from
      // silently disappearing.
      return;
    }

    // ── Freeze the snapshot ───────────────────────────────────────────────────
    unreadAtOpenRef.current = {
      firstMsgId: unreadMsgs[0]?.id ?? null,
      count: unreadMsgs.length,
    };
    // Trigger re-render so the divider element appears in the DOM; the scroll
    // layout effect below will then position the viewport before paint.
    setSnapshotReady(true);

    // currentUserId is a stable prop — intentionally omitted from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId]);

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
    // scroll/unread/position state is reset in the fast-path layout effect above
    // (which runs synchronously before this effect). Only reset the async flags
    // that the layout effect doesn't touch.
    setShowScrollToBottom(false);
    setInitialMessagesReady(false);

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
      if (!cancelled) {
        setLoading(false);
        // Signal that initial message catch-up is complete.  The snapshot effect
        // waits for this before freezing the unread boundary — this prevents the
        // snapshot from being taken against stale cached messages before the
        // incremental fetch has added any new unread messages.
        setInitialMessagesReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId]);

  // ─── Effect 1: Unread boundary snapshot ──────────────────────────────────
  // Runs once after BOTH lastReadAt is known AND the initial message fetch has
  // completed (initialMessagesReady). This guarantees the snapshot is taken
  // against the full post-catch-up message list, not stale cached data.
  // Does NOT depend on `messages` — we intentionally avoid re-running when
  // realtime messages arrive after the snapshot has been frozen.
  useEffect(() => {
    if (!initialMessagesReady) return;
    if (snapshotReady) return; // already done for this session

    // Resolve lastReadAt if CommunitiesPanel's effect ran after ours.
    if (lastReadAt === undefined) {
      if (lastReadAtOnOpen.has(communityId)) {
        setLastReadAt(lastReadAtOnOpen.get(communityId) ?? null);
        lastReadAtOnOpen.delete(communityId);
        // State update → re-render → this effect fires again with lastReadAt set.
        return;
      }
      // PATCH still in flight — poll after a short delay then give up with null.
      const timer = setTimeout(() => {
        if (communityIdRef.current !== communityId) return;
        if (lastReadAtOnOpen.has(communityId)) {
          setLastReadAt(lastReadAtOnOpen.get(communityId) ?? null);
          lastReadAtOnOpen.delete(communityId);
        } else {
          // PATCH never returned previousLastReadAt — treat as no prior reads.
          setLastReadAt(null);
        }
      }, 800);
      return () => clearTimeout(timer);
    }

    // Compute the frozen snapshot from the messages currently in state.
    // These are the post-catch-up messages: any unread messages that arrived
    // while the user was away are now present.
    const realMsgs = messages.filter((m) => !m.id.startsWith("temp-"));
    const lastReadTime =
      lastReadAt === null ? -Infinity : new Date(lastReadAt).getTime();
    const unreadMsgs = realMsgs.filter(
      (m) =>
        m.user_id !== currentUserId &&
        new Date(m.created_at).getTime() > lastReadTime
    );
    const firstMsgId = unreadMsgs[0]?.id ?? null;
    const count = unreadMsgs.length;

    unreadAtOpenRef.current = { firstMsgId, count };
    // setSnapshotReady → re-render → divider element appears in DOM at the
    // correct position → Effect 2 fires and performs the initial scroll.
    setSnapshotReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessagesReady, lastReadAt, communityId, snapshotReady]);

  // ─── Effect 2: Initial scroll to unread boundary (layout effect) ─────────
  //
  // Using useIsomorphicLayoutEffect instead of useEffect ensures this runs
  // SYNCHRONOUSLY after the DOM is committed but BEFORE the browser paints.
  // Combined with the fast-path layout effect above, the sequence is:
  //
  //   Render N   → messages + divider committed to DOM
  //   Layout effect (fast-path) → snapshotReady = true  (re-render queued)
  //   Render N+1 → divider element present in DOM
  //   Layout effect (this one) → scrollTop set instantly
  //   Layout effect → initialPositionResolved = true  (re-render queued)
  //   Render N+2 → visibility:hidden lifted
  //   Browser paints → user sees correct position on first frame  ✓
  //
  // No requestAnimationFrame, no smooth scrolling — initial positioning is
  // always instant so there is never a visible jump.
  useIsomorphicLayoutEffect(() => {
    if (!snapshotReady) return;
    if (loading) return; // messages not in DOM yet; wait for loading to clear
    if (initialScrollDoneRef.current) return;

    initialScrollDoneRef.current = true;

    const container = scrollContainerRef.current;
    if (!container) {
      setInitialPositionResolved(true);
      return;
    }

    const isOverflowing = container.scrollHeight > container.clientHeight;

    if (!isOverflowing) {
      // Short chat: content fits entirely in the viewport. The inner wrapper's
      // `justify-end` already places messages at the bottom above the composer.
      // There is nothing to scroll — just reveal.
      setInitialPositionResolved(true);
      return;
    }

    const divider = unreadDividerRef.current;
    if (divider && unreadAtOpenRef.current?.firstMsgId) {
      // Position the unread divider ~80 px below the top of the viewport —
      // WhatsApp-style: the boundary is visible with a few read messages above
      // for context, and the first unread messages are immediately below.
      const dividerRect = divider.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const dividerTop = dividerRect.top - containerRect.top + container.scrollTop;
      container.scrollTop = Math.max(0, dividerTop - 80);
    } else {
      // No unread boundary — jump instantly to the very bottom.
      container.scrollTop = container.scrollHeight - container.clientHeight;
    }

    setInitialPositionResolved(true);
  }, [snapshotReady, loading, communityId]);

  // ─── Effect 3: Realtime auto-scroll ───────────────────────────────────────
  // Fires when a realtime INSERT has just been processed (flagged by the
  // subscription callback before calling setMessages).  Only scrolls if the
  // user was near the bottom at the moment the message arrived — never
  // interrupts someone reading history.  The unread snapshot is never touched.
  useEffect(() => {
    if (!initialScrollDoneRef.current) return;
    if (!realtimeInsertPendingRef.current) return;
    realtimeInsertPendingRef.current = false;

    if (realtimeWasNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    } else {
      setShowScrollToBottom(true);
    }
  }, [messages]);

  // ─── Show / hide scroll-to-bottom button on manual scroll ────────────────
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      const dist = container.scrollHeight - container.scrollTop - container.clientHeight;
      setShowScrollToBottom(dist > 80);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);


  // ─── Auto-focus input when chat opens / community changes ─────────────────
  useEffect(() => {
    inputRef.current?.focus();
  }, [communityId]);

  // ─── Redirect typing to input when focus is elsewhere ─────────────────────
  // If the user clicks outside the textarea and starts typing, capture the
  // keypress and redirect focus so characters land in the input — same as
  // WhatsApp Web. Only triggers for printable characters; ignores modifier
  // keys, shortcuts (Ctrl/Cmd/Alt), and other focusable elements (inputs etc).
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Already focused on the input — nothing to do.
      if (document.activeElement === inputRef.current) return;

      // Don't steal focus from other interactive elements (search boxes etc).
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (document.activeElement as HTMLElement)?.isContentEditable
      ) return;

      // Only act on printable characters, not modifier-only or function keys.
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;

      inputRef.current?.focus();
      // Do NOT preventDefault — the browser will naturally deliver the
      // character to the now-focused textarea via the subsequent keypress event.
    };

    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [communityId]);

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

          // Capture scroll position NOW — before setMessages changes the DOM.
          // Effect 3 reads these refs after the messages state update settles.
          if (initialScrollDoneRef.current) {
            const container = scrollContainerRef.current;
            if (container) {
              const dist =
                container.scrollHeight -
                container.scrollTop -
                container.clientHeight;
              realtimeWasNearBottomRef.current = dist < 100;
            } else {
              realtimeWasNearBottomRef.current = false;
            }
            realtimeInsertPendingRef.current = true;
          }

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

    // Polling disabled for testing.
    // const id = setInterval(poll, 5000);
    const id = 0 as unknown as ReturnType<typeof setInterval>;
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
        setHideUnreadDivider(true);
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
  const grouped = useMemo(() => messages.reduce<Group[]>((acc, msg) => {
    const date = fmtDate(msg.created_at);
    const last = acc[acc.length - 1];
    if (last?.date === date) last.messages.push(msg);
    else acc.push({ date, messages: [msg] });
    return acc;
  }, []), [messages]);

  // ─── Unread divider ───────────────────────────────────────────────────────
  // firstUnreadMsgId is frozen at open time so the divider position never
  // moves while you're reading. unreadDisplayCount is computed live from the
  // current message list so it grows correctly as new messages arrive via
  // realtime — without the double-counting bug that a setState-inside-updater
  // approach causes in React Strict Mode.
  const realMessages = useMemo(() => messages.filter((m) => !m.id.startsWith("temp-")), [messages]);
  const firstUnreadMsgId: string | null =
    snapshotReady && !hideUnreadDivider
      ? (unreadAtOpenRef.current?.firstMsgId ?? null)
      : null;
  const unreadDisplayCount = useMemo(() => {
    if (!snapshotReady || lastReadAt === undefined) return 0;
    return realMessages.filter(
      (m) =>
        m.user_id !== currentUserId &&
        (lastReadAt === null ||
          new Date(m.created_at).getTime() > new Date(lastReadAt).getTime())
    ).length;
  }, [snapshotReady, lastReadAt, realMessages, currentUserId]);

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
        <div className="flex-1 flex flex-col overflow-hidden relative">
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto" style={{backgroundImage:"radial-gradient(circle,rgba(255,255,255,0.03) 1px,transparent 1px)",backgroundSize:"24px 24px"}}>
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
              // Inner wrapper — two responsibilities:
              // 1. min-h-full + flex col + justify-end: short chats sit at the bottom
              //    above the composer without any fake spacer. Long chats overflow and
              //    the scroll container's overflow-y-auto takes over.
              // 2. visibility:hidden until initialPositionResolved: DOM exists so the
              //    layout effect can measure heights and set scrollTop before paint.
              //    Header, composer, and members panel stay visible throughout.
              <div
                className="min-h-full flex flex-col justify-end px-5 py-4 space-y-1"
                style={{ visibility: initialPositionResolved ? "visible" : "hidden" }}
              >
            {grouped.length === 0 && (
              <div className="flex flex-col items-center justify-center flex-1 gap-3 py-16">
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
                  const isFirstUnread = firstUnreadMsgId !== null && msg.id === firstUnreadMsgId;

                  // Unread divider — full-width rule with centred pill, like WhatsApp
                  const unreadDivider = isFirstUnread ? (
                    <div
                        ref={unreadDividerRef}
                        className="flex items-center gap-3 py-3 my-3 w-full"
                      >
                        <div className="flex-1 border-t border-border" />

                        <span
                          className="
                            rounded-full
                            border border-border
                            bg-surface-raised
                            px-3 py-1
                            font-body text-[11px] font-medium
                            text-foreground-muted
                            whitespace-nowrap
                            shadow-sm
                            select-none
                          "
                        >
                          {unreadDisplayCount > 0
                            ? `${unreadDisplayCount} unread message${
                                unreadDisplayCount !== 1 ? "s" : ""
                              }`
                            : "New messages"}
                        </span>

                        <div className="flex-1 border-t border-border" />
                    </div>
                  ) : null;

                  if (isMe) {
                    return (
                      <Fragment key={msg.id}>
                        {unreadDivider}
                        <div
                          className={`flex justify-end ${isSameAuthor && !isFirstUnread ? "mt-0.5" : "mt-3"}`}
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
                      </Fragment>
                    );
                  }

                  return (
                    <Fragment key={msg.id}>
                      {unreadDivider}
                      <div
                        className={`flex items-start gap-2 ${isSameAuthor && !isFirstUnread ? "mt-0.5" : "mt-3"}`}
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
                    </Fragment>
                  );
                })}
              </div>
            ))}
            <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* Scroll-to-bottom button — visible when user is scrolled up */}
          {showScrollToBottom && (
            <button
              onClick={() => {
                bottomRef.current?.scrollIntoView({ behavior: "smooth" });
              }}
              className="absolute bottom-[72px] right-4 z-10 h-8 w-8 flex items-center justify-center rounded-full bg-surface-raised shadow-lg border border-border text-foreground-muted hover:text-foreground transition-colors"
              aria-label="Scroll to bottom"
            >
              <ChevronDown size={16} />
            </button>
          )}

          {/* Floating Input */}
          <div className="px-4 pb-4 pt-2 shrink-0">
            {error && (
              <p className="font-body text-xs text-red-400 mb-2 pl-1">{error}</p>
            )}
            <div className="flex items-center gap-2 bg-surface-raised rounded-2xl shadow-md px-4 py-3 min-h-[56px]">
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
