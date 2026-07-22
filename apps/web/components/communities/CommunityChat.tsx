"use client";

import { useState, useLayoutEffect, useEffect, useCallback, useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { sidebarStore, msgCache } from "@/lib/communities/cache";
import type { CachedMessage, CachedMeta, MessageReaction, ReplyPreview } from "@/lib/communities/cache";
import { fmtDate } from "./chat/chatUtils";
import { ChatHeader } from "./chat/ChatHeader";
import { ChatInput } from "./chat/ChatInput";
import { MembersPanel } from "./chat/MembersPanel";
import { MessageList } from "./chat/MessageList";
import { MessageActionSlider } from "./chat/MessageActionSlider";
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

  // ── Message action slider state ───────────────────────────────────────────
  const [activeMessage, setActiveMessage] = useState<CachedMessage | null>(null);
  const [sliderIsMe, setSliderIsMe]       = useState(false);

  const handleMessagePress = useCallback((msg: CachedMessage) => {
    setActiveMessage(msg);
    setSliderIsMe(msg.user_id === currentUserId);
  }, [currentUserId]);

  const handleSliderClose = useCallback(() => setActiveMessage(null), []);

  const handleCopy = useCallback((msg: CachedMessage) => {
    navigator.clipboard.writeText(msg.content).catch(() => {});
  }, []);

  const handleReactionToggled = useCallback(
    (msgId: string, reactions: MessageReaction[]) => {
      setMessages((prev) => {
        const next = prev.map((m) => m.id === msgId ? { ...m, reactions } : m);
        msgCache.set(communityId, next);
        setActiveMessage((cur) => cur?.id === msgId ? { ...cur, reactions } : cur);
        return next;
      });
    },
    [communityId]
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
              onMessagePress={handleMessagePress}
            />
          </div>

          {/* Scroll-to-bottom button */}
          {showScrollToBottom && (
            <button
              onClick={() => bottomRef.current?.scrollIntoView({ behavior: "smooth" })}
              className="absolute bottom-[72px] right-4 z-10 h-8 w-8 flex items-center justify-center rounded-full bg-surface-raised shadow-lg border border-border text-foreground-muted hover:text-foreground transition-colors"
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

          {/* Message action slider */}
          <MessageActionSlider
            message={activeMessage}
            isMe={sliderIsMe}
            currentUserId={currentUserId}
            communityId={communityId}
            onClose={handleSliderClose}
            onReply={handleReply}
            onCopy={handleCopy}
            onReactionToggled={handleReactionToggled}
          />
        </div>

        <MembersPanel members={members} />
      </div>
    </div>
  );
}
