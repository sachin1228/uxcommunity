"use client";

import { Fragment, useState, useRef, useEffect, useCallback, memo } from "react";
import Link from "next/link";
import { Clock, CheckCheck, X, RefreshCw, Ban } from "lucide-react";
import { ChatAvatar } from "./ChatAvatar";
import { fmtTime, isEmojiOnly, splitEmojiClusters } from "./chatUtils";
import { MessageBubbleTail } from "./MessageBubbleTail";
import { AnimatedEmoji } from "./AnimatedEmoji";
import { MessageHoverActions } from "./MessageHoverActions";
import { MessageContent } from "./MessageText";
import {
  cachedChatMediaSize,
  chatMediaIntrinsicSize,
  rememberChatMediaSize,
} from "./mediaLayout";

import type { CachedMessage, MessageDeletedByRole, MessageReaction, ReplyPreview } from "@/lib/communities/cache";
import { ModalPortal } from "@/components/ui/Modal";
import { userColorVar } from "@/lib/communities/user-color";
import { KIND_THEME } from "@/lib/communities/content-notifications";
import { profileHref } from "@/lib/profile/links";


interface MessageBubbleProps {
  msg: CachedMessage;
  isMe: boolean;
  isSameAuthor: boolean;
  isFirstUnread: boolean;
  unreadDivider: React.ReactNode;
  currentUserId: string;
  highlighted: boolean;
  onReplyClick: (replyId: string) => void;
  onCancelSend: (msgId: string) => void;
  onRetrySend: (msgId: string) => void;
  onReaction: (msgId: string, emoji: string) => void;
  onReply: (msg: CachedMessage) => void;
  onEdit: (msg: CachedMessage) => void;
  onCopy: (msg: CachedMessage) => void;
  onDelete: (msgId: string, removedByRole: MessageDeletedByRole | null) => void;
  /** Opens the full-screen image viewer for a chat image URL. */
  onImageClick: (url: string) => void;
  /** Moderator (owner/admin with delete permission) may delete other members' messages. */
  canModerate?: boolean;
  /** Viewer's managing role when deleting someone else's message — names the role in the flow. */
  moderationRole?: MessageDeletedByRole | null;
  /** Play the entrance animation (bubble pop + word wave). Only for live arrivals. */
  animate?: boolean;
  /**
   * "community" — one left-aligned column: every bubble, own included, hangs
   * off the avatar rail, and the timestamp rides in the name row once per run.
   * "dm" — the classic two-sided layout (own messages right, time in a footer).
   */
  variant?: "dm" | "community";
}

const EMOJI_MESSAGE_SIZE = 48;

function ReplyBubble({
  reply,
  isMe,
  onReplyClick,
  topGap = false,
}: {
  reply: ReplyPreview;
  isMe: boolean;
  onReplyClick: (replyId: string) => void;
  /** Extra 2px above the quote when the sender name sits above it. */
  topGap?: boolean;
}) {
  // The quote wears the quoted author's chat color — including when you quote
  // yourself. Previews that predate the author id keep the neutral fallback.
  const nameColor = reply.user_id ? userColorVar(reply.user_id) : undefined;
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onReplyClick(reply.id); }}
      className={`flex ${topGap ? "mt-1.5" : "mt-1"} mb-1 pr-2.5 rounded-md text-left max-w-full cursor-pointer overflow-hidden
        ${isMe
          ? "bg-black/20 hover:bg-black/30"
          : "bg-black/10 hover:bg-black/20"
        } transition-colors`}
    >
      {/* WhatsApp's accent — full-height square bar, clipped into the corners.
          Wears the replied author's chat color even inside own bubbles, like mobile. */}
      <span
        aria-hidden
        className={`w-[4px] shrink-0 ${nameColor ? "" : isMe ? "bg-white/20" : "bg-white/15"}`}
        style={nameColor ? { backgroundColor: nameColor } : undefined}
      />
      <div className="flex-1 min-w-0 py-1.5 pl-[10px]">
        <p
          className={`font-body text-[10px] font-semibold line-clamp-1 break-words ${isMe ? `text-accent-foreground${nameColor ? "" : " opacity-80"}` : "text-foreground-muted"}`}
          style={nameColor ? { color: nameColor } : undefined}
        >
          {reply.user_name}
        </p>
        <p className={`font-body text-[11px] line-clamp-2 break-words ${isMe ? "text-accent-foreground opacity-70" : "text-foreground-muted"}`}>
          {reply.content || "📷 Image"}
        </p>
      </div>
    </div>
  );
}

