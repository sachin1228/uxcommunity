"use client";

import { memo, useRef, useCallback } from "react";
import { Lock } from "lucide-react";
import { CommunityAvatar } from "./CommunityAvatar";
import { NotoEmojiSvg } from "../chat/NotoEmojiSvg";
import { emojiToCodepoint, svgUrlForCodepoint } from "@/lib/noto-emoji";
import type { CachedSidebarCommunity } from "@/lib/communities/cache";

type Community = CachedSidebarCommunity;

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000).toFixed(1)}M`;
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

/** Absolute time — mirrors the mobile app: clock for today, "Yesterday",
 *  weekday within the last week, then a short date. */
function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0)
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Formats the last-message text shown below the community name. */
function formatPreview(msg: NonNullable<Community["last_message"]>): {
  prefix?: string;
  text: string;
} {
  const sender = msg.is_own
    ? "You"
    : msg.user?.name
      ? msg.user.name.split(" ")[0]
      : "Someone";
  if (msg.is_deleted) return { prefix: sender, text: "Message deleted" };
  if (msg.has_image && !msg.content) return { prefix: sender, text: "📷 Photo" };
  if (msg.is_reply) {
    const to = msg.reply_to_user ?? null;
    return {
      prefix: sender,
      text: to ? `replied to ${to}: ${msg.content}` : `replied: ${msg.content}`,
    };
  }
  return { prefix: sender, text: msg.content ?? "" };
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
          lottieUrl={c.lottie_url}
          lottieFormat={c.lottie_format}
          lottieData={c.lottie_data}
        />

        <div className="flex-1 min-w-0">
          {/* Community name + timestamp */}
          <div className="flex items-center gap-1 mb-0.5 min-w-0">
            <span className="min-w-0 truncate font-body text-[14px] font-medium text-foreground">
              {c.name}
            </span>
            {c.is_private && (
              <Lock size={11} className="shrink-0 text-foreground-muted" aria-label="Private community" />
            )}
            {c.last_message && !typingText && (
              <span className="font-mono text-xs text-foreground-muted shrink-0 ml-auto">
                {formatTime(c.last_message.created_at)}
              </span>
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

            ) : lastReaction ? (
              /* Reaction preview: "You reacted 👍 to: "message"" */
              <p className="font-body text-[13px] text-foreground-muted truncate flex-1">
                <span className="font-medium">{lastReaction.firstName}</span>
                {lastReaction.isOwn ? " reacted " : " reacted "}
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

            {/* Unread badge */}
            {c.message_count > 0 && !active && (
              <span className="flex items-center justify-center p-1 min-w-[20px] h-[16px] rounded-full bg-green-500 text-white font-mono text-[11px] leading-[10px] font-semibold shrink-0">
                {c.message_count > 99 ? "99+" : c.message_count}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
});
