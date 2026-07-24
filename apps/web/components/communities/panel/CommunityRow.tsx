"use client";

import { CommunityAvatar } from "./CommunityAvatar";
import type { CachedSidebarCommunity } from "@/lib/communities/cache";

type Community = CachedSidebarCommunity;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Formats the last-message text shown below the community name. */
function formatPreview(msg: NonNullable<Community["last_message"]>): {
  prefix?: string;
  text: string;
  italic?: boolean;
} {
  const sender = msg.user?.name.split(" ")[0];
  if (msg.is_deleted) return { prefix: sender, text: "Message deleted", italic: true };
  if (msg.has_image && !msg.content) return { prefix: sender, text: "📷 Photo" };
  if (msg.is_reply) {
    const to = msg.reply_to_user ?? null;
    return {
      prefix: sender,
      text: to ? `replied to ${to}: ${msg.content}` : `↩ ${msg.content}`,
    };
  }
  return { prefix: sender, text: msg.content ?? "" };
}

interface CommunityRowProps {
  c: Community;
  active: boolean;
  /** If set, shown instead of the last-message preview. */
  typingText?: string;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function CommunityRow({
  c,
  active,
  typingText,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: CommunityRowProps) {
  const { lastReaction } = c;
  const preview = c.last_message ? formatPreview(c.last_message) : null;

  return (
    <li>
      <button
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
          active
            ? "bg-accent/10 border-l-2 border-l-accent"
            : "hover:bg-surface-raised border-l-2 border-l-transparent"
        }`}
      >
        <CommunityAvatar
          imageUrl={c.image_url}
          name={c.name}
          type={c.type}
          active={active}
        />

        <div className="flex-1 min-w-0">
          {/* Community name + timestamp */}
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <span className="font-body text-[13px] font-medium truncate text-foreground">
              {c.name}
            </span>
            {c.last_message && !typingText && (
              <span className="font-mono text-xs text-foreground-muted shrink-0">
                {timeAgo(c.last_message.created_at)}
              </span>
            )}
          </div>

          {/* Preview line */}
          <div className="flex items-center gap-1.5">
            {typingText ? (
              /* Typing — highest priority */
              <p className="font-body text-xs text-accent truncate flex-1 italic">
                {typingText}
              </p>

            ) : lastReaction ? (
              /* Reaction preview: "You reacted 👍 to: "message"" */
              <p className="font-body text-xs text-foreground-muted truncate flex-1">
                <span className="font-medium">{lastReaction.firstName}</span>
                {lastReaction.isOwn ? " reacted " : " reacted "}
                <span>{lastReaction.emoji}</span>
                {" to: "}
                <span className="italic">{lastReaction.messagePreview}</span>
              </p>

            ) : preview ? (
              /* Standard message preview */
              <p
                className={`font-body text-xs truncate flex-1 ${
                  preview.italic
                    ? "text-foreground-muted/60 italic"
                    : "text-foreground-muted"
                }`}
              >
                {preview.prefix && (
                  <span className="font-medium not-italic">{preview.prefix}: </span>
                )}
                {preview.text}
              </p>

            ) : (
              <p className="font-body text-xs text-foreground-muted/60 italic flex-1">
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
}
