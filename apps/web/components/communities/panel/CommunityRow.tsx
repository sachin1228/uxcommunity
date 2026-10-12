"use client";

import { memo, useRef, useCallback } from "react";
import { BellOff, Pin } from "lucide-react";
import { CommunityVisibilityIcon, SignupCommunityBadge } from "../CommunityBadges";
import { communityNameBadges } from "@/lib/communities/community-badges";
import { isCommunityMuted } from "@/lib/communities/mute";
import { CommunityAvatar } from "./CommunityAvatar";
import { SidebarTimestamp } from "./SidebarTimestamp";
import { NotoEmojiSvg } from "../chat/NotoEmojiSvg";
import { ImagePreviewWord, renderTextWithEmoji } from "./sidebar-preview-parts";
import {
  contentIsNewerThanLastMessage,
  formatContentPreview,
  formatMessagePreview as formatPreview,
} from "./sidebar-content";
import type { CachedSidebarCommunity } from "@/lib/communities/cache";

type Community = CachedSidebarCommunity;

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`;
  return String(n);
}

interface CommunityRowProps {
  c: Community;
  active: boolean;
  /** If set, shown instead of the last-message preview. */
  typingText?: string;
  /** Called with the community id on click. */
  onClick: (communityId: string) => void;
  /** Called with the community id on hover to prefetch bootstrap data. */
  onHover?: (communityId: string) => void;
}

/**
 * Memoized so typing-indicator flushes, message previews, or unread-badge
 * changes for ONE community don't re-render every row in the sidebar — the
 * community object, typingText string, and callbacks are all referentially
 * stable between updates, so untouched rows bail out of reconciliation.
 */
export const CommunityRow = memo(function CommunityRow({
  c,
  active,
  typingText,
  onClick,
  onHover,
}: CommunityRowProps) {
  const { lastReaction } = c;
  const badges = communityNameBadges(c.type, c.is_private);
  const preview = c.last_message ? formatPreview(c.last_message) : null;
  // A thread/showcase/resource/event created after the newest message takes
  // over the preview line ("john created a thread") — mirroring the chat
  // timeline, where the same event renders as its own notification card. The
  // unread content items also raise the unread count below.
  const lastContent =
    c.last_content && contentIsNewerThanLastMessage(c.last_content, c)
      ? c.last_content
      : null;
  const contentPreview = lastContent ? formatContentPreview(lastContent) : null;
  // The row's unread total: messages plus unread threads/showcase posts/
  // resources/events created by others. It closes the row's marks — after the
  // mute bell and the pin — and it is what turns the timestamp blue, the same
  // "there is something new here" the messenger this row imitates says in
  // green. Nothing is unread while the community is open in front of you.
  const unreadCount = c.message_count + (c.unread_content_count ?? 0);
  const hasUnread = unreadCount > 0 && !active;

  // Throttle prefetch to avoid hammering the network on rapid mouse moves.
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleMouseEnter = useCallback(() => {
    if (hoverTimerRef.current) return;
    onHover?.(c.id);
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null;
    }, 2000); // max 1 prefetch per 2s per row
  }, [onHover, c.id]);

  return (
    <li>
      <button
        onClick={() => onClick(c.id)}
        onMouseEnter={handleMouseEnter}
        className={`flex w-full items-start gap-[11px] rounded-lg px-[14px] py-[9px] text-left transition-colors ${
          active
            ? "bg-surface-raised text-foreground"
            : "hover:bg-surface-raised"
        }`}
      >
        <CommunityAvatar
          imageUrl={c.image_url}
          name={c.name}
          type={c.type}
          eventDate={c.event_date}
          // The full window deadline, ahead or past: LIVE while it runs, ENDED
          // for the day after, then no badge at all.
          eventEnd={c.event_end ?? c.pinned_until}
        />

        <div className="flex-1 min-w-0">
          {/* Community name + timestamp */}
          <div className="flex items-center gap-1 mb-0.5 min-w-0">
            <span className="min-w-0 truncate font-body text-[14px] font-medium text-foreground">
              {c.name}
            </span>
            {/* Badges: the verified seal, then the public/private mark
                ("Electro ✓ 🔒", "Electro 🌐"). */}
            {badges.verified && <SignupCommunityBadge size={12} />}
            {badges.visibility && <CommunityVisibilityIcon kind={badges.visibility} />}
            {(c.last_message || lastContent) && !typingText && (
              <SidebarTimestamp
                iso={
                  !lastContent || (c.last_message && c.last_message.created_at > lastContent.created_at)
                    ? c.last_message!.created_at
                    : lastContent.created_at
                }
                highlight={hasUnread}
              />
            )}
          </div>

          {/* Meta: the member count. */}
          <div className="mb-0.5 flex items-center gap-1 font-body text-[11px] leading-none text-foreground-muted">
            <span>{fmtCount(c.member_count)} members</span>
          </div>

          {/* Preview line */}
          <div className="flex items-start gap-1.5">
            {typingText ? (
              /* Typing — highest priority */
              <p className="font-body text-[13px] text-accent truncate flex-1">
                {typingText}
              </p>

            ) : contentPreview ? (
              /* Content preview — "john created a thread" etc., shown when a
                 thread/showcase post/resource/event is the newest activity in
                 the community. */
              <p className="font-body text-[13px] leading-5 truncate flex-1 text-foreground-muted">
                <span className="font-medium">{contentPreview.prefix}: </span>
                {contentPreview.text}
              </p>

            ) : lastReaction ? (
              /* Reaction preview — shown for ANY reaction, not just ones on
                 the latest message. Reacting to an older message must still
                 confirm in the sidebar ("john reacted ❤️ to: 'ok'"); dropping
                 it made the reaction look like it never registered. */
              <p className="font-body text-[13px] text-foreground-muted truncate flex-1">
                <span className="font-medium">{lastReaction.firstName}</span>
                {" reacted "}
                <NotoEmojiSvg emoji={lastReaction.emoji} size={14} className="align-middle mx-0.5" />
                {" to: "}
                {lastReaction.messagePreviewMedia === "image" ? (
                  <ImagePreviewWord word={lastReaction.messagePreview} />
                ) : (
                  <span>{lastReaction.messagePreview}</span>
                )}
              </p>

            ) : preview ? (
              /* Standard message preview */
              <p className="font-body text-[13px] leading-5 truncate flex-1 text-foreground-muted">
                {preview.prefix && (
                  <span className="font-medium">{preview.prefix}: </span>
                )}
                {preview.media === "image" ? (
                  <ImagePreviewWord word={preview.text} />
                ) : (
                  renderTextWithEmoji(preview.text)
                )}
              </p>

            ) : (
              <p className="font-body text-[13px] text-foreground-muted flex-1">
                No messages yet
              </p>
            )}

            {/* Unread @mention mark — the same signal the chat's "@" pill
                gives once the community is open, surfaced here for the
                communities the member is not looking at. It is a plain mark:
                the count at the end of the row is the community's normal
                unread count, not a mention tally. */}
            {c.mention_count ? (
              <span
                className="shrink-0 font-body text-[14px] font-bold leading-none text-accent"
                aria-label="You were mentioned in this community"
                title="You were mentioned in this community"
              >
                @
              </span>
            ) : null}

            {/* Muted — the crossed bell rides the preview line ahead of the
                count. The line is items-start (the @ mark and count ride the
                text's top edge), so the bell centers itself against the row
                instead. Notifications are off; unread messages still count. */}
            {isCommunityMuted(c) && (
              <span
                role="img"
                aria-label="Notifications muted"
                title="Notifications muted"
                className="inline-flex shrink-0 self-center items-center text-foreground-muted"
              >
                <BellOff strokeWidth={2.5} size={14} aria-hidden="true" />
              </span>
            )}

            {/* An event's chat stays pinned to the top of the list until its
                event date (see sidebar-order); the mark says why it's up
                there instead of leaving it a mystery. It follows the mute
                bell and hands the row to the count; the DP carries the same
                date as a calendar badge. */}
            {c.pinned_until && (
              <span
                role="img"
                aria-label="Pinned until the event"
                title="Pinned until the event"
                className="inline-flex shrink-0 self-center items-center text-foreground-muted"
              >
                <Pin strokeWidth={2.5} size={14} aria-hidden="true" />
              </span>
            )}

            {/* Unread count — messages plus unread threads/showcase posts/
                resources/events created by others. It closes the row's marks
                and wears the blue of the member's own messages, the same blue
                the timestamp takes (`SidebarTimestamp`). */}
            {hasUnread && (
              <span className="flex items-center justify-center p-1 min-w-[20px] h-[16px] rounded-full bg-[var(--ds-blue-800)] text-white font-mono text-[11px] leading-[10px] font-semibold shrink-0">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
});
