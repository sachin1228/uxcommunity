"use client";

import { useState, useInsertionEffect, useLayoutEffect, useEffect, useCallback, useMemo, useRef } from "react";
import { usePathname } from "next/navigation";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { AtSign, ChevronDown } from "lucide-react";
import {
  applyReactionDelete,
  applyReactionInsert,
  markSidebarReactionRemoved,
  patchSidebarReaction,
  sidebarStore,
  metaCache,
  msgCache,
  msgFetchedAt,
  patchSidebarMessageContent,
} from "@/lib/communities/cache";
import type { CachedMessage, CachedMeta, CachedThreadEvent, MessageMention, MessageReaction, ReplyPreview } from "@/lib/communities/cache";
import {
  clearReactionIntentsForCommunity,
  ReactionIntentCoordinator,
  trackReactionIntent,
  type ReactionIntent,
} from "@/lib/reaction-intent-coordinator";
import { fmtDate } from "./chat/chatUtils";
import { ChatHeader, type ChatTab } from "./chat/ChatHeader";

import { ChatInput } from "./chat/ChatInput";
import type { MentionCandidate } from "@/lib/communities/mentions";
import { MessageList } from "./chat/MessageList";
import { ImageLightbox, type LightboxImage } from "./chat/ImageLightbox";
import { MessageEditModal } from "./chat/MessageEditModal";
import { ThreadsView } from "./threads/ThreadsView";
import type { CommunityThread } from "./threads/types";
import { EventsView } from "./events/EventsView";
import { ResourcesView } from "./resources/ResourcesView";
import { MembersView } from "./members/MembersView";
import { ShowcaseView } from "./showcase/ShowcaseView";
import { CommunitySettingsView } from "./CommunitySettingsView";
import { Modal } from "@/components/ui/Modal";
import { useChatData } from "./chat/useChatData";
import { useScrollAndUnread } from "./chat/useScrollAndUnread";
import { useRealtimeChat } from "./chat/useRealtimeChat";
import { useSendMessage } from "./chat/useSendMessage";
import { useTypingPresence } from "./chat/useTypingPresence";
import { useOnlinePresence } from "./chat/useOnlinePresence";
import { useMemberMentions } from "./chat/useMemberMentions";
import { TypingIndicator } from "./chat/TypingIndicator";
import { extractFirstUrl } from "@/lib/communities/linkPreview";
import {
  fetchAndHydrateCommunityBootstrap,
  fetchJsonCached,
  getCachedRequest,
  initRequestCache,
  setCachedRequest,
  type CommunityBootstrap,
} from "@/lib/request-cache";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";
import type { SSRCommunitySections } from "@/lib/communities/server";

/** Server notification rows relevant to seeding the pending-mention pill. */
interface MentionNotificationRow {
  id: string;
  type: string;
  href: string;
  read_at: string | null;
  created_at: string;
}

/** Pull { communityId, messageId } out of a chat_mention notification href. */
function mentionTargetFromHref(
  href: string,
): { communityId: string; messageId: string } | null {
  const match =
    /^\/dashboard\/communities\/([\w-]+)#msg-([\w-]+)$/.exec(href);
  return match ? { communityId: match[1], messageId: match[2] } : null;
}

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface DateGroup {
  date: string;
  messages: CachedMessage[];
}

