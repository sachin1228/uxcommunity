"use client";

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import {
  msgCache,
  metaCache,
  msgFetchedAt,
  evictIfNeeded,
  META_STALE_MS,
  type CachedMessage,
  type CachedMeta,
} from "@/lib/communities/cache";
import {
  fetchAndHydrateCommunityBootstrap,
  fetchJsonCached,
  getCachedRequest,
  setCachedRequest,
} from "@/lib/request-cache";
import { communityMessagePageSearch } from "@/lib/communities/message-cursor";
import {
  compareCommunityMessages,
  createCatchUpController,
  mergeCommunityMessages,
  newestRealCursor,
  persistableMessages,
  type CatchUpController,
  type MessageCursor,
} from "@/lib/communities/messages";
import { chatKey } from "@uxcommunity/offline-chat";
import {
  OFFLINE_RESUME_EVENT,
  getOfflineChat,
  offlineRef,
  onOfflineChatChange,
} from "@/lib/offline/engine";
import {
  fromLocalCachedMessage,
  toLocalCachedMessage,
} from "@/lib/offline/rows";
import { logEvent } from "@/lib/observability/log";
import { newestChatMediaUrls } from "./mediaLayout";
import { warmChatMedia } from "./prefetchMedia";

/** Must match PAGE_SIZE in the messages API route. */
const PAGE_SIZE = 50;

/**
 * How long a page waits for its newest images to be measured before it is
 * committed. The measurements are what let the image bubbles mount at their
 * final size; past the bound, the page paints with 4:3 placeholders and each
 * image corrects itself once (see MessageBubble's BubbleImage), rather than
 * holding the room on a spinner for slow media.
 */
const INITIAL_MEDIA_WARM_MS = 650;
const OLDER_MEDIA_WARM_MS = 900;

/**
 * Ceiling on pages drained in one catch-up PASS — the same bound the DM chat
 * uses (MAX_CATCH_UP_PAGES). A reconnect after a long absence therefore applies
 * up to 20 pages of missed messages per pass instead of the newest 50 only.
 */
const MAX_CATCH_UP_PAGES = 20;

/**
 * Passes one trigger may run before the remainder is deferred to a scheduled
 * pass. Together with MAX_CATCH_UP_PAGES this caps one trigger's request count
 * (4 × 20 pages) while still draining a longer backlog without a new trigger.
 */
const MAX_CATCH_UP_PASSES_PER_DRAIN = 4;

/** Bounded transient-failure retries inside a single drain. */
const MAX_CATCH_UP_RETRIES = 2;

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Replace the rows the local store also knows about with its copy, keep any
 * optimistic bubble it has not confirmed, and preserve older paginated rows it
 * does not cache. This is how an outbox confirmation, a revalidation edit or a
 * delete reaches the screen without a refetch.
 */
function reconcileWithLocalWindow(
  current: Message[],
  local: Message[],
): Message[] {
  if (local.length === 0) return current;
  const localById = new Map(local.map((row) => [row.id, row]));
  const localNonces = new Set(
    local.map((row) => row.client_nonce).filter((nonce): nonce is string => !!nonce),
  );
  const seen = new Set<string>();
  const next: Message[] = [];

  for (const row of current) {
    // A temp bubble whose authoritative row is now local has been confirmed;
    // realtime/HTTP already removed it, or this is that removal.
    if (
      row.id.startsWith("temp-") &&
      row.client_nonce &&
      localNonces.has(row.client_nonce) &&
      !localById.has(row.id)
    ) {
      continue;
    }
    next.push(localById.get(row.id) ?? row);
    seen.add(row.id);
  }
  for (const row of local) {
    if (!seen.has(row.id)) next.push(row);
  }
  return next.sort(compareCommunityMessages);
}

export interface Community {
  id: string;
  name: string;
  type: string;
  member_count: number;
  image_url: string | null;
  description?: string | null;
  reference_name?: string | null;
  created_at?: string;
  is_private?: boolean;
  enabled_tabs?: string[];
  /** Absent on rows that predate the flag; reads as on. */
  showcase_enabled?: boolean | null;
  owner_id?: string | null;
  /** Carried through from CachedMeta["community"]; absent on sidebar fallbacks. */
  current_user_role?: CachedMeta["community"]["current_user_role"];
  current_user_permissions?: CachedMeta["community"]["current_user_permissions"];
  /** The caller's own mute state — drives the header menu (see lib/communities/mute). */
  notifications_muted?: boolean | null;
  notifications_muted_until?: string | null;
  /** An event group chat's own event date — its DP wears it as a badge, and the chat's watermark clock reads it. */
  event_date?: string | null;
  /** Its event's end while still ahead — what makes the badge say LIVE. */
  pinned_until?: string | null;
  /** That deadline whether ahead or past — what makes the badge say ENDED. */
  event_end?: string | null;
}

