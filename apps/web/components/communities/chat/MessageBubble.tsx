"use client";

import { Fragment, useState, useRef, useEffect, useCallback, memo } from "react";
import { ClockRegular, CheckmarkRegular, DismissRegular, ArrowClockwiseRegular, ProhibitedRegular } from "@fluentui/react-icons";
import { ChatAvatar } from "./ChatAvatar";
import { fmtTime, isEmojiOnly, splitEmojiClusters } from "./chatUtils";
import { MessageBubbleTail } from "./MessageBubbleTail";
import { AnimatedEmoji } from "./AnimatedEmoji";
import { MessageHoverActions } from "./MessageHoverActions";
import { MessageContent } from "./MessageText";

import type { CachedMessage, MessageDeletedByRole, MessageReaction, ReplyPreview } from "@/lib/communities/cache";
import { ModalPortal } from "@/components/ui/Modal";
import { userColorVar } from "@/lib/communities/user-color";
import { KIND_THEME } from "@/lib/communities/content-notifications";


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
}

const EMOJI_MESSAGE_SIZE = 48;

function ReplyBubble({
  reply,
  isMe,
  onReplyClick,
}: {
  reply: ReplyPreview;
  isMe: boolean;
  onReplyClick: (replyId: string) => void;
}) {
  // Reply names get the same per-user color as chat sender names — when the
  // parent author's id is known (live replies, replies to own messages).
  // History-built previews omit the id, so they fall back to neutral.
  const nameColor = reply.user_id ? userColorVar(reply.user_id) : undefined;
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onReplyClick(reply.id); }}
      className={`mt-1 mb-1 px-2.5 py-1.5 rounded-md border-l-2 text-left max-w-full cursor-pointer
        ${isMe
          ? "bg-black/20 border-white/20 hover:bg-black/30"
          : "bg-black/10 border-white/15 hover:bg-black/20"
        } transition-colors`}
    >
      <p
        className={`font-body text-[10px] font-semibold line-clamp-1 break-words ${isMe ? "text-accent-foreground opacity-80" : "text-foreground-muted"}`}
        style={nameColor && !isMe ? { color: nameColor } : undefined}
      >
        {reply.user_name}
      </p>
      <p className={`font-body text-[11px] line-clamp-2 break-words ${isMe ? "text-accent-foreground opacity-70" : "text-foreground-muted"}`}>
        {reply.content || "📷 Image"}
      </p>
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
}: {
  reply: NonNullable<CachedMessage["reply_to_content"]>;
  isMe: boolean;
  onReplyClick: (replyId: string) => void;
}) {
  // Same eyebrow label the card itself shows ("Thread", "Resource", …).
  const label = KIND_THEME[reply.kind].label;
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onReplyClick(reply.id); }}
      className={`mt-1 mb-1 px-2.5 py-1.5 rounded-md border-l-2 text-left max-w-full cursor-pointer
        ${isMe
          ? "bg-black/20 border-white/20 hover:bg-black/30"
          : "bg-black/10 border-white/15 hover:bg-black/20"
        } transition-colors`}
    >
      <p
        className={`font-body text-[10px] font-semibold line-clamp-1 break-words ${isMe ? "text-accent-foreground opacity-80" : "text-foreground-muted"}`}
      >
        {label}
      </p>
      <p className={`font-body text-[11px] line-clamp-2 break-words ${isMe ? "text-accent-foreground opacity-70" : "text-foreground-muted"}`}>
        {reply.title || label}
      </p>
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
function BubbleImage({
  url, isMe, uploading, onCancel, standalone = false, createdAt, status, onClick,
}: {
  url: string;
  isMe: boolean;
  uploading?: boolean;
  onCancel?: () => void;
  standalone?: boolean;
  createdAt?: string;
  status?: CachedMessage["status"];
  /** Opens the image in the full-screen viewer. */
  onClick?: () => void;
}) {
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
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
        className={`block max-w-full object-cover rounded-[8px] ${
          isMe ? "opacity-95" : ""
        } ${uploading ? "opacity-50" : ""} ${onClick ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}`}
        style={{ maxHeight: 300, width: "auto" }}
        loading="lazy"
        draggable={false}
      />
      {standalone && createdAt && !uploading && status !== "failed" && (
        <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5">
          <span className="font-mono text-[10px] text-white/90">
            {fmtTime(createdAt)}
          </span>
          {isMe && (
            <CheckmarkRegular fontSize={11} className="text-white/90" />
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
              <DismissRegular fontSize={14} />
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
        <ArrowClockwiseRegular fontSize={13} />
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

/** Colored sender-name row rendered inside bubbles, WhatsApp-style. */
function SenderName({ name, userId, className = "" }: { name: string; userId: string | null; className?: string }) {
  return (
    <p
      className={`font-body text-xs font-semibold leading-4 break-words ${className}`}
      style={{ color: userColorVar(userId) }}
    >
      {name}
    </p>
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
}) {
  return (
    // Stacked exactly like a live bubble — name row, message row, time row — so
    // a deleted message keeps the shape of the conversation around it instead of
    // cramming the sender, the placeholder and the timestamp onto one line.
    <div
      className={`relative w-fit select-none rounded-[10px] ${isFirstInGroup ? (isMe ? "rounded-tr-none" : "rounded-tl-none") : ""} px-3 pt-2 pb-1.5 shadow-sm
        ${isMe
          ? "bg-[var(--ds-blue-800)] [--color-accent-foreground:white]"
          : "bg-surface-raised"
        }`}
    >
      {isFirstInGroup && (
        <MessageBubbleTail
          side={isMe ? "right" : "left"}
          className={isMe ? "text-[var(--ds-blue-800)]" : "text-surface-raised"}
        />
      )}
      {!isMe && showHeader && senderName && (
        <SenderName name={senderName} userId={senderId ?? null} />
      )}
      <div className="flex items-center gap-1.5">
        <ProhibitedRegular fontSize={13} className={isMe ? "shrink-0 text-accent-foreground" : "shrink-0 text-foreground-muted"} />
        {/* leading-6 matches the live message text row, so a deleted placeholder
            occupies the same line box and the bubble keeps its rhythm. */}
        <span className={`font-body text-xs leading-6 ${isMe ? "text-accent-foreground" : "text-foreground-muted"}`}>
          {text}
        </span>
      </div>
      <div className="mt-0 flex items-center justify-end gap-1">
        <span className={`text-[10px] ${isMe ? "text-accent-foreground opacity-60" : "text-foreground-muted"}`}>
          {fmtTime(createdAt)}
        </span>
      </div>
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

  // ── Unified layout: own messages right-aligned, others left-aligned ──
  const showHeader = !isSameAuthor || isFirstUnread;

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
          isMe ? "justify-end" : "justify-start"
        } ${isSameAuthor && !isFirstUnread ? "mt-0.5" : "mt-3"}`}
      >
        {/* Avatar column — hidden for own messages */}
        {!isMe && (
          <div className="w-7 shrink-0">
            {showHeader && sender && (
              <ChatAvatar name={sender.name} url={sender.avatar_url} size={7} />
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
            />
          ) : isEmojiMsg ? (
            /* ── Big emoji — no bubble background ── */
            <div className={`flex items-center gap-1 ${isMe ? "flex-row-reverse" : ""}`}>
              <div
                className={`relative ${animate ? "chat-bubble-in" : ""}`}
                data-side={isMe ? "right" : "left"}
              >
                <div className="flex flex-col items-start select-none">
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
                  <div className="flex items-center gap-1 mt-0.5">
                    {msg.edited_at && (
                      <span className="font-body text-[10px] text-foreground-muted/60">edited</span>
                    )}
                    <span className="text-[10px] text-foreground-muted/70">
                      {fmtTime(msg.created_at)}
                    </span>
                    {isMe && msg.status === "sending" && (
                      <ClockRegular fontSize={10} className="text-foreground-muted/60 animate-pulse" />
                    )}
                    {isMe && (msg.status === "sent" || !msg.status) && (
                      <CheckmarkRegular fontSize={11} className="text-foreground-muted/70" />
                    )}
                    {isMe && msg.status === "failed" && (
                      <span className="text-[10px] text-red-400">!</span>
                    )}
                  </div>
                </div>
                <ReactionPills reactions={reactions} currentUserId={currentUserId} msgId={msg.id} onReaction={onReaction} />
              </div>
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
            <div className={`flex items-center gap-1 ${isMe ? "flex-row-reverse" : ""}`}>
              {failed && <RetryIndicator onRetry={() => onRetrySend(msg.id)} />}
                  {/* Entrance animation lives on this wrapper (not the bubble) so the
                      bubble's own state classes (e.g. failed) stay intact. */}
              <div
                className={`relative min-w-0 ${animate ? "chat-bubble-in" : ""}`}
                data-side={isMe ? "right" : "left"}
              >
                <div
                  className={`relative select-none rounded-[10px] ${
                    isFirstInGroup ? (isMe ? "rounded-tr-none" : "rounded-tl-none") : ""
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
                  }`}
                >
                  {isFirstInGroup && (
                    <MessageBubbleTail
                      side={isMe ? "right" : "left"}
                      className={isMe
                        ? msg.status === "failed"
                          ? "text-red-500/80"
                          : "text-[var(--ds-blue-800)]"
                        : "text-surface-raised"}
                    />
                  )}
                  {/* Sender name inside the bubble, WhatsApp-style — colored per
                      user (own messages skip it, matching WhatsApp). On media
                      bubbles the name carries its own padding since the bubble
                      only wraps the image with a thin frame. */}
                  {!isMe && showHeader && sender && (
                    <SenderName
                      name={sender.name}
                      userId={msg.user_id}
                      className={imageUrl ? "mb-1 pl-1" : ""}
                    />
                  )}
                  {replyTo && <ReplyBubble reply={replyTo} isMe={isMe} onReplyClick={onReplyClick} />}
                  {!replyTo && replyToContent && (
                    <ContentReplyBubble reply={replyToContent} isMe={isMe} onReplyClick={onReplyClick} />
                  )}
                  {imageUrl && (
                    <BubbleImage
                      url={imageUrl}
                      isMe={isMe}
                      uploading={uploading}
                      standalone={imageOnly}
                      createdAt={msg.created_at}
                      status={msg.status}
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
                  {!imageOnly && (
                    <div className={`flex items-center ml-4 justify-end gap-1 mt-0 ${imageUrl ? "pr-1" : ""}`}>
                      {msg.edited_at && (
                        <span className={`font-body text-[10px] ${isMe ? "text-accent-foreground opacity-50" : "text-foreground-muted"}`}>
                          edited
                        </span>
                      )}
                      <span className={`text-[10px] ${
                        isMe ? "text-accent-foreground opacity-60" : "text-foreground-muted"
                      }`}>
                        {fmtTime(msg.created_at)}
                      </span>
                      {isMe && msg.status === "sending" && (
                        <ClockRegular fontSize={10} className="text-accent-foreground opacity-60 animate-pulse" />
                      )}
                      {isMe && (msg.status === "sent" || !msg.status) && (
                        <CheckmarkRegular fontSize={11} className="text-accent-foreground opacity-70" />
                      )}
                      {isMe && msg.status === "failed" && (
                        <span className="text-[10px] text-red-200">!</span>
                      )}
                    </div>
                  )}
                </div>
                <ReactionPills reactions={reactions} currentUserId={currentUserId} msgId={msg.id} onReaction={onReaction} />
              </div>
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
