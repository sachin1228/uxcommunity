"use client";

import { useState, useLayoutEffect, useEffect, useCallback, useMemo, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { sidebarStore, msgCache } from "@/lib/communities/cache";
import type { CachedMessage, CachedMeta, MessageReaction, ReplyPreview } from "@/lib/communities/cache";
import { fmtDate } from "./chat/chatUtils";
import { ChatHeader } from "./chat/ChatHeader";
import { ChatInput } from "./chat/ChatInput";
import { MembersPanel } from "./chat/MembersPanel";
import { MessageList } from "./chat/MessageList";
import { useChatData } from "./chat/useChatData";
import { useScrollAndUnread } from "./chat/useScrollAndUnread";
import { useRealtimeChat } from "./chat/useRealtimeChat";
import { useSendMessage } from "./chat/useSendMessage";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface DateGroup {
  date: string;
  messages: CachedMessage[];
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
  initialMeta?: CachedMeta;
  initialMessages?: CachedMessage[];
  initialLastReadAt?: string | null;
}) {
  const [hasMounted, setHasMounted] = useState(false);
  useIsomorphicLayoutEffect(() => { setHasMounted(true); }, []);

  // ── Highlighted message state (scroll-to-reply) — handler defined after scrollContainerRef ──
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Reply state ───────────────────────────────────────────────────────────
  const [replyTo, setReplyTo] = useState<ReplyPreview | null>(null);
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

  const handleReactionToggled = useCallback(
    (msgId: string, reactions: MessageReaction[]) => {
      setMessages((prev) => {
        const next = prev.map((m) => m.id === msgId ? { ...m, reactions } : m);
        msgCache.set(communityId, next);
        return next;
      });
    },
    [communityId]
  );

  // ── Inline hover reaction handler ─────────────────────────────────────────
  const handleReaction = useCallback(
    async (msgId: string, emoji: string) => {
      let optimisticReactions: MessageReaction[] = [];

      setMessages((prev) => {
        const msg = prev.find((m) => m.id === msgId);
        if (!msg) return prev;

        const existing = (msg.reactions ?? []).find(
          (r) => r.emoji === emoji && r.user_ids.includes(currentUserId)
        );

        if (existing) {
          optimisticReactions = (msg.reactions ?? [])
            .map((r) =>
              r.emoji === emoji
                ? { ...r, user_ids: r.user_ids.filter((id) => id !== currentUserId) }
                : r
            )
            .filter((r) => r.user_ids.length > 0);
        } else {
          const withoutUser = (msg.reactions ?? [])
            .map((r) => ({ ...r, user_ids: r.user_ids.filter((id) => id !== currentUserId) }))
            .filter((r) => r.user_ids.length > 0);
          const group = withoutUser.find((r) => r.emoji === emoji);
          optimisticReactions = group
            ? withoutUser.map((r) =>
                r.emoji === emoji ? { ...r, user_ids: [...r.user_ids, currentUserId] } : r
              )
            : [...withoutUser, { emoji, user_ids: [currentUserId] }];
        }

        const next = prev.map((m) =>
          m.id === msgId ? { ...m, reactions: optimisticReactions } : m
        );
        msgCache.set(communityId, next);
        return next;
      });

      try {
        const res = await fetch(
          `/api/communities/${communityId}/messages/${msgId}/reactions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ emoji }),
          }
        );
        if (res.ok) {
          const { reactions } = await res.json();
          handleReactionToggled(msgId, reactions);
        }
      } catch {
        // Network error — realtime will correct state when reconnected
      }
    },
    [communityId, currentUserId, handleReactionToggled]
  );

  // ── Data fetching + message state ─────────────────────────────────────────
  const {
    community,
    members,
    messages,
    loading,
    initialMessagesReady,
    setMessages,
    fetchMessages,
    communityIdRef,
    membersRef,
    pendingProfileFetchRef,
  } = useChatData({ communityId, initialMeta, initialMessages });

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

  // ── Scroll-to-reply handler (needs scrollContainerRef from above) ─────────
  const handleReplyClick = useCallback((replyId: string) => {
    const el = scrollContainerRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${replyId}"]`
    );
    if (!el) return;
    el.scrollIntoView({ behavior: "instant", block: "center" });
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    setHighlightedMsgId(replyId);
    highlightTimerRef.current = setTimeout(() => setHighlightedMsgId(null), 1500);
  }, [scrollContainerRef]);

  // ── Realtime subscription ─────────────────────────────────────────────────
  useRealtimeChat({
    communityId,
    fetchMessages,
    setMessages,
    membersRef,
    pendingProfileFetchRef,
    scrollContainerRef,
    initialScrollDoneRef,
    realtimeInsertPendingRef,
    realtimeWasNearBottomRef,
  });

  // ── Input + send ──────────────────────────────────────────────────────────
  const {
    input,
    setInput,
    sending,
    error,
    handleSend,
    handleKeyDown,
    handleCancelSend,
    handleRetrySend,
    inputRef,
    pendingImagePreview,
    handleImageSelect,
    handleImageClear,
  } = useSendMessage({
    communityId,
    currentUserId,
    setMessages,
    setHideUnreadDivider,
    replyTo,
    onClearReply: handleClearReply,
  });

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
  const displayCommunity = community ?? (sidebarEntry
    ? { id: communityId, name: sidebarEntry.name, type: sidebarEntry.type, member_count: sidebarEntry.member_count, image_url: sidebarEntry.image_url }
    : null);

  if (!loading && !displayCommunity) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="font-body text-sm text-foreground-muted">Community not found.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <ChatHeader community={displayCommunity} />

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Scrollable message area */}
          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-y-auto"
            style={{
              backgroundImage: "radial-gradient(circle,rgba(255,255,255,0.03) 1px,transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          >
            <MessageList
              grouped={grouped}
              currentUserId={currentUserId}
              firstUnreadMsgId={firstUnreadMsgId}
              unreadDisplayCount={unreadDisplayCount}
              unreadDividerRef={unreadDividerRef}
              bottomRef={bottomRef}
              initialPositionResolved={initialPositionResolved}
              loading={loading}
              displayCommunity={displayCommunity}
              communityId={communityId}
              highlightedMsgId={highlightedMsgId}
              onReplyClick={handleReplyClick}
              onCancelSend={handleCancelSend}
              onRetrySend={handleRetrySend}
              onReaction={handleReaction}
              onReply={handleReply}
              onCopy={handleCopy}
            />
          </div>

          {/* Input wrapper — `relative` so the ↓ button is always anchored just
              above this box, regardless of reply-bar / image-preview height.   */}
          <div className="relative shrink-0">
            {showScrollToBottom && (
              <button
                onClick={() => bottomRef.current?.scrollIntoView({ behavior: "smooth" })}
                className="absolute -top-10 right-4 z-10 h-8 w-8 flex items-center justify-center rounded-full bg-surface-raised shadow-lg border border-border text-foreground-muted hover:text-foreground transition-colors"
                aria-label="Scroll to bottom"
              >
                <ChevronDown size={16} />
              </button>
            )}

            <ChatInput
              ref={inputRef}
              input={input}
              sending={sending}
              error={error}
              placeholder={`Message ${displayCommunity?.name ?? ""}…`}
              replyTo={replyTo}
              pendingImagePreview={pendingImagePreview}
              onChange={setInput}
              onKeyDown={handleKeyDown}
              onSend={handleSend}
              onCancelReply={handleClearReply}
              onImageSelect={handleImageSelect}
              onImageRemove={handleImageClear}
            />
          </div>

        </div>

        <MembersPanel members={members} />
      </div>
    </div>
  );
}
