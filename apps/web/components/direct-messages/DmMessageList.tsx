"use client";

import { RefObject, memo, useMemo, useRef } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { MessageBubble } from "@/components/communities/chat/MessageBubble";
import { UnreadDivider } from "@/components/communities/chat/UnreadDivider";
import { fmtDate } from "@/components/communities/chat/chatUtils";
import { AvatarImg } from "@/components/ui/AvatarImg";
import type { DmMessage, DmPeer } from "@/lib/direct-messages/types";
import type { MessageDeletedByRole } from "@/lib/communities/cache";

interface DateGroup {
  date: string;
  messages: DmMessage[];
}

/**
 * The DM timeline: day-grouped bubbles reusing the community chat's exact
 * rendering (bubble, tail, reactions, jumbo emoji, tombstones, entrance
 * animations). Only the timeline-machinery the community room needs —
 * "created a …" cards, watermark, threads — is absent here.
 *
 * Memoized like the community list: referentially stable props between
 * keystrokes mean typing never re-renders the bubbles.
 */
export const DmMessageList = memo(function DmMessageList({
  conversationId,
  messages,
  peer,
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
  highlightedMsgId,
  onReplyClick,
  onCancelSend,
  onRetrySend,
  onReaction,
  onReply,
  onEdit,
  onCopy,
  onDelete,
  onImageClick,
}: {
  conversationId: string | null;
  messages: DmMessage[];
  peer: DmPeer | null;
  currentUserId: string;
  firstUnreadMsgId: string | null;
  unreadDisplayCount: number;
  unreadDividerRef: RefObject<HTMLDivElement>;
  topSentinelRef: RefObject<HTMLDivElement>;
  bottomRef: RefObject<HTMLDivElement>;
  initialPositionResolved: boolean;
  loading: boolean;
  loadingOlder: boolean;
  hasMoreAbove: boolean;
  highlightedMsgId: string | null;
  onReplyClick: (replyId: string) => void;
  onCancelSend: (msgId: string) => void;
  onRetrySend: (msgId: string) => void;
  onReaction: (msgId: string, emoji: string) => void;
  onReply: (msg: DmMessage) => void;
  onEdit: (msg: DmMessage) => void;
  onCopy: (msg: DmMessage) => void;
  onDelete: (msgId: string, removedByRole: MessageDeletedByRole | null) => void;
  onImageClick: (url: string) => void;
}) {
  const grouped = useMemo<DateGroup[]>(
    () =>
      messages.reduce<DateGroup[]>((acc, msg) => {
        const date = fmtDate(msg.created_at);
        const last = acc[acc.length - 1];
        if (last?.date === date) last.messages.push(msg);
        else acc.push({ date, messages: [msg] });
        return acc;
      }, []),
    [messages],
  );

  // ── Entrance-animation eligibility (live arrivals only) ─────────────────
  const seenRef = useRef<{ conversationId: string; byId: Map<string, DmMessage>; maxTs: number } | null>(null);
  const animateIdsRef = useRef<Set<string>>(new Set());
  const settled = !loading && initialPositionResolved;

  useMemo(() => {
    if (!settled) {
      seenRef.current = null;
      animateIdsRef.current.clear();
      return;
    }
    const prev = seenRef.current;
    const byId = new Map<string, DmMessage>();
    let maxTs = 0;
    for (const m of messages) {
      byId.set(m.id, m);
      const ts = new Date(m.created_at).getTime();
      if (ts > maxTs) maxTs = ts;
    }

    if (prev && prev.conversationId === conversationId) {
      const prevTemps = [...prev.byId.values()].filter((m) => m.id.startsWith("temp-"));
      for (const m of messages) {
        if (prev.byId.has(m.id)) continue;
        const isSwap = prevTemps.some(
          (t) => t.user_id === m.user_id && (t.content ?? "") === (m.content ?? ""),
        );
        if (isSwap) continue;
        if (new Date(m.created_at).getTime() < prev.maxTs) continue;
        animateIdsRef.current.add(m.id);
      }
    } else {
      animateIdsRef.current.clear();
    }
    seenRef.current = { conversationId: conversationId ?? "none", byId, maxTs };
  }, [messages, settled, conversationId]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center" role="status" aria-label="Loading messages">
        <Spinner size={28} />
        <span className="sr-only">Loading messages</span>
      </div>
    );
  }

  return (
    <div
      className="min-h-full flex flex-col justify-end py-4 space-y-1"
      style={{ visibility: initialPositionResolved ? "visible" : "hidden" }}
    >
      {hasMoreAbove && (
        <div
          ref={topSentinelRef}
          data-load-older-slot
          className="flex h-10 shrink-0 items-center justify-center"
          aria-hidden={!loadingOlder}
          aria-busy={loadingOlder}
        >
          <div className={loadingOlder ? "visible" : "invisible"}>
            <Spinner size={18} />
          </div>
        </div>
      )}

      {/* Empty state — a fresh conversation says what to do next. */}
      {messages.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 py-16">
          {peer && (
            <AvatarImg url={peer.avatar_url} name={peer.name} size={48} className="shrink-0 rounded-full object-cover" />
          )}
          <p className="font-body text-sm text-foreground-muted text-center">
            Say hi to <span className="font-medium text-foreground">{peer?.name ?? "them"}</span>.
          </p>
        </div>
      )}

      {grouped.map((group, groupIdx) => {
        const showDateDivider = groupIdx > 0 || !hasMoreAbove;
        return (
          <div key={group.date}>
            {showDateDivider && (
              <div className="flex items-center justify-center py-3 px-5">
                <span className="font-body text-[11px] text-foreground-muted bg-surface-raised rounded-full px-3 py-0.5 shadow-[0_1px_6px_rgba(0,0,0,0.25)]">
                  {group.date}
                </span>
              </div>
            )}

            {group.messages.map((msg, itemIdx) => {
              const isMe = msg.user_id === currentUserId;
              // While older history may exist above, the topmost loaded
              // message renders as a plain continuation (its avatar/name/tail
              // would "float" every time a page is prepended).
              const isWindowTopMessage = groupIdx === 0 && itemIdx === 0;
              const prevMsg = groupIdx === 0 && itemIdx === 0
                ? null
                : itemIdx > 0
                  ? group.messages[itemIdx - 1]
                  : grouped[groupIdx - 1]?.messages.at(-1) ?? null;
              const isSameAuthor =
                (isWindowTopMessage && hasMoreAbove) ||
                (prevMsg !== null && prevMsg.user_id === msg.user_id);
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
                  onEdit={onEdit}
                  onCopy={onCopy}
                  onDelete={onDelete}
                  onImageClick={onImageClick}
                  canModerate={false}
                  moderationRole={null}
                  animate={animateIdsRef.current.has(msg.id)}
                  variant="dm"
                />
              );
            })}
          </div>
        );
      })}

      <div ref={bottomRef} />
    </div>
  );
});