/**
 * Reply preview for a "created a …" notification card (thread / showcase /
 * resource / event). Rendering matches ReplyBubble; the label makes the
 * anchor obvious, and clicking jumps to the card (data-content-id).
 */
function ContentReplyBubble({
  reply,
  isMe,
  onReplyClick,
  topGap = false,
}: {
  reply: NonNullable<CachedMessage["reply_to_content"]>;
  isMe: boolean;
  onReplyClick: (replyId: string) => void;
  /** Extra 2px above the quote when the sender name sits above it. */
  topGap?: boolean;
}) {
  // Same eyebrow label the card itself shows ("Thread", "Resource", …).
  const label = KIND_THEME[reply.kind].label;
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onReplyClick(reply.id); }}
      className={`flex ${topGap ? "mt-1.5" : "mt-1"} mb-1 pr-2.5 rounded-md text-left max-w-full cursor-pointer overflow-hidden
        ${isMe
          ? "bg-black/20 hover:bg-black/30"
          : "bg-black/10 hover:bg-black/20"
        } transition-colors`}
    >
      <span
        aria-hidden
        className={`w-[4px] shrink-0 ${isMe ? "bg-white/20" : "bg-white/15"}`}
      />
      <div className="flex-1 min-w-0 py-1.5 pl-[10px]">
        <p
          className={`font-body text-[10px] font-semibold line-clamp-1 break-words ${isMe ? "text-accent-foreground opacity-80" : "text-foreground-muted"}`}
        >
          {label}
        </p>
        <p className={`font-body text-[11px] line-clamp-2 break-words ${isMe ? "text-accent-foreground opacity-70" : "text-foreground-muted"}`}>
          {reply.title || label}
        </p>
      </div>
    </div>
  );
}