export interface Member {
  user_id: string;
  users: { name: string; avatar_url: string | null; designation?: string | null } | null;
}

type Message = CachedMessage;

/** Grouped reaction rows for the timeline's "created a …" cards. */
export interface ContentReactionRow {
  content_id: string;
  kind: string;
  reactions: Array<{ emoji: string; user_ids: string[] }>;
}

interface UseChatDataOptions {
  communityId: string;
  currentUserId: string;
  initialMeta?: CachedMeta;
  initialMessages?: CachedMessage[];
  /** Called once on mount if SSR provided a lastReadAt and no cached messages exist. */
  onSeedLastReadAt?: (val: string | null) => void;
  /** Called once hasMounted should be set to true (first layout effect). */
  onMounted?: () => void;
  /** Called when the initial hydration fails so completely that nothing could be rendered. */
  onLoadError?: (message: string) => void;
  /** Bump to re-run the mount hydration after a failure (retry). */
  retryToken?: number;
  /** Receives grouped notification-card reactions from each message page. */
  onContentReactions?: (rows: ContentReactionRow[]) => void;
}

export function useChatData({
  communityId,
  currentUserId,
  initialMeta,
  initialMessages,
  onSeedLastReadAt,
  onMounted,
  onLoadError,
  retryToken = 0,
  onContentReactions,
}: UseChatDataOptions) {
  const [community,           setCommunity]          = useState<Community | null>(null);
  const [members,             setMembers]            = useState<Member[]>([]);
  const [messages,            setMessages]           = useState<Message[]>([]);
  const [loading,             setLoading]            = useState(true);
  const [initialMessagesReady, setInitialMessagesReady] = useState(false);
  const [hasMoreAbove,        setHasMoreAbove]       = useState(true);
  const [loadingOlder,        setLoadingOlder]       = useState(false);

  const communityIdRef         = useRef(communityId);
  const membersRef             = useRef(members);
  const pendingProfileFetchRef = useRef<Map<string, Promise<void>>>(new Map());
  const isFetchingOlderRef     = useRef(false);

  useEffect(() => {
    membersRef.current = members;
  }, [members]);

  // ── Seed state from cache or SSR props before first paint ────────────────
  useIsomorphicLayoutEffect(() => {
    onMounted?.();
    const cachedMeta = metaCache.get(communityId);
    const cachedMsgs = msgCache.get(communityId);
    if (cachedMeta) {
      setCommunity(cachedMeta.community);
      setMembers(cachedMeta.members);
    } else if (initialMeta) {
      metaCache.set(communityId, { ...initialMeta, fetchedAt: Date.now() });
      setCachedRequest(
        `/api/communities/${communityId}`,
        { community: initialMeta.community, members: initialMeta.members },
        currentUserId,
      );
      setCommunity(initialMeta.community);
      setMembers(initialMeta.members);
    }
    if (cachedMsgs?.length) {
      setMessages(cachedMsgs);
    } else if (initialMessages?.length) {
      msgCache.set(communityId, initialMessages);
      setCachedRequest(
        `/api/communities/${communityId}/messages`,
        { messages: initialMessages },
        currentUserId,
      );
      msgFetchedAt.set(communityId, Date.now());
      evictIfNeeded();
      setMessages(initialMessages);
    }
    // Keep the chat area in its loading state (Lottie) until the first message
    // page is available — meta alone should not dismiss it, otherwise a fresh
    // visit flashes an empty chat while messages hydrate.
    if ((cachedMeta || initialMeta) && (cachedMsgs?.length || initialMessages?.length)) {
      setLoading(false);
    }
    // Notify parent of the SSR lastReadAt seed when no cache exists
    if (!cachedMsgs?.length) {
      onSeedLastReadAt?.(initialMessages?.length ? null : undefined as unknown as null);
    }
  }, []);

  // ── Fetch community metadata ──────────────────────────────────────────────
  const fetchMeta = useCallback(async () => {
    const targetId = communityId;
    await fetchAndHydrateCommunityBootstrap(targetId, currentUserId).catch(() => undefined);
    const d = await fetchJsonCached<{
      community: Community;
      members?: Member[];
    }>(`/api/communities/${targetId}`, { staleMs: META_STALE_MS }, currentUserId);
    if (communityIdRef.current !== targetId) return;
    const cached: CachedMeta = {
      community: d.community,
      members: d.members ?? [],
      fetchedAt: Date.now(),
    };
    metaCache.set(targetId, cached);
    setCommunity(d.community);
    setMembers(d.members ?? []);
  }, [communityId, currentUserId]);

  // ── Fetch messages (full or incremental via ?after=ISO) ───────────────────
  /**
   * One message page. `after` drains forward from a compound cursor; passing
   * null fetches the newest page. Returns the page so the drain can walk it.
   *
   * Cursors are `(created_at, id)` — see ./message-cursor.ts. The page itself is
   * NOT merged here: every caller merges through applyFetchedPage so all four
   * writers share one rule.
   */
  const fetchMessagePage = useCallback(
    async (after: MessageCursor | null, force: boolean): Promise<Message[]> => {
      const targetId = communityId;
      const url = `/api/communities/${targetId}/messages${communityMessagePageSearch(
        after ? { after } : {},
        { contentReactions: true },
      )}`;

      // Incremental (?after=) reads must NEVER be served from cache: the cache
      // can hold an older empty catch-up answer, which would drop the very
      // messages this fetch exists to find. `force` bypasses the stale window.
      const d = await fetchJsonCached<{
        messages?: Message[];
        content_reactions?: ContentReactionRow[];
      }>(url, { staleMs: after ? 0 : 3 * 60_000, force: after ? true : force }, currentUserId);
      if (d.content_reactions?.length) onContentReactions?.(d.content_reactions);
      return d.messages ?? [];
    },
    // onContentReactions is a stable useCallback in CommunityChat; keeping it
    // out avoids re-creating the fetch on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [communityId, currentUserId],
  );

  /**
   * Fold a fetched page into state and the message cache.
   *
   * mergeCommunityMessages is the single rule for every path: a row we already
   * hold wins, so messages realtime delivered while the request was in flight —
   * and the optimistic bubble of a send in progress — survive a page arriving
   * late. The cache only ever receives persistable (non-optimistic) rows, so a
   * remount cannot resurrect a "sending" bubble.
   */
  const applyFetchedPage = useCallback(
    (page: Message[]) => {
      const targetId = communityId;
      if (page.length === 0) return;
      setMessages((prev) => {
        if (communityIdRef.current !== targetId) return prev;
        const merged = mergeCommunityMessages(prev, page);
        if (merged === prev) return prev;
        msgCache.set(targetId, persistableMessages(merged));
        return merged;
      });
    },
    [communityId],
  );

  /**
   * The newest page — a first load, or a forced refresh after a failure. The
   * page is MERGED, never assigned: realtime messages that landed while this
   * request was in flight are newer than its snapshot and must not be dropped.
   */
  const fetchMessages = useCallback(
    async (force = false): Promise<void> => {
      const targetId = communityId;
      await fetchAndHydrateCommunityBootstrap(targetId, currentUserId).catch(() => undefined);
      const page = await fetchMessagePage(null, force).catch(() => null);
      if (page === null || communityIdRef.current !== targetId) return;
      // Measure the newest page's images before it paints. The bubble's frame
      // is already reservable from a cached ratio; this is what makes the first
      // paint of a fresh room final instead of widening/narrowing under the
      // reader as each image decodes.
      if (page.length) {
        await warmChatMedia(newestChatMediaUrls(page), INITIAL_MEDIA_WARM_MS);
      }
      if (communityIdRef.current !== targetId) return;
      applyFetchedPage(page);
      msgFetchedAt.set(targetId, Date.now());
      evictIfNeeded();
      // If we got fewer than a full page, there's nothing older to load.
      setHasMoreAbove(page.length >= PAGE_SIZE);
    },
    [communityId, currentUserId, fetchMessagePage, applyFetchedPage],
  );

  /**
   * Drain everything newer than `from` (or the newest page when there is no
   * cursor), one page at a time, until the history is confirmed drained.
   *
   * The community chat used to fetch ONE page per trigger, so a reconnect after
   * more than a page of missed messages left a permanent gap in the window. The
   * controller (createCatchUpController) runs a bounded pass, then continues from
   * the last confirmed compound cursor — either immediately (up to a pass cap)
   * or on a scheduled pass — so a long backlog drains without a new trigger, while
   * a single drain stays bounded, non-overlapping, and cancellable on a community
   * switch or unmount. Each pass's stop reason is reported (never discarded).
   */
  const catchUpControllerRef = useRef<CatchUpController | null>(null);
  const catchUpControllerCommunityRef = useRef<string | null>(null);

  /**
   * The catch-up controller for the current community, built on first use and
   * reused until the community changes. It is created inside a callback rather
   * than during render so it never reads a ref mid-render.
   */
  const getCatchUpController = useCallback((): CatchUpController => {
    if (
      catchUpControllerRef.current &&
      catchUpControllerCommunityRef.current === communityId
    ) {
      return catchUpControllerRef.current;
    }
    // The outgoing community's controller — and any pass it deferred — must not
    // paint into the incoming chat.
    catchUpControllerRef.current?.dispose();
    const targetId = communityId;
    const isCurrent = () => communityIdRef.current === targetId;
    const controller = createCatchUpController<Message>({
      pageSize: PAGE_SIZE,
      maxPagesPerPass: MAX_CATCH_UP_PAGES,
      maxPassesPerDrain: MAX_CATCH_UP_PASSES_PER_DRAIN,
      maxRetries: MAX_CATCH_UP_RETRIES,
      fetchPage: async (after) => (isCurrent() ? fetchMessagePage(after, true) : []),
      onPage: (page) => {
        if (!isCurrent()) return;
        applyFetchedPage(page);
      },
      isCancelled: () => !isCurrent(),
      // Stop reasons are reported, never discarded. Only ids/counts are logged
      // (see lib/observability/log): no message bodies, no tokens.
      onPass: (result) => {
        if (result.stoppedBy === "complete" || result.stoppedBy === "empty") return;
        logEvent(result.stoppedBy === "error" ? "warn" : "info", {
          event: "community.chat.catch_up",
          community_id: targetId,
          stop: result.stoppedBy,
          pages: result.pages,
          applied: result.applied,
          ...(result.error ? { error: result.error } : {}),
        });
      },
    });
    catchUpControllerRef.current = controller;
    catchUpControllerCommunityRef.current = communityId;
    return controller;
  }, [communityId, fetchMessagePage, applyFetchedPage]);

  // Unmount: stop any in-flight or deferred catch-up pass.
  useEffect(
    () => () => {
      catchUpControllerRef.current?.dispose();
      catchUpControllerRef.current = null;
      catchUpControllerCommunityRef.current = null;
    },
    [],
  );

  const catchUpMessages = useCallback(
    async (from: MessageCursor | null = null): Promise<void> => {
      await getCatchUpController().start(from);
    },
    [getCatchUpController],
  );

  // ── Fetch older messages (upward pagination via ?before=ISO) ────
  const fetchOlderMessages = useCallback(
    async (before: MessageCursor): Promise<void> => {
      if (isFetchingOlderRef.current) return;
      isFetchingOlderRef.current = true;
      setLoadingOlder(true);
      const targetId = communityId;
      try {
        const url = `/api/communities/${targetId}/messages${communityMessagePageSearch(
          { before },
          { contentReactions: true },
        )}`;
        const d = await fetchJsonCached<{
          messages?: Message[];
          content_reactions?: ContentReactionRow[];
        }>(url, { staleMs: 30_000 }, currentUserId);
        if (communityIdRef.current !== targetId) return;
        if (d.content_reactions?.length) onContentReactions?.(d.content_reactions);
        const incoming: Message[] = d.messages ?? [];
        if (incoming.length < PAGE_SIZE) setHasMoreAbove(false);
        if (incoming.length === 0) return;
        // The prepended page's newest rows sit directly above the current
        // viewport; measure their images (and only those — warming all 50 rows
        // would download history the reader may never reach) so the append
        // does not resize the list under the reader.
        await warmChatMedia(newestChatMediaUrls(incoming), OLDER_MEDIA_WARM_MS);
        if (communityIdRef.current !== targetId) return;
        applyFetchedPage(incoming);
      } catch {
        // Network error — leave state as-is
      } finally {
        isFetchingOlderRef.current = false;
        setLoadingOlder(false);
      }
    },
    // onContentReactions is a stable useCallback in CommunityChat; keeping it
    // out avoids re-creating fetchOlderMessages on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [communityId, currentUserId, applyFetchedPage],
  );

  // ── On communityId change: show cache instantly, then hydrate once ────────
  useEffect(() => {
    communityIdRef.current = communityId;
    setInitialMessagesReady(false);
    setHasMoreAbove(true);
    isFetchingOlderRef.current = false;
    let cancelled = false;

    // Reactions for the timeline's notification cards ride on the message-page
    // response; the SSR/bootstrap-seeded cached entries carry them too, so
    // replay them for the freshly mounted community.
    const replayCachedContentReactions = () => {
      const cached = getCachedRequest<{ content_reactions?: ContentReactionRow[] }>(
        `/api/communities/${communityId}/messages`,
        currentUserId,
      );
      if (cached?.content_reactions?.length) {
        onContentReactions?.(cached.content_reactions);
      }
    };
    replayCachedContentReactions();

    const applyCanonicalCache = () => {
      const canonicalMessages = getCachedRequest<{ messages?: Message[] }>(
        `/api/communities/${communityId}/messages`,
        currentUserId,
      )?.messages;
      const canonicalMeta = getCachedRequest<{
        community: Community;
        members?: Member[];
      }>(`/api/communities/${communityId}`, currentUserId);
      const cachedMsgs = msgCache.get(communityId) ?? canonicalMessages;
      const cachedMeta = metaCache.get(communityId) ?? (canonicalMeta
        ? {
            community: canonicalMeta.community,
            members: canonicalMeta.members ?? [],
            fetchedAt: Date.now(),
          }
        : undefined);

      if (cachedMsgs) {
        msgCache.set(communityId, cachedMsgs);
        msgFetchedAt.set(communityId, Date.now());
        setMessages(cachedMsgs);
        setHasMoreAbove(cachedMsgs.length >= PAGE_SIZE);
      } else {
        setMessages([]);
      }
      if (cachedMeta) {
        metaCache.set(communityId, cachedMeta);
        setCommunity(cachedMeta.community);
        setMembers(cachedMeta.members);
        // Don't dismiss the chat Lottie on meta alone — wait for the message
        // page too. On revisits msgCache provides it instantly; on a fresh
        // visit the bootstrap hydration below clears it.
        if (cachedMsgs) setLoading(false);
      } else {
        setLoading(true);
      }
      return { cachedMeta, cachedMsgs };
    };

    const initial = applyCanonicalCache();

    (async () => {
      const bootstrapResult = await fetchAndHydrateCommunityBootstrap(
        communityId,
        currentUserId,
      ).then(() => true).catch(() => false);
      if (cancelled || communityIdRef.current !== communityId) return;

      const hydrated = applyCanonicalCache();
      if (!bootstrapResult) {
        await Promise.allSettled([
          hydrated.cachedMsgs ? Promise.resolve() : fetchMessages(),
          hydrated.cachedMeta ? Promise.resolve() : fetchMeta(),
        ]);
      } else if (!hydrated.cachedMeta || !hydrated.cachedMsgs) {
        await Promise.allSettled([
          hydrated.cachedMsgs ? Promise.resolve() : fetchMessages(),
          hydrated.cachedMeta ? Promise.resolve() : fetchMeta(),
        ]);
      }

      if (!cancelled) {
        setLoading(false);
        setInitialMessagesReady(true);
      }

      // A network failure used to be swallowed and rendered as the "Be the
      // first to say something" empty state — indistinguishable from a
      // healthy but message-less community. When NOTHING was hydrated (no
      // meta, no message page), surface an explicit error the user can retry.
      // A genuinely empty community still caches its empty message page, so
      // msgCache.has(...) is true and this stays silent for it.
      if (
        !cancelled &&
        communityIdRef.current === communityId &&
        !metaCache.has(communityId) &&
        !msgCache.has(communityId)
      ) {
        onLoadError?.(
          "Couldn't load this community's chat. Check your connection and try again."
        );
      }

      // Incremental catch-up for messages that landed while the user was in
      // another community. The sidebar keeps this community's chat socket
      // alive, so no reconnect fires when they switch back — without this the
      // window would show stale history until the next focus event.
      //
      // A client that holds NO message yet needs no drain: the bootstrap or the
      // first-page fetch above has just delivered the newest page, which is the
      // only page a cursor-less catch-up could return. Skipping it there saves a
      // duplicate request per first visit.
      if (!cancelled && communityIdRef.current === communityId) {
        const from = newestRealCursor(msgCache.get(communityId) ?? []);
        if (from) void catchUpMessages(from).catch(() => undefined);
      }
    })();

    if (!initial.cachedMeta) setLoading(true);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, retryToken]);

  // ── Offline layer: local-first paint, live reconciliation, durable writes ──
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const ref = offlineRef("community", communityId);
    const key = chatKey(ref);
    let active = true;
    let unsubscribeEvents: (() => void) | null = null;

    const attach = (engine: ReturnType<typeof getOfflineChat>) => {
      unsubscribeEvents?.();
      unsubscribeEvents = null;
      if (!active || !engine) return;

      unsubscribeEvents = engine.subscribe((event) => {
        if (event.type !== "messages" || event.conversationKey !== key) return;
        const local = event.messages.map(fromLocalCachedMessage);
        setMessages((prev) => {
          if (communityIdRef.current !== communityId) return prev;
          const next = reconcileWithLocalWindow(prev, local);
          msgCache.set(communityId, persistableMessages(next));
          return next;
        });
      });

      // Paint the persisted window immediately — before the bootstrap/page
      // request — so a cold start (including a fully offline one) shows the
      // conversation instead of a spinner. If a live window is already on
      // screen, leave it alone: the disk copy may predate a realtime event.
      if (msgCache.get(communityId)?.length) return;
      void engine
        .hydrate(ref)
        .then((rows) => {
          if (!active || rows.length === 0 || communityIdRef.current !== communityId) return;
          const local = rows.map(fromLocalCachedMessage);
          setMessages((prev) =>
            prev.length ? reconcileWithLocalWindow(prev, local) : local,
          );
          msgCache.set(communityId, persistableMessages(local));
          msgFetchedAt.set(communityId, Date.now());
          setHasMoreAbove(local.length >= PAGE_SIZE);
          setLoading(false);
        })
        .catch(() => undefined);
    };

    const unsubscribeChange = onOfflineChatChange(attach);
    return () => {
      active = false;
      unsubscribeChange();
      unsubscribeEvents?.();
    };
  }, [communityId, currentUserId]);

  /**
   * Write-through: every loaded/realtime/edited row goes to IndexedDB after a
   * short debounce. The write is a bounded window (the controller drops
   * optimistic rows, which the outbox owns), so a busy room does not serialize
   * its whole history on each event.
   */
  useEffect(() => {
    if (!currentUserId || messages.length === 0) return undefined;
    if (communityIdRef.current !== communityId) return undefined;
    const timer = setTimeout(() => {
      const engine = getOfflineChat();
      if (!engine) return;
      const ref = offlineRef("community", communityId);
      const rows = messages.map((row) =>
        toLocalCachedMessage(currentUserId, ref, row),
      );
      void engine.persistWindow(ref, rows).catch(() => undefined);
    }, 400);
    return () => clearTimeout(timer);
  }, [messages, communityId, currentUserId]);

  // Connectivity returned: re-read the visible window so edits/deletes and
  // reactions applied while this device was offline become visible, then send
  // anything queued. The existing realtime reconnect path still owns the
  // missed-message catch-up (no second cursor loop).
  useEffect(() => {
    const onResume = () => {
      const engine = getOfflineChat();
      if (!engine) return;
      const ref = offlineRef("community", communityId);
      void engine.revalidateWindow(ref).catch(() => undefined);
      void engine.drainOutbox().catch(() => undefined);
    };
    window.addEventListener(OFFLINE_RESUME_EVENT, onResume);
    return () => window.removeEventListener(OFFLINE_RESUME_EVENT, onResume);
  }, [communityId]);

  return {
    community,
    setCommunity,
    members,
    messages,
    loading,
    initialMessagesReady,
    hasMoreAbove,
    loadingOlder,
    setMessages,
    fetchMessages,
    catchUpMessages,
    fetchOlderMessages,
    communityIdRef,
    membersRef,
    pendingProfileFetchRef,
  };
}
