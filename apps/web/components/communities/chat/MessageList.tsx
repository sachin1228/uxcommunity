"use client";

import { RefObject } from "react";
import { LottieLoader } from "@/components/ui/LottieLoader";
import { MessageBubble } from "./MessageBubble";
import { UnreadDivider } from "./UnreadDivider";
import { TYPE_EMOJI } from "./chatUtils";
import type { CachedMessage } from "@/lib/communities/cache";

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

interface MessageListProps {
  grouped: DateGroup[];
  currentUserId: string;
  firstUnreadMsgId: string | null;
  unreadDisplayCount: number;
  unreadDividerRef: RefObject<HTMLDivElement>;
  bottomRef: RefObject<HTMLDivElement>;
  initialPositionResolved: boolean;
  loading: boolean;
  displayCommunity: Community | null;
  communityId: string;
  highlightedMsgId: string | null;
  onMessagePress: (msg: CachedMessage) => void;
  onReplyClick: (replyId: string) => void;
  onCancelSend: (msgId: string) => void;
}

export function MessageList({
  grouped,
  currentUserId,
  firstUnreadMsgId,
  unreadDisplayCount,
  unreadDividerRef,
  bottomRef,
  initialPositionResolved,
  loading,
  displayCommunity,
  communityId,
  highlightedMsgId,
  onMessagePress,
  onReplyClick,
  onCancelSend,
}: MessageListProps) {
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
      {/* Empty state */}
      {grouped.length === 0 && (
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

      {/* Date-grouped messages */}
      {grouped.map((group) => (
        <div key={group.date}>
          {/* Date divider */}
          <div className="flex items-center justify-center py-3 px-5">
            <span className="font-body text-[11px] text-foreground-muted bg-surface-raised rounded-full px-3 py-0.5 shadow-[0_1px_6px_rgba(0,0,0,0.25)]">
              {group.date}
            </span>
          </div>

          {group.messages.map((msg, i) => {
            const isMe         = msg.user_id === currentUserId;
            const prev         = group.messages[i - 1];
            const isSameAuthor = prev?.user_id === msg.user_id;
            const isFirstUnread =
              firstUnreadMsgId !== null && msg.id === firstUnreadMsgId;
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
                onPress={onMessagePress}
                onReplyClick={onReplyClick}
                onCancelSend={onCancelSend}
              />
            );
          })}
        </div>
      ))}

      <div ref={bottomRef} />
    </div>
  );
}
