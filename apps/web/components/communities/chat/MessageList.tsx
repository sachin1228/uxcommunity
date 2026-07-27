"use client";

import { RefObject, useMemo } from "react";
import { LottieLoader } from "@/components/ui/LottieLoader";
import { MessageBubble } from "./MessageBubble";
import { UnreadDivider } from "./UnreadDivider";
import { ThreadNotificationBubble } from "./ThreadNotificationBubble";
import { TYPE_EMOJI, fmtDate } from "./chatUtils";
import type { CachedMessage, CachedThreadEvent, MessageReaction } from "@/lib/communities/cache";
import { Loader2 } from "lucide-react";

type Message = CachedMessage;

interface Community {
  id: string;
  name: string;
  type: string;
  image_url: string | null;
}

interface DateGroup {
  date: string;
  messages: Message[];
}

type TimelineItem =
  | { kind: "message"; msg: CachedMessage; created_at: string }
  | { kind: "thread"; event: CachedThreadEvent; created_at: string };

interface MergedGroup {
  date: string;
  items: TimelineItem[];
}

interface MessageListProps {
  grouped: DateGroup[];
  threadEvents: CachedThreadEvent[];
  currentUserId: string;
  firstUnreadMsgId: string | null;
  unreadDisplayCount: number;
  unreadDividerRef: RefObject<HTMLDivElement>;
  /** Observed by an IntersectionObserver in CommunityChat to trigger loading older messages. */
  topSentinelRef: RefObject<HTMLDivElement>;
  bottomRef: RefObject<HTMLDivElement>;
  initialPositionResolved: boolean;
  loading: boolean;
  /** True while an older-messages fetch is in flight. */
  loadingOlder: boolean;
  /** False once we know there are no more messages above the current window. */
  hasMoreAbove: boolean;
  /** True once the initial threads fetch for the current community has settled. */
  threadsReady: boolean;
  displayCommunity: Community | null;
  communityId: string;
  highlightedMsgId: string | null;
  onReplyClick: (replyId: string) => void;
  onCancelSend: (msgId: string) => void;
  onRetrySend: (msgId: string) => void;
  onReaction: (msgId: string, emoji: string) => void;
  onReply: (msg: CachedMessage) => void;
  onCopy: (msg: CachedMessage) => void;
  onDelete: (msgId: string) => void;
}