function ReactionPills({
  reactions,
  currentUserId,
  msgId,
  onReaction,
}: {
  reactions: MessageReaction[];
  currentUserId: string;
  msgId: string;
  onReaction: (msgId: string, emoji: string) => void;
}) {
  if (!reactions || reactions.length === 0) return null;

  return (
    <div className="absolute -bottom-[14px] left-3 mt-1 flex flex-wrap justify-start gap-1">
      {reactions.map(({ emoji, user_ids }) => {
        const iMine = user_ids.includes(currentUserId);
        return (
          <button
            key={emoji}
            onClick={(e) => { e.stopPropagation(); onReaction(msgId, emoji); }}
            title={iMine ? "Remove reaction" : undefined}
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] font-medium
              border transition-colors duration-100
              ${iMine
                ? "bg-[#2a2a2a] border border-black text-foreground"
                : "bg-[#2a2a2a] border border-black text-foreground hover:bg-[#333]"
              }`}
          >
            <AnimatedEmoji emoji={emoji} size={14} />
            {user_ids.length > 1 && (
              <span className="text-[10px] opacity-70">{user_ids.length}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Image rendered inside a message bubble. */
/**
 * Per-bubble timestamp footer — the classic layout's home for the time, still
 * used by direct messages. Community chat has no footer: its timestamp lives
 * in the name row that opens a run of messages.
 */
function BubbleTime({
  createdAt,
  status,
  editedAt,
  isMe,
  onPage = false,
  className = "",
}: {
  createdAt: string;
  status?: CachedMessage["status"];
  editedAt?: string | null;
  isMe: boolean;
  /** No bubble behind the row (emoji-only messages) — use page-toned colors. */
  onPage?: boolean;
  className?: string;
}) {
  const timeClass = onPage
    ? "text-foreground-muted/70"
    : isMe
      ? "text-accent-foreground opacity-60"
      : "text-foreground-muted";
  const editedClass = onPage
    ? "text-foreground-muted/60"
    : isMe
      ? "text-accent-foreground opacity-50"
      : "text-foreground-muted";
  return (
    <div className={`flex items-center justify-end gap-1 mt-0 ${className}`}>
      {editedAt && (
        <span className={`font-body text-[10px] ${editedClass}`}>edited</span>
      )}
      <span className={`text-[10px] ${timeClass}`}>{fmtTime(createdAt)}</span>
      {isMe && status === "sending" && (
        <Clock strokeWidth={2.5} size={10} className={`${timeClass} animate-pulse`} />
      )}
      {isMe && (status === "sent" || !status) && (
        <CheckCheck strokeWidth={2.5} size={11} className={timeClass} />
      )}
      {isMe && status === "failed" && (
        <span className={`text-[10px] ${onPage ? "text-red-400" : "text-red-200"}`}>!</span>
      )}
    </div>
  );
}

function BubbleImage({
  url, isMe, uploading, onCancel, standalone = false, createdAt, status, onClick,
}: {
  url: string;
  isMe: boolean;
  uploading?: boolean;
  onCancel?: () => void;
  standalone?: boolean;
  /** DM layout only: the time rides on the image instead of in a footer. */
  createdAt?: string;
  status?: CachedMessage["status"];
  /** Opens the image in the full-screen viewer. */
  onClick?: () => void;
}) {
  // A chat image has no dimensions in its row, so an unmeasured `<img>` is laid
  // out at the browser's 300 × 150 default and snaps to its real shape once the
  // bytes arrive — narrowing a portrait, then reflowing the caption below it.
  // The natural size is therefore read synchronously at mount (pages are warmed
  // before they are committed) and written into the width/height attributes,
  // which is what reserves the final box before the image decodes. A measured
  // value is latched: a late probe must never resize a bubble already on screen.
  const [measured, setMeasured] = useState(() => ({
    url,
    size: cachedChatMediaSize(url),
  }));
  // The source changes in place when an optimistic local preview is replaced
  // by its uploaded URL, so read the cache for the new URL during render rather
  // than painting one frame with the previous image's shape.
  const size = measured.url === url ? measured.size : cachedChatMediaSize(url);
  const intrinsic = chatMediaIntrinsicSize(size);

  return (
    <div
      className={`relative ${
        standalone
          ? ""
          : "mb-1"
      }`}
    >
      <div
        className={standalone
          ? // Media sits inside the bubble frame with a hair of its own
            // rounding (WhatsApp-style); the tail/bg come from the bubble.
            "relative overflow-hidden rounded-[8px]"
          : "relative"}
      >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Image"
        width={intrinsic.width}
        height={intrinsic.height}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
        onLoad={(e) => {
          const image = e.currentTarget;
          const { naturalWidth, naturalHeight } = image;
          if (naturalWidth <= 0 || naturalHeight <= 0) return;
          rememberChatMediaSize(url, naturalWidth, naturalHeight);
          // The first measurement of an unwarmed image is the only correction
          // this bubble ever makes; afterwards the cached size wins.
          if (!size) {
            setMeasured({
              url,
              size: { width: naturalWidth, height: naturalHeight },
            });
          }
        }}
        className={`block h-auto max-h-[300px] w-auto max-w-full rounded-[8px] bg-surface-raised object-cover ${
          isMe ? "opacity-95" : ""
        } ${uploading ? "opacity-50" : ""} ${onClick ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}`}
        loading="lazy"
        decoding="async"
        draggable={false}
      />
      {standalone && createdAt && !uploading && status !== "failed" && (
        <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5">
          <span className="font-mono text-[10px] text-white/90">
            {fmtTime(createdAt)}
          </span>
          {isMe && (
            <CheckCheck strokeWidth={2.5} size={11} className="text-white/90" />
          )}
        </div>
      )}
      {uploading && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl">
          <div className="relative w-12 h-12">
            <div className="absolute inset-0 rounded-full border-[3px] border-white/20 border-t-white animate-spin" />
            <button
              onClick={(e) => { e.stopPropagation(); onCancel?.(); }}
              className="absolute inset-0 flex items-center justify-center text-white"
              aria-label="Cancel upload"
            >
              <X strokeWidth={2.5} size={14} />
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

/** Retry button shown beside a failed bubble. */
function RetryIndicator({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-1 shrink-0 self-center">
      <button
        onClick={(e) => { e.stopPropagation(); onRetry(); }}
        className="h-7 w-7 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 active:scale-90 transition-all"
        aria-label="Retry sending"
        title="Tap to retry"
      >
        <RefreshCw strokeWidth={2.5} size={13} />
      </button>
      <span className="font-body text-[9px] text-red-400 leading-none">Retry</span>
    </div>
  );
}

/**
 * Confirmation dialog for "Delete for everyone".
 * Rendered as a fixed overlay so it sits above all message content.
 */
function DeleteConfirmDialog({
  moderationRole,
  onConfirm,
  onCancel,
}: {
  /** Set when a manager deletes someone else's message. Only admin/moderator
   *  name the role; the owner's delete stays worded as plain. */
  moderationRole: MessageDeletedByRole | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Close on backdrop click
  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { e.stopPropagation(); onCancel(); }}
    >
      <div
        className="modal-panel w-72 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-4 border-b border-white/[0.06]">
          <p className="font-body text-base font-semibold text-foreground text-center">
            Delete message?
          </p>
          <p className="font-body text-xs text-foreground-muted text-center mt-1">
            {moderationRole === "admin" || moderationRole === "moderator"
              ? `As ${moderationRole === "admin" ? "an admin" : "a moderator"}, this will delete the message for everyone in this chat.`
              : "This will delete the message for everyone in this chat."}
          </p>
        </div>

        <div className="flex flex-col">
          <button
            onClick={(e) => { e.stopPropagation(); onConfirm(); }}
            className="w-full px-5 py-3.5 font-body text-sm font-semibold text-red-400 hover:bg-white/[0.04] active:bg-white/[0.08] transition-colors text-center"
          >
            Delete for everyone
          </button>
          <div className="h-px bg-white/[0.06]" />
          <button
            onClick={(e) => { e.stopPropagation(); onCancel(); }}
            className="w-full px-5 py-3.5 font-body text-sm text-foreground-muted hover:bg-white/[0.04] active:bg-white/[0.08] transition-colors text-center"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

/** Colored sender-name row rendered inside bubbles, WhatsApp-style. Opens the
 *  sender's profile when `href` is given (everyone but the viewer / tombstones
 *  without a sender id render as plain text). */
function SenderName({
  name,
  userId,
  href,
  className = "",
}: {
  name: string;
  userId: string | null;
  href?: string | null;
  className?: string;
}) {
  const text = href ? (
    <Link href={href} className="hover:underline">
      {name}
    </Link>
  ) : (
    name
  );
  return (
    <p
      className={`font-body text-xs font-semibold leading-4 break-words ${className}`}
      style={{ color: userColorVar(userId) }}
    >
      {text}
    </p>
  );
}

/**
 * The name + time row that opens a sender's run of messages.
 *
 * Community chat is a single left-aligned column — every bubble, including
 * your own, hangs off the avatar rail — so the timestamp lives here, once per
 * run, instead of in a footer on every bubble. Own messages say "You" and
 * carry their delivery state beside the time, because the footer they used to
 * live in is gone.
 */
function MessageHeader({
  name,
  userId,
  href,
  isMe,
  createdAt,
  status,
  editedAt,
  onPage = false,
  className = "",
}: {
  name: string;
  userId: string | null;
  href?: string | null;
  isMe: boolean;
  createdAt: string;
  status?: CachedMessage["status"];
  editedAt?: string | null;
  /** No bubble behind the row (emoji-only messages) — use page-toned colors. */
  onPage?: boolean;
  className?: string;
}) {
  const ownNameClass = onPage ? "text-foreground" : "text-accent-foreground";
  const metaClass = onPage
    ? "text-foreground-muted"
    : isMe
      ? "text-accent-foreground opacity-60"
      : "text-foreground-muted";
  return (
    <div className={`mb-0.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0 ${className}`}>
      {isMe ? (
        <p className={`font-body text-xs font-semibold leading-4 ${ownNameClass}`}>You</p>
      ) : (
        <SenderName name={name} userId={userId} href={href} />
      )}
      <span className={`text-[10px] ${metaClass}`}>{fmtTime(createdAt)}</span>
      {editedAt && (
        <span className={`font-body text-[10px] ${metaClass}`}>edited</span>
      )}
      {/* Community chat keeps delivery ticks out of this row — the in-flight
          clock sits beside the bubble instead (same slot for every send); a
          failed send ends with "!". */}
      {isMe && status === "failed" && (
        <span className={`text-[10px] ${onPage ? "text-red-400" : "text-red-200"}`}>!</span>
      )}
    </div>
  );
}

/**
 * Tombstone copy. Author deletes keep the WhatsApp-style "deleted"; a manager
 * removing someone else's message is attributed Reddit-style ("removed by a
 * moderator"), so members can tell moderation from a friend's own cleanup.
 */
function deletedMessageText(msg: CachedMessage, viewerId: string): string {
  const role = msg.deleted_by_role;
  if (role) {
    if (msg.deleted_by === viewerId) return "You removed this message";
    const byline =
      role === "admin" ? "an admin" : role === "owner" ? "the owner" : "a moderator";
    return `This message was removed by ${byline}`;
  }
  return msg.user_id === viewerId ? "You deleted this message" : "This message was deleted";
}

/** Placeholder shown for soft-deleted messages. */
function DeletedBubble({
  isMe,
  text,
  createdAt,
  isFirstInGroup,
  showHeader,
  senderName,
  senderId,
  leftRail = true,
}: {
  isMe: boolean;
  /** Tombstone copy from deletedMessageText — attributed when a manager acted. */
  text: string;
  createdAt: string;
  isFirstInGroup: boolean;
  /** Same rule as a live bubble — the name row only opens a run of messages. */
  showHeader: boolean;
  senderName?: string | null;
  senderId?: string | null;
  /** Community layout: tail/rounding on the left and the time in the header. */
  leftRail?: boolean;
}) {
  const alignRight = !leftRail && isMe;
  return (
    // Stacked exactly like a live bubble — header row, message row — so a
    // deleted message keeps the shape of the conversation around it instead of
    // cramming the sender, the placeholder and the timestamp onto one line.
    <div
      className={`relative w-fit select-none rounded-[10px] ${isFirstInGroup ? (alignRight ? "rounded-tr-none" : "rounded-tl-none") : ""} px-3 pt-2 pb-1.5 shadow-sm
        ${isMe
          ? "bg-[var(--ds-blue-800)] [--color-accent-foreground:white]"
          : "bg-surface-raised"
        }`}
    >
      {isFirstInGroup && (
        <MessageBubbleTail
          side={alignRight ? "right" : "left"}
          className={isMe ? "text-[var(--ds-blue-800)]" : "text-surface-raised"}
        />
      )}
      {leftRail
        ? showHeader && (isMe || senderName) && (
            <MessageHeader
              name={senderName ?? "Member"}
              userId={senderId ?? null}
              href={!isMe && senderId ? profileHref(senderId) : null}
              isMe={isMe}
              createdAt={createdAt}
            />
          )
        : !isMe && showHeader && senderName && (
            <SenderName
              name={senderName}
              userId={senderId ?? null}
              href={senderId ? profileHref(senderId) : null}
            />
          )}
      <div className="flex items-center gap-1.5">
        <Ban strokeWidth={2.5} size={13} className={isMe ? "shrink-0 text-accent-foreground" : "shrink-0 text-foreground-muted"} />
        {/* leading-6 matches the live message text row, so a deleted placeholder
            occupies the same line box and the bubble keeps its rhythm. */}
        <span className={`font-body text-xs leading-6 ${isMe ? "text-accent-foreground" : "text-foreground-muted"}`}>
          {text}
        </span>
      </div>
      {!leftRail && (
        <BubbleTime
          createdAt={createdAt}
          status={undefined}
          isMe={isMe}
        />
      )}
    </div>
  );
}

/**
 * Memoized so a parent re-render (typing in the input, the 1s typing-indicator
 * tick, presence updates) doesn't re-render every bubble in the chat — the
 * handlers are useCallback-stable and message objects are referentially
 * stable, so unchanged bubbles bail out of reconciliation entirely.
 */
export const MessageBubble = memo(function MessageBubble({
  msg,
  isMe,
  isSameAuthor,
  isFirstUnread,
  unreadDivider,
  currentUserId,
  highlighted,
  onReplyClick,
  onCancelSend,
  onRetrySend,
  onReaction,
  onReply,
  onEdit,
  onCopy,
  onDelete,
  onImageClick,
  canModerate = false,
  moderationRole = null,
  animate = false,
  variant = "community",
}: MessageBubbleProps) {
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const sender    = msg.users;
  const reactions = msg.reactions ?? [];
  const replyTo   = msg.reply_to ?? null;
  const replyToContent = msg.reply_to_content ?? null;
  const imageUrl  = msg.image_url ?? null;
  const uploading = msg.status === "sending" && !!imageUrl;
  const failed    = msg.status === "failed";
  const isDeleted = !!msg.deleted_at;
  const imageOnly = !!imageUrl && !msg.content && !replyTo && !replyToContent;

  // Show as large bubble-free emoji when the entire message is 1–3 emoji
  // glyphs. Each glyph renders on its own — a two- or three-emoji message is
  // not one codepoint, so handing the whole string to the emoji asset layer
  // misses every file and drops to static system glyphs that wrap.
  const isEmojiMsg =
    !isDeleted &&
    !imageUrl &&
    !replyTo &&
    !replyToContent &&
    !!msg.content &&
    isEmojiOnly(msg.content);
  const emojiGlyphs = isEmojiMsg ? splitEmojiClusters(msg.content ?? "") : [];

  // Inline style: Tailwind does not emit color-mix() for arbitrary CSS-var
  // utilities with an opacity modifier (bg-[var(--x)]/25 never compiles), so
  // the translucent blue row flash is applied directly.
  const rowHighlightStyle: React.CSSProperties | undefined = highlighted
    ? {
        backgroundColor:
          "color-mix(in srgb, var(--ds-blue-800) 25%, transparent)",
      }
    : undefined;
  const isFirstInGroup = !isSameAuthor;

  // Wave length for the entrance animation — the hover action buttons (and
  // "Read more") wait for the last word before they can appear.
  const waveIndex =
    animate && msg.content
      ? Math.min(msg.content.trim().split(/\s+/).filter(Boolean).length, 24)
      : 0;

  // Deleting your own message is never a moderation act, so the role only
  // applies to someone else's — the menu item, the dialog and the tombstone
  // the server stores all agree on it.
  const deleteAsRole = isMe ? null : moderationRole;

  const handleDeleteConfirm = () => {
    setDeleteConfirmOpen(false);
    onDelete(msg.id, deleteAsRole);
  };

  const showHeader = !isSameAuthor || isFirstUnread;
  // Community rooms read as one column (every bubble on the avatar rail, own
  // included); direct messages keep the two-sided layout.
  const leftRail = variant === "community";
  const alignRight = !leftRail && isMe;

  // Your own text message, still in flight: the bubble fades and a pulsing
  // clock sits just outside it. Image and GIF sends keep their in-bubble upload
  // spinner, and direct messages keep the footer clock they always had.
  const sendingText =
    leftRail && isMe && msg.status === "sending" && !imageUrl;
  // One position for every send, whether or not the message opens a run: the
  // clock never rides inside the bubble (a header clock would disappear for
  // the second and third message of a run).
  const sendingClock =
    sendingText ? (
      <button
        type="button"
        onClick={() => onCancelSend(msg.id)}
        aria-label="Cancel sending"
        title="Sending — click to cancel"
        className="flex h-7 w-7 shrink-0 items-center justify-center self-center rounded-full text-foreground-muted transition-colors hover:text-foreground"
      >
        <Clock strokeWidth={2.5} size={12} className="animate-pulse" />
      </button>
    ) : null;

  // Long-press (touch) opens the same menu as the hover "more" button —
  // touch users had no way to reach reply/copy/delete/reactions at all.
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartRef.current = null;
  }, []);
  useEffect(() => clearLongPress, [clearLongPress]);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        touchStartRef.current = null;
        setMenuOpen(true);
      }, 500);
    },
    [],
  );
  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const start = touchStartRef.current;
    const touch = e.touches[0];
    if (start && touch && (Math.abs(touch.clientX - start.x) > 10 || Math.abs(touch.clientY - start.y) > 10)) {
      // Scrolling — cancel the long-press so it never fires mid-swipe.
      clearLongPress();
    }
  }, [clearLongPress]);
  const onTouchEnd = useCallback(() => clearLongPress(), [clearLongPress]);

  return (
    <Fragment>
      {unreadDivider}
      {deleteConfirmOpen && (
        <DeleteConfirmDialog
          moderationRole={deleteAsRole}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      )}
      <div
        data-message-id={msg.id}
        style={rowHighlightStyle}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        className={`group flex w-full items-start gap-2 px-5 transition-colors duration-300 ${
          alignRight ? "justify-end" : "justify-start"
        } ${isSameAuthor && !isFirstUnread ? "mt-0.5" : "mt-3"}`}
      >
        {/* Avatar rail — every author hangs off the left, own messages
            included (community chat is one column, like a group thread).
            Direct messages hide it for your own bubbles, as before. */}
        {(leftRail || !isMe) && (
        <div className="w-7 shrink-0">
          {showHeader && (
            msg.user_id ? (
              <Link
                href={profileHref(msg.user_id)}
                title={sender?.name ?? (isMe ? "You" : "Member")}
                className="block w-fit rounded-full transition-opacity hover:opacity-85"
              >
                <ChatAvatar
                  name={sender?.name ?? (isMe ? "You" : "Member")}
                  url={sender?.avatar_url ?? null}
                  size={7}
                />
              </Link>
            ) : (
              <ChatAvatar
                name={sender?.name ?? (isMe ? "You" : "Member")}
                url={sender?.avatar_url ?? null}
                size={7}
              />
            )
          )}
        </div>
        )}

        {/* Content column */}
        <div className="min-w-0 max-w-[65%]">
          {isDeleted ? (
            <DeletedBubble
              isMe={isMe}
              text={deletedMessageText(msg, currentUserId)}
              createdAt={msg.created_at}
              isFirstInGroup={isFirstInGroup}
              showHeader={showHeader}
              senderName={sender?.name}
              senderId={msg.user_id}
              leftRail={leftRail}
            />
          ) : isEmojiMsg ? (
            /* ── Big emoji — no bubble background ── */
            <div className={`flex items-center gap-1 ${alignRight ? "flex-row-reverse" : ""}`}>
              <div
                className={`relative ${animate ? "chat-bubble-in" : ""}`}
                data-side={alignRight ? "right" : "left"}
              >
                <div className="flex flex-col items-start select-none">
                  {/* Emoji-only messages have no bubble behind them, so the
                      name row sits straight on the chat background. */}
                  {leftRail && showHeader && (
                    <MessageHeader
                      name={sender?.name ?? "Member"}
                      userId={msg.user_id}
                      href={!isMe && msg.user_id ? profileHref(msg.user_id) : null}
                      isMe={isMe}
                      createdAt={msg.created_at}
                      status={msg.status}
                      editedAt={msg.edited_at}
                      onPage
                      className="mb-1"
                    />
                  )}
                  {/* One row, never wrapped — 2–3 emoji stay big and side by
                      side, each animating on its own. */}
                  <div className="flex flex-nowrap items-center gap-0.5">
                    {emojiGlyphs.map((glyph, i) => (
                      <AnimatedEmoji
                        key={`${glyph}-${i}`}
                        emoji={glyph}
                        size={EMOJI_MESSAGE_SIZE}
                        className="shrink-0"
                      />
                    ))}
                  </div>
                  {!leftRail && (
                    <BubbleTime
                      createdAt={msg.created_at}
                      status={msg.status}
                      editedAt={msg.edited_at}
                      isMe={isMe}
                      onPage
                    />
                  )}
                </div>
                <ReactionPills reactions={reactions} currentUserId={currentUserId} msgId={msg.id} onReaction={onReaction} />
              </div>
              {sendingClock}
              <MessageHoverActions
                msg={msg}
                isMe={isMe}
                isDeleted={isDeleted}
                currentUserId={currentUserId}
                onReaction={onReaction}
                onReply={onReply}
                onEdit={onEdit}
                onCopy={onCopy}
                onDeleteClick={() => setDeleteConfirmOpen(true)}
                menuOpen={menuOpen}
                onMenuOpenChange={setMenuOpen}
                canModerate={canModerate}
                moderationRole={deleteAsRole}
                animate={animate}
                waveIndex={waveIndex}
              />
            </div>
          ) : (
            /* ── Normal bubble ── */
            <div className={`flex items-center gap-1 ${alignRight ? "flex-row-reverse" : ""}`}>
              {failed && <RetryIndicator onRetry={() => onRetrySend(msg.id)} />}
                  {/* Entrance animation lives on this wrapper (not the bubble) so the
                      bubble's own state classes (e.g. failed) stay intact. */}
              <div
                className={`relative min-w-0 ${animate ? "chat-bubble-in" : ""}`}
                data-side={alignRight ? "right" : "left"}
              >
                <div
                  className={`relative select-none rounded-[10px] ${
                    isFirstInGroup ? (alignRight ? "rounded-tr-none" : "rounded-tl-none") : ""
                  } shadow-sm ${
                    isMe
                      ? msg.status === "failed"
                        ? "bg-red-500/80"
                        : "bg-[var(--ds-blue-800)] [--color-accent-foreground:white]"
                      : "bg-surface-raised"
                  } ${
                    // Media bubbles keep a thin frame around the image
                    // (WhatsApp-style); text-only bubbles use the roomier padding.
                    imageUrl ? "p-1" : "px-3 pt-2 pb-1.5"
                  } ${
                    // An in-flight own message reads as pending at a glance —
                    // full colour returns under the pointer so it stays legible.
                    sendingText
                      ? "opacity-[0.55] transition-opacity group-hover:opacity-100"
                      : ""
                  }`}
                >
                  {isFirstInGroup && (
                    <MessageBubbleTail
                      side={alignRight ? "right" : "left"}
                      className={isMe
                        ? msg.status === "failed"
                          ? "text-red-500/80"
                          : "text-[var(--ds-blue-800)]"
                        : "text-surface-raised"}
                    />
                  )}
                  {/* Name + time, once per run of messages — own bubbles
                      included (they say "You" and carry the delivery state
                      beside the timestamp). On media bubbles the header keeps
                      its own padding since the bubble only wraps the image
                      with a thin frame. */}
                  {leftRail
                    ? showHeader && (isMe || sender) && (
                        <MessageHeader
                          name={sender?.name ?? "Member"}
                          userId={msg.user_id}
                          href={!isMe && msg.user_id ? profileHref(msg.user_id) : null}
                          isMe={isMe}
                          createdAt={msg.created_at}
                          status={msg.status}
                          editedAt={msg.edited_at}
                          className={imageUrl ? "mb-1 pl-1" : ""}
                        />
                      )
                    : !isMe && showHeader && sender && (
                        <SenderName
                          name={sender.name}
                          userId={msg.user_id}
                          href={msg.user_id ? profileHref(msg.user_id) : null}
                          className={imageUrl ? "mb-1 pl-1" : ""}
                        />
                      )}
                  {replyTo && (
                    <ReplyBubble
                      reply={replyTo}
                      isMe={isMe}
                      onReplyClick={onReplyClick}
                      topGap={leftRail ? showHeader : !alignRight && showHeader && !!sender}
                    />
                  )}
                  {!replyTo && replyToContent && (
                    <ContentReplyBubble
                      reply={replyToContent}
                      isMe={isMe}
                      onReplyClick={onReplyClick}
                      topGap={leftRail ? showHeader : !alignRight && showHeader && !!sender}
                    />
                  )}
                  {imageUrl && (
                    <BubbleImage
                      url={imageUrl}
                      isMe={isMe}
                      uploading={uploading}
                      standalone={imageOnly}
                      createdAt={leftRail ? undefined : msg.created_at}
                      status={leftRail ? undefined : msg.status}
                      onCancel={() => onCancelSend(msg.id)}
                      onClick={() => onImageClick(imageUrl)}
                    />
                  )}
                  {msg.content && (
                    <div className={imageUrl ? "pl-1" : ""}>
                      <MessageContent
                        content={msg.content}
                        mentions={msg.mentions ?? []}
                        isMe={isMe}
                        showPreview={msg.status !== "failed"}
                        animate={animate}
                      />
                    </div>
                  )}
                  {!leftRail && !imageOnly && (
                    <BubbleTime
                      createdAt={msg.created_at}
                      status={msg.status}
                      editedAt={msg.edited_at}
                      isMe={isMe}
                      className={imageUrl ? "pr-1" : ""}
                    />
                  )}
                </div>
                <ReactionPills reactions={reactions} currentUserId={currentUserId} msgId={msg.id} onReaction={onReaction} />
              </div>
              {sendingClock}
              {/* Emoji reaction + more-actions buttons to the right of bubble */}
              <MessageHoverActions
                msg={msg}
                isMe={isMe}
                isDeleted={isDeleted}
                currentUserId={currentUserId}
                onReaction={onReaction}
                onReply={onReply}
                onEdit={onEdit}
                onCopy={onCopy}
                onDeleteClick={() => setDeleteConfirmOpen(true)}
                menuOpen={menuOpen}
                onMenuOpenChange={setMenuOpen}
                canModerate={canModerate}
                moderationRole={deleteAsRole}
                animate={animate}
                waveIndex={waveIndex}
              />
            </div>
          )}
          {reactions.length > 0 && !isDeleted && <div className="h-5" />}
        </div>
      </div>
    </Fragment>
  );
});
