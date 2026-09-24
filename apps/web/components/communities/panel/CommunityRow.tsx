"use client";

import { memo, useRef, useCallback } from "react";
import { CommunityNameBadges } from "../CommunityBadges";
import { CommunityAvatar } from "./CommunityAvatar";
import { SidebarTimestamp } from "./SidebarTimestamp";
import { NotoEmojiSvg } from "../chat/NotoEmojiSvg";
import { emojiToCodepoint, svgUrlForCodepoint } from "@/lib/noto-emoji";
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

/** Render text with SVG emoji images for the sidebar preview. */
function renderTextWithEmoji(text: string) {
  if (!text) return text;
  const parts: React.ReactNode[] = [];
  const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;
  let lastIndex = 0;
  let match;
  while ((match = emojiRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={`t${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>);
    }
    const emoji = match[0];
    const cp = emojiToCodepoint(emoji);
    if (cp) {
      parts.push(
        <NotoEmojiSvg key={`e${match.index}`} emoji={emoji} size={13} className="align-middle" />
      );
    } else {
      parts.push(<span key={`e${match.index}`}>{emoji}</span>);
    }
    lastIndex = match.index + emoji.length;
  }
  if (lastIndex < text.length) {
    parts.push(<span key={`t${lastIndex}`}>{text.slice(lastIndex)}</span>);
  }
  return parts;
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
  const preview = c.last_message ? formatPreview(c.last_message) : null;
  // A thread/showcase/resource/event created after the newest message takes
  // over the preview line ("john created a thread") — mirroring the chat
  // timeline, where the same event renders as its own notification card. The
  // unread content items also raise the green badge below.
  const lastContent =
    c.last_content && contentIsNewerThanLastMessage(c.last_content, c)
      ? c.last_content
      : null;
  const contentPreview = lastContent ? formatContentPreview(lastContent) : null;

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
        className={`flex w-full items-start gap-[11px] rounded-lg px-[9px] py-[9px] text-left transition-colors ${
          active
            ? "bg-surface-raised text-foreground"
            : "hover:bg-surface-raised"
        }`}
      >
        <CommunityAvatar
          imageUrl={c.image_url}
          name={c.name}
          type={c.type}
        />

        <div className="flex-1 min-w-0">
          {/* Community name + timestamp */}
          <div className="flex items-center gap-1 mb-0.5 min-w-0">
            <span className="min-w-0 truncate font-body text-[14px] font-medium text-foreground">
              {c.name}
            </span>
            <CommunityNameBadges type={c.type} isPrivate={c.is_private} />
            {(c.last_message || lastContent) && !typingText && (
              <SidebarTimestamp
                iso={
                  !lastContent || (c.last_message && c.last_message.created_at > lastContent.created_at)
                    ? c.last_message!.created_at
                    : lastContent.created_at
                }
              />
            )}
          </div>

          {/* Meta: member count + city */}
          <div className="mb-0.5 flex items-center gap-1 font-body text-[11px] leading-none text-foreground-muted">
            <span> {fmtCount(c.member_count)} members</span>
            {c.type === "city" && c.reference_name && (
              <span>· {c.reference_name}</span>
            )}
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
                <span>{lastReaction.messagePreview}</span>
              </p>

            ) : preview ? (
              /* Standard message preview */
              <p className="font-body text-[13px] leading-5 truncate flex-1 text-foreground-muted">
                {preview.prefix && (
                  <span className="font-medium">{preview.prefix}: </span>
                )}
                {renderTextWithEmoji(preview.text)}
              </p>

            ) : (
              <p className="font-body text-[13px] text-foreground-muted flex-1">
                No messages yet
              </p>
            )}

            {/* Unread @mention mark — the same signal the chat's "@" pill
                gives once the community is open, surfaced here for the
                communities the member is not looking at. It is a plain mark:
                the number beside it is the community's normal unread count,
                not a mention tally. */}
            {c.mention_count ? (
              <span
                className="shrink-0 font-body text-[14px] font-bold leading-none text-accent"
                aria-label="You were mentioned in this community"
                title="You were mentioned in this community"
              >
                @
              </span>
            ) : null}

            {/* Unread badge — messages plus unread threads/showcase posts/
                resources/events created by others */}
            {c.message_count + (c.unread_content_count ?? 0) > 0 && !active && (
              <span className="flex items-center justify-center p-1 min-w-[20px] h-[16px] rounded-full bg-green-500 text-white font-mono text-[11px] leading-[10px] font-semibold shrink-0">
                {c.message_count + (c.unread_content_count ?? 0) > 99
                  ? "99+"
                  : c.message_count + (c.unread_content_count ?? 0)}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
});