export function MessageList({
  grouped,
  threadEvents,
  currentUserId,
  firstUnreadMsgId,
  unreadDisplayCount,
  unreadDividerRef,
  topSentinelRef,
  bottomRef,
  initialPositionResolved,
  loading,
  loadingOlder,
  hasMoreAbove,
  threadsReady,
  displayCommunity,
  communityId,
  highlightedMsgId,
  onReplyClick,
  onCancelSend,
  onRetrySend,
  onReaction,
  onReply,
  onCopy,
  onDelete,
}: MessageListProps) {
  // Merge messages + thread events into date-grouped timeline items.
  const mergedGroups = useMemo<MergedGroup[]>(() => {
    // Build a map of date → items so we can add thread events even on dates
    // that have no regular messages yet.
    const map = new Map<string, TimelineItem[]>();

    for (const group of grouped) {
      const items: TimelineItem[] = group.messages.map((msg) => ({
        kind: "message",
        msg,
        created_at: msg.created_at,
      }));
      map.set(group.date, items);
    }

    for (const event of threadEvents) {
      const date = fmtDate(event.created_at);
      if (!map.has(date)) map.set(date, []);
      map.get(date)!.push({ kind: "thread", event, created_at: event.created_at });
    }

    // Sort each group's items by created_at, then sort groups by date.
    const result: MergedGroup[] = [];
    for (const [date, items] of map) {
      items.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      result.push({ date, items });
    }
    result.sort(
      (a, b) =>
        new Date(a.items[0]?.created_at ?? 0).getTime() -
        new Date(b.items[0]?.created_at ?? 0).getTime()
    );
    return result;
  }, [grouped, threadEvents]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <LottieLoader
          communityId={communityId}
          communityType={displayCommunity?.type ?? ""}
          size={200}
          spinnerClassName="h-5 w-5 text-foreground-muted"
        />
      </div>
    );
  }

  return (
    <div
      className="min-h-full flex flex-col justify-end py-4 space-y-1"
      style={{ visibility: initialPositionResolved ? "visible" : "hidden" }}
    >
      {/* Top sentinel — observed by IntersectionObserver in CommunityChat to
          load older messages when the user scrolls near the top.
          Only rendered while there may be more messages above.              */}
      {hasMoreAbove && (
        <div ref={topSentinelRef} className="h-1 shrink-0" aria-hidden />
      )}

      {/* Spinner shown while an older-page fetch is in flight */}
      {loadingOlder && (
        <div className="flex items-center justify-center py-3">
          <Loader2 size={18} className="animate-spin text-foreground-muted" />
        </div>
      )}

      {/* "Beginning of conversation" marker once we know there's nothing older */}
      {!hasMoreAbove && mergedGroups.length > 0 && (
        <div className="flex items-center justify-center py-4 px-5">
          <span className="font-body text-[11px] text-foreground-muted bg-surface-raised rounded-full px-3 py-0.5">
            Beginning of conversation
          </span>
        </div>
      )}

      {/* Empty state — only shown once threads have loaded too, so we don't
          flash "Be the first to say something" in communities that have threads
          but no chat messages while the thread fetch is still in flight.     */}
      {mergedGroups.length === 0 && threadsReady && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 py-16 px-5">
          <div className="h-12 w-12 rounded-full bg-surface-raised flex items-center justify-center text-2xl overflow-hidden shrink-0">
            {displayCommunity?.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
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
            !<br />
            <span className="text-xs">Be the first to say something.</span>
          </p>
        </div>
      )}

      {/* Date-grouped timeline (messages + thread notifications merged) */}
      {mergedGroups.map((group) => {
        // Track the previous timeline item so isSameAuthor works correctly
        // even when thread notifications appear between messages.
        let prevItem: TimelineItem | null = null;

        return (
          <div key={group.date}>
            {/* Date divider */}
            <div className="flex items-center justify-center py-3 px-5">
              <span className="font-body text-[11px] text-foreground-muted bg-surface-raised rounded-full px-3 py-0.5 shadow-[0_1px_6px_rgba(0,0,0,0.25)]">
                {group.date}
              </span>
            </div>

            {group.items.map((item) => {
              if (item.kind === "thread") {
                // Thread notifications break the "same author" run for messages.
                prevItem = null;
                return (
                  <ThreadNotificationBubble
                    key={`thread-${item.event.id}`}
                    event={item.event}
                    communityId={communityId}
                    currentUserId={currentUserId}
                  />
                );
              }

              // message item
              const msg = item.msg;
              const isMe = msg.user_id === currentUserId;
              const isSameAuthor =
                prevItem?.kind === "message" &&
                prevItem.msg.user_id === msg.user_id;
              prevItem = item;
              const isFirstUnread = firstUnreadMsgId !== null && msg.id === firstUnreadMsgId;
              const dividerNode = isFirstUnread ? (
                <UnreadDivider ref={unreadDividerRef} count={unreadDisplayCount} />
              ) : null;

              return (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  isMe={isMe}
                  isSameAuthor={isSameAuthor}
                  isFirstUnread={isFirstUnread}
                  unreadDivider={dividerNode}
                  currentUserId={currentUserId}
                  highlighted={highlightedMsgId === msg.id}
                  onReplyClick={onReplyClick}
                  onCancelSend={onCancelSend}
                  onRetrySend={onRetrySend}
                  onReaction={onReaction}
                  onReply={onReply}
                  onCopy={onCopy}
                  onDelete={onDelete}
                />
              );
            })}
          </div>
        );
      })}

      <div ref={bottomRef} />
    </div>
  );
}
