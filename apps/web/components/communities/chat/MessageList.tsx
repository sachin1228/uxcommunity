"use client";

import { RefObject, memo, useMemo, useRef } from "react";
// Disabled for now: chat loading uses the plain Spinner below.
// import { LottieLoader } from "@/components/ui/LottieLoader";
import { Spinner } from "@/components/ui/Spinner";
import { MessageBubble } from "./MessageBubble";
import { UnreadDivider } from "./UnreadDivider";
import { ThreadNotificationBubble } from "./ThreadNotificationBubble";
import { fmtDate } from "./chatUtils";
import { CommunityDp } from "../CommunityDp";
import type { CachedMessage, CachedThreadEvent, MessageReaction } from "@/lib/communities/cache";

type Message = CachedMessage;

interface Community {
  id: string;
  name: string;
  type: string;
  image_url: string | null;
  lottie_url?: string | null;
  lottie_format?: "json" | "dotlottie" | null;
  lottie_data?: unknown;
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
  onEdit: (msg: CachedMessage) => void;
  onCopy: (msg: CachedMessage) => void;
  onDelete: (msgId: string) => void;
}

/**
 * Memoized so typing in the chat input (a CommunityChat state change) doesn't
 * re-render the whole list: `grouped`, `threadEvents`, the refs, and every
 * handler are referentially stable between keystrokes, so the message map is
 * skipped entirely — unchanged bubbles already bail out individually via
 * MessageBubble's memo.
 */
export const MessageList = memo(function MessageList({
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
  onEdit,
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

  // ── Entrance-animation eligibility ────────────────────────────────────
  // Only messages that arrive *live* (sent by me or pushed via realtime after
  // the list has settled) get the pop-in + word-wave animation. History on
  // first paint and older pages prepended by scroll-up must render static.
  const seenRef = useRef<{ communityId: string; byId: Map<string, CachedMessage>; maxTs: number } | null>(null);
  const animateIdsRef = useRef<Set<string>>(new Set());

  const allMessages = useMemo(() => grouped.flatMap((g) => g.messages), [grouped]);
  const settled = !loading && initialPositionResolved;

  useMemo(() => {
    if (!settled) {
      // Still resolving the initial window — reset so the first settled render seeds silently.
      seenRef.current = null;
      animateIdsRef.current.clear();
      return;
    }

    const prev = seenRef.current;
    const byId = new Map<string, CachedMessage>();
    let maxTs = 0;
    for (const m of allMessages) {
      byId.set(m.id, m);
      const ts = new Date(m.created_at).getTime();
      if (ts > maxTs) maxTs = ts;
    }

    if (prev && prev.communityId === communityId) {
      const prevTemps = [...prev.byId.values()].filter((m) => m.id.startsWith("temp-"));
      for (const m of allMessages) {
        if (prev.byId.has(m.id)) continue;
        // Optimistic bubble already animated; its server-confirmed twin must not replay.
        const isSwap = prevTemps.some(
          (t) => t.user_id === m.user_id && (t.content ?? "") === (m.content ?? ""),
        );
        if (isSwap) continue;
        // Prepended history (load-older) is strictly older than anything we knew about.
        if (new Date(m.created_at).getTime() < prev.maxTs) continue;
        animateIdsRef.current.add(m.id);
      }
    } else {
      // First settled render for this community (or a community switch): seed without animating.
      animateIdsRef.current.clear();
    }

    seenRef.current = { communityId, byId, maxTs };
  }, [allMessages, settled, communityId]);

  if (loading) {
    return (
      <div
        className="flex h-full items-center justify-center"
        role="status"
        aria-label="Loading messages"
      >
        {/* Disabled temporarily. Re-enable this block to restore the chat Lottie.
        <LottieLoader
          communityId={communityId}
          communityType={displayCommunity?.type ?? ""}
          size={200}
          showFallback={false}
        /> */}
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
      {/* Load-older slot. A single fixed-height row that is present the whole
          time there may be more messages above. It doubles as the
          IntersectionObserver sentinel and hosts the spinner, which only
          toggles visibility — never layout — so nothing below it moves when a
          fetch starts or finishes. Removing the row (hasMoreAbove → false) is
          compensated by the scroll-preservation effect in CommunityChat.     */}
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

      {/* Empty state — only shown once threads have loaded too, so we don't
          flash "Be the first to say something" in communities that have threads
          but no chat messages while the thread fetch is still in flight.     */}
      {mergedGroups.length === 0 && threadsReady && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 py-16 px-5">
          <CommunityDp
            imageUrl={displayCommunity?.image_url ?? null}
            lottieUrl={displayCommunity?.lottie_url}
            lottieFormat={displayCommunity?.lottie_format}
            lottieData={displayCommunity?.lottie_data}
            name={displayCommunity?.name ?? ""}
            size={48}
            className="bg-surface-raised"
          />
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
      {mergedGroups.map((group, groupIdx) => {
        // Track the previous timeline item so isSameAuthor works correctly
        // even when thread notifications appear between messages.
        let prevItem: TimelineItem | null = null;

        // The pill above the *oldest loaded* group is only a guess while more
        // history may exist above: the real day boundary could be thousands of
        // messages further up. Rendering it would make it "float" to the top of
        // every newly-prepended chunk (and shift layout each time). Show it only
        // once we know it's a genuine boundary — i.e. there is a different-day
        // group before it, or we've reached the true start of the history.
        const showDateDivider = groupIdx > 0 || !hasMoreAbove;

        return (
          <div key={group.date}>
            {/* Date divider */}
            {showDateDivider && (
              <div className="flex items-center justify-center py-3 px-5">
                <span className="font-body text-[11px] text-foreground-muted bg-surface-raised rounded-full px-3 py-0.5 shadow-[0_1px_6px_rgba(0,0,0,0.25)]">
                  {group.date}
                </span>
              </div>
            )}

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
                  onEdit={onEdit}
                  onCopy={onCopy}
                  onDelete={onDelete}
                  animate={animateIdsRef.current.has(msg.id)}
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