export function CommunityChat({
  communityId,
  currentUserId,
  currentUserName,
  initialMeta,
  initialMessages,
  initialLastReadAt,
  initialSections,
  initialTab = "chat",
}: {
  communityId: string;
  currentUserId: string;
  currentUserName: string;
  initialMeta?: CachedMeta;
  initialMessages?: CachedMessage[];
  initialLastReadAt?: string | null;
  initialSections?: SSRCommunitySections;
  initialTab?: ChatTab;
}) {
  const pathname = usePathname();
  const router = useGuardedRouter();
  const [hasMounted, setHasMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<ChatTab>(initialTab);
  const [showSettings, setShowSettings] = useState(false);
  const [threadEvents, setThreadEvents] = useState<CachedThreadEvent[]>([]);
  /** True once the initial threads fetch for the current community has settled. */
  const [threadsReady, setThreadsReady] = useState(false);
  useIsomorphicLayoutEffect(() => { setHasMounted(true); }, []);

  // Seed every first-page endpoint before child passive effects run. This keeps
  // tab mounts cache-only while preserving API reads for pagination and realtime.
  useInsertionEffect(() => {
    initRequestCache(currentUserId);
    if (!initialSections) return;
    const base = `/api/communities/${communityId}`;
    const urls: Array<[string, unknown]> = [
      [`${base}/threads`, initialSections.threads],
      [`${base}/events`, initialSections.events],
      [`${base}/resources`, initialSections.resources],
      [`${base}/showcase`, initialSections.showcase],
      [`${base}/members?page=0`, initialSections.members],
      [`${base}/rules`, initialSections.rules],
    ];
    for (const [url, value] of urls) {
      if (value !== undefined) setCachedRequest(url, value, currentUserId);
    }

    // When the SSR snapshot already carries the community read model and first
    // message page, mirror it into the bootstrap cache entry as well. Otherwise
    // every downstream bootstrap-backed read (chat data, info panel, tab views)
    // fires a fresh network GET /bootstrap even though the page already seeded
    // everything it needs.
    if (initialMeta && initialMessages) {
      const bootstrap: CommunityBootstrap = {
        community: {
          community: initialMeta.community,
          members: initialMeta.members,
        },
        messages: { messages: initialMessages },
        permissions: undefined,
        unreadCount: 0,
        failures: [],
      };
      setCachedRequest(`${base}/bootstrap`, bootstrap, currentUserId);
    }
  }, [communityId, currentUserId, initialSections, initialMeta, initialMessages]);

  const handleTabChange = useCallback((tab: ChatTab) => {
    setActiveTab(tab);
    const params = new URLSearchParams();
    if (tab !== "chat") params.set("tab", tab);
    const qs = params.toString();

    // Tabs are local views of the same mounted community page. Updating the
    // URL with the History API keeps links shareable without requesting a new
    // RSC payload, rerunning the page, or resetting chat state.
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }, [pathname]);

  const handleThreadCreated = useCallback((thread: CommunityThread) => {
    setThreadEvents((prev) => {
      if (prev.some((event) => event.id === thread.id)) return prev;
      const event: CachedThreadEvent = {
        id: thread.id,
        community_id: thread.community_id,
        user_id: thread.user_id,
        title: thread.title,
        category: thread.category,
        attachments: thread.attachments ?? [],
        created_at: thread.created_at,
        users: thread.users,
      };
      return [...prev, event].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
    });
  }, []);

  // Prime only first-render data. Secondary tabs fetch from their own cached
  // endpoints when mounted, so their work cannot delay the chat shell.
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setThreadEvents([]);
        setThreadsReady(false);
      }
    });
    initRequestCache(currentUserId);

    // A server-rendered snapshot is authoritative for this navigation. Seed
    // the shared client caches and avoid immediately requesting the same page
    // data again after hydration.
    if (initialMeta && initialMessages) {
      const fetchedAt = Date.now();
      metaCache.set(communityId, { ...initialMeta, fetchedAt });
      msgCache.set(communityId, initialMessages);
      msgFetchedAt.set(communityId, fetchedAt);
      queueMicrotask(() => {
        if (!cancelled) setThreadsReady(true);
      });
      return () => { cancelled = true; };
    }

    void fetchAndHydrateCommunityBootstrap(communityId, currentUserId)
      .then((data) => {
        if (cancelled) return;
        const communityData = data.community as {
          community: CachedMeta["community"];
          members: CachedMeta["members"];
        };
        const messageData = data.messages as { messages: CachedMessage[] };
        const fetchedAt = Date.now();

        metaCache.set(communityId, {
          community: communityData.community,
          members: communityData.members,
          fetchedAt,
        });
        msgCache.set(communityId, messageData.messages ?? []);
        msgFetchedAt.set(communityId, fetchedAt);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setThreadsReady(true);
      });

    return () => { cancelled = true; };
  }, [communityId, currentUserId, initialMessages, initialMeta]);

  // ── Highlighted message state (scroll-to-reply) — handler defined after scrollContainerRef ──
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Messages that mentioned the user and are awaiting a jump — newest first.
   * Entries are tagged with their community so the queue survives community
   * switches within the session (each chat shows only its own entries). */
  const [pendingMentions, setPendingMentions] = useState<
    Array<{ communityId: string; messageId: string; createdAt: string }>
  >([]);

  const addPendingMention = useCallback(
    (targetCommunityId: string, messageId: string, createdAt?: string) => {
      setPendingMentions((prev) => {
        if (
          prev.some(
            (m) =>
              m.communityId === targetCommunityId && m.messageId === messageId,
          )
        ) {
          return prev;
        }
        const next = [
          ...prev,
          {
            communityId: targetCommunityId,
            messageId,
            createdAt: createdAt ?? new Date().toISOString(),
          },
        ];
        next.sort((a, b) =>
          a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
        );
        return next;
      });
    },
    [],
  );

  // ── Reply state ───────────────────────────────────────────────────────────
  const [replyTo, setReplyTo] = useState<ReplyPreview | null>(null);
  const [editingMessage, setEditingMessage] = useState<CachedMessage | null>(null);
  const [editingSaving, setEditingSaving] = useState(false);
  const handleReply = useCallback((msg: CachedMessage) => {
    setReplyTo({
      id:        msg.id,
      content:   msg.content || (msg.image_url ? "📷 Image" : ""),
      user_name: msg.users?.name ?? "Unknown",
    });
    // Focus input after setting reply
    setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>("[data-chat-input]")?.focus();
    }, 50);
  }, []);
  const handleClearReply = useCallback(() => setReplyTo(null), []);

  const handleCopy = useCallback((msg: CachedMessage) => {
    navigator.clipboard.writeText(msg.content).catch(() => {});
  }, []);

  // ── Data fetching + message state ─────────────────────────────────────────
  const {
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
    fetchOlderMessages,
    communityIdRef,
    membersRef,
    pendingProfileFetchRef,
  } = useChatData({ communityId, currentUserId, initialMeta, initialMessages });

  const handleReactionToggled = useCallback(
    (msgId: string, reactions: MessageReaction[]) => {
      setMessages((prev) => {
        const next = prev.map((m) => m.id === msgId ? { ...m, reactions } : m);
        msgCache.set(communityId, next);
        return next;
      });
    },
    [communityId, setMessages]
  );

  const reactionCoordinatorsRef = useRef(
    new Map<string, ReactionIntentCoordinator<MessageReaction[]>>(),
  );

  const projectOwnReaction = useCallback(
    (reactions: MessageReaction[], desiredEmoji: ReactionIntent) => {
      const currentEmoji = reactions.find((reaction) =>
        reaction.user_ids.includes(currentUserId),
      )?.emoji;
      const withoutCurrent = currentEmoji
        ? applyReactionDelete(reactions, currentEmoji, currentUserId)
        : reactions;
      return desiredEmoji
        ? applyReactionInsert(withoutCurrent, desiredEmoji, currentUserId)
        : withoutCurrent;
    },
    [currentUserId],
  );

  useEffect(() => {
    const coordinators = reactionCoordinatorsRef.current;
    return () => {
      for (const coordinator of coordinators.values()) coordinator.dispose();
      coordinators.clear();
      clearReactionIntentsForCommunity(communityId);
    };
  }, [communityId]);

  // ── Inline hover reaction handler ─────────────────────────────────────────
  const handleReaction = useCallback(
    (msgId: string, emoji: string) => {
      const message = msgCache.get(communityId)?.find((item) => item.id === msgId);
      if (!message) return;

      let coordinator = reactionCoordinatorsRef.current.get(msgId);
      if (!coordinator) {
        const initialEmoji = message.reactions?.find((reaction) =>
          reaction.user_ids.includes(currentUserId),
        )?.emoji ?? null;
        const messagePreview = message.content
          ? `"${message.content.slice(0, 40)}${message.content.length > 40 ? "…" : ""}"`
          : message.image_url
            ? "📷 Photo"
            : "a message";

        const paintIntent = (desiredEmoji: ReactionIntent) => {
          const latest = msgCache.get(communityId)?.find((item) => item.id === msgId);
          if (latest) {
            handleReactionToggled(
              msgId,
              projectOwnReaction(latest.reactions ?? [], desiredEmoji),
            );
          }
          if (desiredEmoji === null) markSidebarReactionRemoved(communityId, msgId);
          patchSidebarReaction(
            communityId,
            desiredEmoji === null
              ? null
              : {
                  messageId: msgId,
                  emoji: desiredEmoji,
                  createdAt: new Date().toISOString(),
                  firstName: "You",
                  isOwn: true,
                  messagePreview,
                },
          );
        };

        coordinator = new ReactionIntentCoordinator<MessageReaction[]>({
          initialValue: initialEmoji,
          onOptimisticChange: paintIntent,
          onIntentChange: (value, pending) => {
            trackReactionIntent(communityId, msgId, currentUserId, value, pending);
          },
          persist: async (desiredEmoji) => {
            const res = await fetch(
              `/api/communities/${communityId}/messages/${msgId}/reactions`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ desiredEmoji }),
              },
            );
            if (!res.ok) throw new Error("Unable to update reaction");
            const data = await res.json() as {
              reactions: MessageReaction[];
              currentUserEmoji: ReactionIntent;
            };
            return { value: data.currentUserEmoji, data: data.reactions };
          },
          onConfirmed: ({ value, data }) => {
            handleReactionToggled(msgId, data);
            paintIntent(value);
          },
        });
        reactionCoordinatorsRef.current.set(msgId, coordinator);
      }

      coordinator.toggle(emoji);
    },
    [communityId, currentUserId, handleReactionToggled, projectOwnReaction],
  );

  // ── Top-sentinel ref — observed by IntersectionObserver to load older messages.
  const topSentinelRef   = useRef<HTMLDivElement>(null);
  /** Always points to the latest load-older logic; never stale inside event handlers. */
  const loadOlderCallbackRef = useRef<(() => void) | null>(null);

  // Keep the callback ref current on every render (no deps needed).
  useEffect(() => {
    loadOlderCallbackRef.current = () => {
      const oldest = messages.find((m) => !m.id.startsWith("temp-"));
      if (!oldest || !hasMoreAbove || loadingOlder) return;
      fetchOlderMessages(oldest.created_at);
    };
  });

  // ── Scroll preservation for changes above the viewport ────────────────────
  // Anything that changes height *above* the messages the user is looking at
  // (older pages being prepended, the load-older slot disappearing once the
  // history is exhausted) must be compensated for so the visible messages stay
  // exactly where they are — the way WhatsApp behaves.
  //
  // Implementation: we use the oldest *real* message as a scroll anchor. After
  // every commit we record that element's offset from the top of the scroll
  // content (independent of the current scrollTop). On the next commit, if the
  // same element is still in the DOM, any change in that offset is exactly the
  // amount of height that was inserted or removed above it — older messages,
  // the load-older slot, a date pill that became a real boundary, a thread
  // notification — so we add it to scrollTop before paint. Because we measure
  // the anchor rather than the total scrollHeight, height changes *below* the
  // anchor (images loading, reactions, thread events arriving) can never leak
  // into the correction. Browser scroll anchoring is disabled on the container
  // so the two mechanisms can't fight each other.
  const oldestRealMsgId = useMemo(
    () => messages.find((m) => !m.id.startsWith("temp-"))?.id ?? null,
    [messages],
  );
  const scrollAnchorRef = useRef<{
    id: string;
    /** Anchor top relative to the scroll content origin (scrollTop-independent). */
    offset: number;
  } | null>(null);

  const measureAnchorOffset = (container: HTMLElement, id: string): number | null => {
    const el = container.querySelector<HTMLElement>(
      `[data-message-id="${id}"]`,
    );
    if (!el) return null;
    return (
      el.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop
    );
  };

  // A community switch starts from a clean slate so the first paint of the new
  // chat is never treated as a "prepend" onto the previous one. Declared before
  // the compensation effect so it runs first within the same commit.
  useIsomorphicLayoutEffect(() => {
    scrollAnchorRef.current = null;
  }, [communityId]);

  // No dependency array on purpose: any commit can change what sits above the
  // anchor (messages, hasMoreAbove, threadEvents, unread divider…), and a
  // single querySelector + two getBoundingClientRect calls per commit is cheap.
  useIsomorphicLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // While the initial position is still being resolved the list is hidden
    // and useScrollAndUnread owns scrollTop — don't compete with it.
    if (initialPositionResolved) {
      const prev = scrollAnchorRef.current;
      if (prev) {
        const newOffset = measureAnchorOffset(container, prev.id);
        if (newOffset !== null) {
          const delta = newOffset - prev.offset;
          if (delta !== 0) container.scrollTop += delta;
        }
      }
    }

    // Re-anchor on the (possibly new) oldest real message.
    if (oldestRealMsgId) {
      const offset = measureAnchorOffset(container, oldestRealMsgId);
      scrollAnchorRef.current = offset === null ? null : { id: oldestRealMsgId, offset };
    } else {
      scrollAnchorRef.current = null;
    }
  });

  // The anchor's stored offset must also track height changes that happen
  // *without* a React commit (e.g. an avatar or image above it finishing its
  // load). A ResizeObserver on the list content refreshes the snapshot so a
  // later prepend never applies a stale delta.
  useEffect(() => {
    const container = scrollContainerRef.current;
    const content = container?.firstElementChild;
    if (!container || !content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const anchor = scrollAnchorRef.current;
      if (!anchor) return;
      const offset = measureAnchorOffset(container, anchor.id);
      if (offset !== null) anchor.offset = offset;
    });
    ro.observe(content);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, loading]);

  // IntersectionObserver-based trigger: starts loading older messages before
  // the user reaches the top by using a 300 px rootMargin.  Including
  // `loading` and `loadingOlder` in the deps ensures the observer is
  // (re-)created once the initial load finishes and the sentinel first
  // appears in the DOM, and again after each older-page fetch completes.
  // Stops observing automatically once hasMoreAbove becomes false.
  useEffect(() => {
    if (!hasMoreAbove) return;

    const sentinel = topSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadOlderCallbackRef.current?.();
        }
      },
      {
        root: scrollContainerRef.current,
        // Fire 300 px before the sentinel reaches the viewport top so
        // older messages start loading well before the user gets there.
        rootMargin: "300px 0px 0px 0px",
        threshold: 0,
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
    // scrollContainerRef is a stable ref — safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMoreAbove, loadingOlder, loading]);

  const handleDelete = useCallback(async (msgId: string) => {
    // Optimistic update: mark as deleted locally immediately
    setMessages((prev) => {
      const next = prev.map((m) =>
        m.id === msgId
          ? { ...m, deleted_at: new Date().toISOString(), content: "", image_url: null, reply_to: null, reactions: [] }
          : m
      );
      msgCache.set(communityId, next);
      return next;
    });

    try {
      const res = await fetch(`/api/communities/${communityId}/messages/${msgId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        // Rollback on failure — refetch to restore correct state
        fetchMessages();
      }
    } catch {
      fetchMessages();
    }
  }, [communityId, fetchMessages, setMessages]);

  const currentUserMember = members.find((member) => member.user_id === currentUserId);
  const resolvedUserName = currentUserMember?.users?.name ?? currentUserName ?? "Someone";
  const currentUserAvatar = currentUserMember?.users?.avatar_url ?? null;
  const { typingUsers, setTyping } = useTypingPresence({
    communityId,
    currentUserId,
    currentUserName: resolvedUserName,
  });

  const { onlineCount } = useOnlinePresence({ communityId, currentUserId });

  // ── Scroll positioning + unread boundary ──────────────────────────────────
  const {
    bottomRef,
    scrollContainerRef,
    unreadDividerRef,
    initialScrollDoneRef,
    realtimeInsertPendingRef,
    realtimeWasNearBottomRef,
    showScrollToBottom,
    initialPositionResolved,
    firstUnreadMsgId,
    unreadDisplayCount,
    setHideUnreadDivider,
  } = useScrollAndUnread({
    communityId,
    currentUserId,
    messages,
    loading,
    initialMessagesReady,
    initialLastReadAtFromSSR: initialLastReadAt,
  });

  // ── Row focus flash — shared by reply clicks and @ pill jumps ────────────
  const flashMessage = useCallback(
    (messageId: string, durationMs: number): boolean => {
      const el = scrollContainerRef.current?.querySelector<HTMLElement>(
        `[data-message-id="${messageId}"]`,
      );
      if (!el) return false;
      el.scrollIntoView({ behavior: "instant", block: "center" });
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      setHighlightedMsgId(messageId);
      highlightTimerRef.current = setTimeout(
        () => setHighlightedMsgId(null),
        durationMs,
      );
      return true;
    },
    [scrollContainerRef],
  );

  // ── Scroll-to-reply handler (needs scrollContainerRef from above) ─────────
  const handleReplyClick = useCallback(
    (replyId: string) => {
      flashMessage(replyId, 1500);
    },
    [flashMessage],
  );

  // ── Pending @mention jumps (the "@" pill) ─────────────────────────────────
  // The pill lists messages that mentioned the user and are still awaiting a
  // jump. It is fed by three channels:
  //   1. the #msg-<id> hash the bell navigates with (land WITHOUT auto-scroll;
  //      the user taps the @ pill when ready),
  //   2. unread chat_mention notifications for the current user,
  //   3. live chat_mention notifications while the chat is open.
  //
  // The URL hash is the only channel between the NotificationBell (dashboard
  // shell) and this page, so it is tracked through every route to it: Next
  // <Link> updates the hash with history.pushState — which does NOT fire a
  // hashchange event — so a light interval is the reliable catch-all (manual
  // edits and back/forward fire hashchange/popstate and update instantly).
  useEffect(() => {
    const consumeHash = () => {
      const match = /^#msg-([\w-]+)$/.exec(window.location.hash);
      if (!match) return;
      addPendingMention(communityId, match[1]);
      const url = new URL(window.location.href);
      url.hash = "";
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    };
    window.addEventListener("hashchange", consumeHash);
    window.addEventListener("popstate", consumeHash);
    const timer = window.setInterval(consumeHash, 400);
    return () => {
      window.removeEventListener("hashchange", consumeHash);
      window.removeEventListener("popstate", consumeHash);
      window.clearInterval(timer);
    };
  }, [addPendingMention, communityId]);

  // Seed: unread chat_mention notifications (cached list first — paints
  // instantly — then a fresh read catches stragglers in the background).
  useEffect(() => {
    let cancelled = false;
    const apply = (items?: MentionNotificationRow[]) => {
      if (!items || cancelled) return;
      for (const item of items) {
        if (item.type !== "chat_mention" || item.read_at) continue;
        const target = mentionTargetFromHref(item.href);
        if (target) addPendingMention(target.communityId, target.messageId, item.created_at);
      }
    };
    // A macrotask keeps the cached seed out of the effect body proper.
    const seedTimer = window.setTimeout(() => {
      apply(
        getCachedRequest<{ notifications?: MentionNotificationRow[] }>(
          "/api/notifications",
          currentUserId,
        )?.notifications,
      );
    }, 0);
    void fetchJsonCached<{ notifications?: MentionNotificationRow[] }>(
      "/api/notifications",
      { staleMs: 30_000 },
      currentUserId,
    )
      .then((data) => apply(data?.notifications))
      .catch(() => {});
    return () => {
      cancelled = true;
      window.clearTimeout(seedTimer);
    };
  }, [addPendingMention, currentUserId]);

  // Live mentions: the server publishes a chat_mention notification row the
  // moment someone mentions the user, so the pill grows without a refetch.
  useEffect(() => {
    const room = realtimeRooms.notifications(currentUserId);
    const unsubRoom = realtimeClient.subscribe(room);
    const unsub = realtimeClient.on(room, "insert", (data) => {
      const next = data as MentionNotificationRow;
      if (!next || next.type !== "chat_mention") return;
      const target = mentionTargetFromHref(next.href);
      if (target) addPendingMention(target.communityId, target.messageId, next.created_at);
    });
    return () => {
      unsub();
      unsubRoom();
    };
  }, [addPendingMention, currentUserId]);

  /** Mentions awaiting a jump inside THIS community — newest first. */
  const visiblePendingMentions = useMemo(
    () => pendingMentions.filter((m) => m.communityId === communityId),
    [communityId, pendingMentions],
  );

  /** Jump to the newest pending mention (newest → oldest on repeated taps). */
  const jumpToPendingMention = useCallback(() => {
    const target = visiblePendingMentions[0];
    if (!target) return;
    // Only consume when the row is actually in the loaded window — otherwise
    // the pill stays so the user can tap again after the message loads.
    if (flashMessage(target.messageId, 2000)) {
      setPendingMentions((prev) =>
        prev.filter(
          (m) =>
            !(
              m.communityId === target.communityId &&
              m.messageId === target.messageId
            ),
        ),
      );
    }
  }, [flashMessage, visiblePendingMentions]);

  // ── Image viewer (lightbox) ───────────────────────────────────────────────
  // Every non-deleted image in the loaded chat window, in timeline order, so
  // the viewer can page back/forward between all of them (arrows, keyboard,
  // thumbnail strip) just like WhatsApp.
  const chatImages = useMemo<LightboxImage[]>(
    () =>
      messages
        .filter((m) => m.image_url && !m.deleted_at)
        .map((m) => ({
          url:        m.image_url!,
          content:    m.content || null,
          user_name:  m.users?.name ?? null,
          avatar_url: m.users?.avatar_url ?? null,
          created_at: m.created_at,
        })),
    [messages],
  );
  const [lightboxState, setLightboxState] = useState<{
    communityId: string;
    index: number;
  } | null>(null);
  // Derived during render: the viewer is effectively closed once the
  // community changes since it was opened (no effect needed).
  const lightbox =
    lightboxState && lightboxState.communityId === communityId
      ? lightboxState
      : null;

  // Keep a ref to the latest image list so the click handler stays referentially
  // stable — MessageBubble/MessageList are memoized and must not re-render on
  // every message change just because the handler identity changed.
  const chatImagesRef = useRef(chatImages);
  useEffect(() => {
    chatImagesRef.current = chatImages;
  }, [chatImages]);

  const handleImageClick = useCallback(
    (url: string) => {
      const i = chatImagesRef.current.findIndex((img) => img.url === url);
      if (i >= 0) setLightboxState({ communityId, index: i });
    },
    [communityId],
  );

  // ── Realtime subscription ──────────────────────────────────────────────────
  useRealtimeChat({
    communityId,
    currentUserId,
    fetchMessages,
    setMessages,
    setThreadEvents,
    membersRef,
    pendingProfileFetchRef,
    scrollContainerRef,
    initialScrollDoneRef,
    realtimeInsertPendingRef,
    realtimeWasNearBottomRef,
  });

  // ── Input + send ──────────────────────────────────────────────────────────
  // Mention resolution is wired through a ref: useSendMessage is created first
  // (it owns inputRef/setInput), and the @mention composer hook below assigns
  // its resolver right after. Sends only happen from user events, by which
  // time the ref always points at the current resolver.
  const mentionResolverRef = useRef<((content: string) => MessageMention[]) | null>(null);
  const resolveMentionsForSend = useCallback(
    (content: string) => mentionResolverRef.current?.(content) ?? [],
    [],
  );

  const {
    input,
    setInput,
    sending,
    error,
    setError,
    handleSend,
    handleKeyDown,
    handleCancelSend,
    handleRetrySend,
    handleGifSend,
    inputRef,
    pendingImagePreview,
    handleImageSelect,
    handleImageClear,
  } = useSendMessage({
    communityId,
    currentUserId,
    currentUserName,
    currentUserAvatar,
    setMessages,
    setHideUnreadDivider,
    replyTo,
    onClearReply: handleClearReply,
    scrollToBottomRef: bottomRef,
    resolveMentions: resolveMentionsForSend,
  });

  // ── Member @mentions (autocomplete + registry) ────────────────────────────
  const commitMentionText = useCallback(
    (text: string, caret: number) => {
      setInput(text);
      setTyping(text.trim().length > 0);
      // Restore focus + caret after React re-renders the textarea value.
      requestAnimationFrame(() => {
        const ta = inputRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(caret, caret);
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
      });
    },
    [inputRef, setInput, setTyping],
  );

  const memberMentions = useMemberMentions({
    communityId,
    currentUserId,
    onCommitText: commitMentionText,
  });
  // Publishes the composer's resolver to the send path once the hook exists.
  // Sends only happen from user events, which always run after this effect.
  useEffect(() => {
    mentionResolverRef.current = memberMentions.resolveMentionsForContent;
  }, [memberMentions]);

  const handleEdit = useCallback((msg: CachedMessage) => {
    setEditingMessage(msg);
    setReplyTo(null);
    setError(null);
    setInput(msg.content);
  }, [setError, setInput]);

  const handleCancelEdit = useCallback(() => {
    setEditingMessage(null);
    setInput("");
    setError(null);
    if (inputRef.current) inputRef.current.style.height = "24px";
    inputRef.current?.focus();
  }, [inputRef, setError, setInput]);

  const handleEditSave = useCallback(async () => {
    if (!editingMessage || editingSaving) return;
    const content = input.trim();
    if (!content) {
      setError("Message cannot be empty.");
      return;
    }

    const originalContent = editingMessage.content;
    const messageId = editingMessage.id;
    setEditingSaving(true);
    setError(null);
    setMessages((prev) => {
      const next = prev.map((message) =>
        message.id === messageId ? { ...message, content } : message,
      );
      msgCache.set(communityId, next);
      return next;
    });
    patchSidebarMessageContent(communityId, messageId, content);

    try {
      const res = await fetch(`/api/communities/${communityId}/messages/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json().catch(() => ({})) as { content?: string; edited_at?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to edit message.");

      setMessages((prev) => {
        const next = prev.map((message) =>
          message.id === messageId
            ? { ...message, content: data.content ?? content, edited_at: data.edited_at ?? new Date().toISOString() }
            : message,
        );
        msgCache.set(communityId, next);
        return next;
      });
      setEditingMessage(null);
      setInput("");
      if (inputRef.current) inputRef.current.style.height = "24px";
      inputRef.current?.focus();
    } catch (error) {
      setMessages((prev) => {
        const next = prev.map((message) =>
          message.id === messageId ? { ...message, content: originalContent } : message,
        );
        msgCache.set(communityId, next);
        return next;
      });
      patchSidebarMessageContent(communityId, messageId, originalContent);
      setError(error instanceof Error ? error.message : "Failed to edit message.");
    } finally {
      setEditingSaving(false);
    }
  }, [communityId, editingMessage, editingSaving, input, inputRef, setError, setInput, setMessages]);

  // Insert emoji at the cursor position in the textarea
  const handleEmojiSelect = useCallback(
    (emoji: string) => {
      const textarea = inputRef.current;
      if (textarea) {
        const start = textarea.selectionStart ?? input.length;
        const end   = textarea.selectionEnd   ?? input.length;
        const next  = input.slice(0, start) + emoji + input.slice(end);
        setInput(next);
        // Restore cursor after the inserted emoji
        requestAnimationFrame(() => {
          textarea.selectionStart = start + emoji.length;
          textarea.selectionEnd   = start + emoji.length;
          textarea.focus();
        });
      } else {
        setInput((prev) => prev + emoji);
      }
    },
    [input, inputRef, setInput],
  );

  const handleInputChange = useCallback(
    (value: string) => {
      setInput(value);
      setTyping(value.trim().length > 0);
    },
    [setInput, setTyping],
  );

  const handleInputBlur = useCallback(() => {
    setTyping(false);
    // Clicking away (or into the emoji/image picker) dismisses the @mention
    // popover so it never floats over unrelated UI.
    memberMentions.close();
  }, [memberMentions, setTyping]);

  const handleInputSend = useCallback(() => {
    setTyping(false);
    // Clicking send while an @token is open must not leave the popover
    // floating over the cleared composer.
    memberMentions.close();
    void handleSend();
  }, [handleSend, memberMentions, setTyping]);

  // Leaving the chat tab unmounts the composer — make sure no stale @mention
  // popover survives a tab round-trip.
  useEffect(() => {
    if (activeTab !== "chat") memberMentions.close();
  }, [activeTab, memberMentions]);

  const handleMentionPick = useCallback(
    (option: MentionCandidate) => memberMentions.pick(option),
    [memberMentions],
  );

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) {
        handleKeyDown(event);
        return;
      }
      // While the mention popover is open, arrow keys navigate it, Enter
      // picks the highlighted member (or closes when nothing matches) and
      // Escape dismisses it — none of them should send the message.
      if (memberMentions.isOpen) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          memberMentions.move(1);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          memberMentions.move(-1);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          if (!memberMentions.selectActive()) memberMentions.close();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          memberMentions.close();
          return;
        }
      }
      handleKeyDown(event);
    },
    [handleKeyDown, memberMentions],
  );

  // ── Re-anchor to bottom when reply/image bar appears or disappears ───────
  // When the input area grows (reply bar, image preview), the scroll container
  // shrinks. The browser keeps scrollTop unchanged, so the last messages slide
  // out of view, leaving a black gap.
  //
  // Strategy: track prevDist via a scroll listener so we always know the user's
  // scroll position BEFORE the resize fires. Only snap back to bottom if the
  // user was genuinely at the bottom (≤ 10 px) before the resize — this avoids
  // the wrong behaviour of snapping users who intentionally scrolled up to read
  // an older message before hitting Reply.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Initialise with the current distance from the bottom
    let prevDist =
      container.scrollHeight - container.scrollTop - container.clientHeight;

    // Keep prevDist fresh whenever the user scrolls manually
    const onScroll = () => {
      prevDist =
        container.scrollHeight - container.scrollTop - container.clientHeight;
    };

    const observer = new ResizeObserver(() => {
      // prevDist was captured before this resize → safe to use as "was at bottom"
      if (prevDist <= 10) {
        container.scrollTop = container.scrollHeight - container.clientHeight;
      }
      // Update prevDist to reflect the post-snap position
      prevDist =
        container.scrollHeight - container.scrollTop - container.clientHeight;
    });

    container.addEventListener("scroll", onScroll, { passive: true });
    observer.observe(container);
    return () => {
      container.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [scrollContainerRef]);

  // ── Group messages by date ────────────────────────────────────────────────
  const grouped = useMemo<DateGroup[]>(() =>
    messages.reduce<DateGroup[]>((acc, msg) => {
      const date = fmtDate(msg.created_at);
      const last = acc[acc.length - 1];
      if (last?.date === date) last.messages.push(msg);
      else acc.push({ date, messages: [msg] });
      return acc;
    }, []),
    [messages]
  );

  // ── Sidebar fallback ──────────────────────────────────────────────────────
  const sidebarEntry = hasMounted
    ? sidebarStore.data?.communities.find((c) => c.id === communityId)
    : undefined;
  // Memoized so the header's `community` prop keeps a stable reference across
  // keystroke re-renders (while meta is loading the sidebar fallback object
  // would otherwise be a fresh literal every render).
  const displayCommunity = useMemo(
    () => community ?? (sidebarEntry
      ? {
          id: communityId,
          name: sidebarEntry.name,
          type: sidebarEntry.type,
          member_count: sidebarEntry.member_count,
          image_url: sidebarEntry.image_url,
          lottie_url: sidebarEntry.lottie_url,
          lottie_format: sidebarEntry.lottie_format,
          lottie_data: sidebarEntry.lottie_data,
          is_private: sidebarEntry.is_private,
          enabled_tabs: sidebarEntry.enabled_tabs,
          owner_id: sidebarEntry.owner_id,
        }
      : null),
    [community, sidebarEntry, communityId],
  );

  const renderedTab: ChatTab = displayCommunity &&
    !new Set([...(displayCommunity.enabled_tabs ?? ["chat", "threads", "showcase", "resources", "events"]), "showcase", "members"]).has(activeTab)
      ? "chat"
      : activeTab;

  const isOwner = !!(displayCommunity?.owner_id && displayCommunity.owner_id === currentUserId);
  const myRole = (displayCommunity as any)?.current_user_role ?? (isOwner ? "owner" : null);
  const myPerms = (displayCommunity as any)?.current_user_permissions;
  // Platform-appointed admins of app-created communities get the same
  // management UI as a private-group creator, scoped by their grants.
  const isAdminWith = (permission: "can_edit_settings" | "can_manage_members" | "can_delete_messages") =>
    myRole === "admin" && Boolean(myPerms?.[permission]);
  const canOpenSettings = isOwner || isAdminWith("can_edit_settings");
  const canManageMembers = isOwner || isAdminWith("can_manage_members");
  const canModerateMessages = isOwner || isAdminWith("can_delete_messages");

  // Stable header callbacks — inline arrows would recreate every render and
  // defeat the memoized ChatHeader's bail-out on keystrokes.
  const handleHeaderTabChange = useCallback((tab: ChatTab) => {
    setShowSettings(false);
    handleTabChange(tab);
  }, [handleTabChange]);
  const handleSettingsClick = useCallback(() => setShowSettings(true), []);

  if (!loading && !displayCommunity) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="font-body text-sm text-foreground-muted">Community not found.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        <ChatHeader
          community={displayCommunity}
          activeTab={renderedTab}
          onTabChange={handleHeaderTabChange}
          onlineCount={onlineCount}
          currentUserId={currentUserId}
          onSettingsClick={canOpenSettings ? handleSettingsClick : undefined}
          canOpenSettings={canOpenSettings}
          communityId={communityId}
        />

        <Modal
          open={showSettings && !!displayCommunity}
          onClose={() => setShowSettings(false)}
          maxWidth="max-w-2xl"
          panelClassName="p-0 flex flex-col overflow-hidden"
          hideCloseButton
        >
          {displayCommunity && (
            <CommunitySettingsView
              communityId={communityId}
              community={displayCommunity as any}
              isOwner={isOwner}
              onClose={() => setShowSettings(false)}
              onSaved={(updated) => {
                setCommunity((prev) => prev ? { ...prev, ...updated } : prev);
                // Patch the sidebar store in-place so the logo/name update
                // immediately without requiring a page refresh.
                import("@/lib/communities/cache").then(({ patchSidebarCommunity }) => {
                  patchSidebarCommunity(communityId, {
                    ...(updated.name         !== undefined && { name:         updated.name }),
                    ...(updated.image_url    !== undefined && { image_url:    updated.image_url }),
                    ...(updated.is_private   !== undefined && { is_private:   updated.is_private }),
                    ...(updated.enabled_tabs !== undefined && { enabled_tabs: updated.enabled_tabs }),
                  });
                });
                setShowSettings(false);
              }}
              onDeleted={() => {
                import("@/lib/communities/cache").then(({ invalidateOnLeave }) => {
                  invalidateOnLeave(communityId);
                });
                router.push("/dashboard");
              }}
            />
          )}
        </Modal>
        {editingMessage && (
          <MessageEditModal
            message={editingMessage}
            input={input}
            saving={editingSaving}
            error={error}
            onChange={setInput}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void handleEditSave();
              }
            }}
            onSave={() => void handleEditSave()}
            onClose={handleCancelEdit}
          />
        )}
        {renderedTab === "showcase" ? (
          <ShowcaseView communityId={communityId} currentUserId={currentUserId} />
        ) : renderedTab === "threads" ? (
          <ThreadsView
            communityId={communityId}
            currentUserId={currentUserId}
            onThreadCreated={handleThreadCreated}
          />
        ) : renderedTab === "events" ? (
          <EventsView communityId={communityId} currentUserId={currentUserId} />
        ) : renderedTab === "resources" ? (
          <ResourcesView communityId={communityId} currentUserId={currentUserId} />
        ) : renderedTab === "members" ? (
          <MembersView
            communityId={communityId}
            currentUserId={currentUserId}
            isOwner={isOwner}
            canManageMembers={canManageMembers}
            isPrivate={displayCommunity?.is_private ?? false}
          />
        ) : (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Scrollable message body — a flex sibling of the footer (WhatsApp
              pattern). It owns the scroll; the footer below is static, so
              messages can never flow underneath the input.                     */}
          <div
            ref={scrollContainerRef}
            data-chat-scroll-container
            className="relative flex-1 min-h-0 overflow-y-auto bg-background"
            style={{
              backgroundImage: "radial-gradient(circle,rgba(255,255,255,0.03) 1px,transparent 1px)",
              backgroundSize: "24px 24px",
              // Scroll position above the viewport is preserved manually (see the
              // top-region compensation effect); native anchoring would double-adjust.
              overflowAnchor: "none",
            }}
          >
            <MessageList
              grouped={grouped}
              threadEvents={threadEvents}
              currentUserId={currentUserId}
              firstUnreadMsgId={firstUnreadMsgId}
              unreadDisplayCount={unreadDisplayCount}
              unreadDividerRef={unreadDividerRef}
              topSentinelRef={topSentinelRef}
              bottomRef={bottomRef}
              initialPositionResolved={initialPositionResolved}
              loading={loading}
              loadingOlder={loadingOlder}
              hasMoreAbove={hasMoreAbove}
              threadsReady={threadsReady}
              displayCommunity={displayCommunity}
              communityId={communityId}
              highlightedMsgId={highlightedMsgId}
              canModerateMessages={canModerateMessages}
              onReplyClick={handleReplyClick}
              onCancelSend={handleCancelSend}
              onRetrySend={handleRetrySend}
              onReaction={handleReaction}
              onReply={handleReply}
              onEdit={handleEdit}
              onCopy={handleCopy}
              onDelete={handleDelete}
              onImageClick={handleImageClick}
            />
          </div>

          {/* Static footer — separate from the scroll body, never overlapped */}
          <footer className="relative shrink-0 z-10 bg-background">
            {/* @ pill — jump to messages where the user was mentioned */}
            {visiblePendingMentions.length > 0 && (
              <button
                type="button"
                onClick={jumpToPendingMention}
                className="absolute -top-[88px] right-4 z-20 h-8 w-8 flex items-center justify-center rounded-full bg-[var(--ds-blue-700)] text-white shadow-lg hover:bg-[var(--ds-blue-800)] transition-colors"
                aria-label={`${visiblePendingMentions.length} pending mention${visiblePendingMentions.length === 1 ? "" : "s"} — jump to message`}
                title="Jump to the message where you were mentioned"
              >
                <AtSign strokeWidth={2.5} size={15} />
                <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--ds-blue-900)] px-1 text-[10px] font-bold leading-none text-white ring-2 ring-background">
                  {visiblePendingMentions.length > 9
                    ? "9+"
                    : visiblePendingMentions.length}
                </span>
              </button>
            )}
            {/* Scroll-to-bottom button — floats just above the footer edge */}
            {showScrollToBottom && (
              <button
                onClick={() => bottomRef.current?.scrollIntoView({ behavior: "smooth" })}
                className="absolute -top-10 right-4 z-20 h-8 w-8 flex items-center justify-center rounded-full bg-surface-raised shadow-lg border border-border text-foreground-muted hover:text-foreground transition-colors"
                aria-label="Scroll to bottom"
              >
                <ChevronDown strokeWidth={2.5} size={16} />
              </button>
            )}
            <TypingIndicator users={typingUsers} />
            <div>
              <ChatInput
                ref={inputRef}
                input={input}
                sending={sending || editingSaving}
                error={error}
                placeholder="Type a message…"
                replyTo={replyTo}
                pendingImagePreview={pendingImagePreview}
                linkPreviewUrl={input.trim() ? extractFirstUrl(input) : null}
                onChange={handleInputChange}
                onKeyDown={handleInputKeyDown}
                onSend={handleInputSend}
                onBlur={handleInputBlur}
                onCancelReply={handleClearReply}
                onImageSelect={handleImageSelect}
                onImageRemove={handleImageClear}
                onEmojiSelect={handleEmojiSelect}
                onGifSelect={handleGifSend}
                onComposerActivity={memberMentions.syncFromTextarea}
                resolveMentions={memberMentions.resolveMentionsForContent}
                mention={{
                  open: memberMentions.isOpen,
                  loading: memberMentions.loading,
                  query: memberMentions.query,
                  options: memberMentions.options,
                  activeIndex: memberMentions.activeIndex,
                  onPick: handleMentionPick,
                  onHover: (index) => memberMentions.hover(index),
                }}
              />
            </div>
          </footer>
          </div>
        )}
      </div>

      {/* Full-screen image viewer — click any chat image to open it */}
      {lightbox && chatImages[lightbox.index] && (
        <ImageLightbox
          images={chatImages}
          index={lightbox.index}
          onClose={() => setLightboxState(null)}
          onNavigate={(i) => setLightboxState({ communityId, index: i })}
        />
      )}
    </div>
  );
}
