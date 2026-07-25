"use client";

import { Fragment, useState, useRef, useEffect } from "react";
import { Clock, CheckCheck, X, RefreshCw, Reply, Copy, Smile, Trash2, Ban, MoreHorizontal } from "lucide-react";
import { ChatAvatar } from "./ChatAvatar";
import { fmtTime } from "./chatUtils";
import type { CachedMessage, MessageReaction, ReplyPreview } from "@/lib/communities/cache";
import { LinkPreview } from "./LinkPreview";
import { extractFirstUrl } from "@/lib/communities/linkPreview";
import { DropdownMenu } from "@/components/ui/DropdownMenu";


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
  onCopy: (msg: CachedMessage) => void;
  onDelete: (msgId: string) => void;
}

const REACTIONS = [
  { emoji: "❤️", label: "Love",    bg: "bg-red-500"    },
  { emoji: "👍", label: "Like",    bg: "bg-green-500"  },
  { emoji: "👎", label: "Dislike", bg: "bg-orange-500" },
  { emoji: "😮", label: "Wow",     bg: "bg-purple-500" },
  { emoji: "🔥", label: "Fire",    bg: "bg-blue-500"   },
];

const EMOJI_MESSAGE_SIZE = 32;

function ReplyBubble({
  reply,
  isMe,
  onReplyClick,
}: {
  reply: ReplyPreview;
  isMe: boolean;
  onReplyClick: (replyId: string) => void;
}) {
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onReplyClick(reply.id); }}
      className={`mb-1 px-2.5 py-1.5 rounded-xl border-l-2 text-left max-w-full cursor-pointer
        ${isMe
          ? "bg-black/20 border-white/20 hover:bg-black/30"
          : "bg-black/10 border-white/15 hover:bg-black/20"
        } transition-colors`}
    >
      <p className={`font-body text-[10px] font-semibold truncate ${isMe ? "text-accent-foreground/80" : "text-foreground-muted"}`}>
        {reply.user_name}
      </p>
      <p className={`font-body text-[11px] truncate ${isMe ? "text-accent-foreground/70" : "text-foreground-muted"}`}>
        {reply.content || "📷 Image"}
      </p>
    </div>
  );
}

function ReactionPills({
  reactions,
  currentUserId,
  isMe,
  msgId,
  onReaction,
}: {
  reactions: MessageReaction[];
  currentUserId: string;
  isMe: boolean;
  msgId: string;
  onReaction: (msgId: string, emoji: string) => void;
}) {
  if (!reactions || reactions.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-1 mt-1 absolute -bottom-[14px] left-[12px] ${isMe ? "justify-end" : "justify-start"}`}>
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
            {emoji}
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
  url, isMe, uploading, onCancel,
}: {
  url: string; isMe: boolean; uploading?: boolean; onCancel?: () => void;
}) {
  return (
    <div className="relative mb-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Image"
        className={`block max-w-full rounded-xl object-cover ${isMe ? "opacity-95" : ""} ${uploading ? "opacity-50" : ""}`}
        style={{ maxHeight: 300, width: "auto" }}
        loading="lazy"
      />
      {uploading && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl">
          <div className="relative w-12 h-12">
            <div className="absolute inset-0 rounded-full border-[3px] border-white/20 border-t-white animate-spin" />
            <button
              onClick={(e) => { e.stopPropagation(); onCancel?.(); }}
              className="absolute inset-0 flex items-center justify-center text-white"
              aria-label="Cancel upload"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
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
        <RefreshCw size={13} />
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
  isMe,
  onConfirm,
  onCancel,
}: {
  isMe: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Close on backdrop click
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { e.stopPropagation(); onCancel(); }}
    >
      <div
        className="bg-[#1c1c1e] border border-white/[0.08] rounded-2xl shadow-2xl w-72 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-4 border-b border-white/[0.06]">
          <p className="font-body text-base font-semibold text-foreground text-center">
            Delete message?
          </p>
          <p className="font-body text-xs text-foreground-muted text-center mt-1">
            This will delete the message for everyone in this chat.
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
  );
}

/**
 * Side action buttons that appear beside the message bubble on hover.
 * Shows: Emoji reaction (opens picker above bubble) + a menu for Reply, Copy,
 * and Delete (own messages).
 */
function MessageHoverActions({
  msg,
  isMe,
  isDeleted,
  currentUserId,
  onReaction,
  onReply,
  onCopy,
  onDeleteClick,
  menuOpen,
  onMenuOpenChange,
  showReaction = true,
  showMenu = true,
  insideBubble = false,
  dotsVisible = false,
}: {
  msg: CachedMessage;
  isMe: boolean;
  isDeleted: boolean;
  currentUserId: string;
  onReaction: (msgId: string, emoji: string) => void;
  onReply: (msg: CachedMessage) => void;
  onCopy: (msg: CachedMessage) => void;
  onDeleteClick: () => void;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  showReaction?: boolean;
  showMenu?: boolean;
  insideBubble?: boolean;
  /** Controls three-dot button visibility when insideBubble=true (proximity-based). */
  dotsVisible?: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerBtnRef = useRef<HTMLButtonElement>(null);
  const myEmoji = msg.reactions?.find((r) => r.user_ids.includes(currentUserId))?.emoji;
  const canCopy = !!msg.content && !isDeleted;

  // Close picker when clicking outside
  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [pickerOpen]);

  // No actions on deleted or still-sending messages
  if (isDeleted || msg.status === "sending") return null;

  return (
    <div
      className={
        insideBubble
          ? "contents"
          : "flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity duration-150"
      }
    >
      {/* Emoji reaction button — only for non-deleted messages */}
      {showReaction && !isDeleted && (
        <div className="relative" ref={pickerRef}>
          {pickerOpen && (
            <div
              className="absolute bottom-full mb-2 z-40 left-1/2 -translate-x-1/2
                flex items-center gap-0.5
                bg-[#1c1c1e] border border-white/[0.08] rounded-2xl shadow-2xl px-1.5 py-1
                animate-in fade-in slide-in-from-bottom-2 duration-150"
            >
              {REACTIONS.map(({ emoji, label, bg }) => {
                const isActive = myEmoji === emoji;
                return (
                  <button
                    key={label}
                    onClick={(e) => {
                      e.stopPropagation();
                      onReaction(msg.id, emoji);
                      setPickerOpen(false);
                    }}
                    className={`
                      w-8 h-8 rounded-full flex items-center justify-center text-base
                      transition-transform duration-100 hover:scale-125 active:scale-90
                      ${isActive
                        ? `${bg} ring-2 ring-white/50 ring-offset-1 ring-offset-[#1c1c1e]`
                        : "hover:bg-white/10"
                      }
                    `}
                    aria-label={`${isActive ? "Remove" : "Add"} ${label} reaction`}
                    title={label}
                  >
                    {emoji}
                  </button>
                );
              })}
            </div>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setPickerOpen((v) => !v); }}
            className={`
              w-7 h-7 rounded-full flex items-center justify-center
              transition-colors duration-100
              ${pickerOpen
                ? "bg-white/15 text-foreground"
                : "text-foreground-muted hover:text-foreground hover:bg-white/10"
              }
            `}
            aria-label="React to message"
            title="React"
          >
            <Smile size={14} />
          </button>
        </div>
      )}

      {/* Reply, copy, and delete menu */}
      {showMenu && (
      <div className={insideBubble ? "absolute top-1 right-1 z-30" : "relative"}>
        <button
          ref={triggerBtnRef}
          onClick={(e) => { e.stopPropagation(); onMenuOpenChange(!menuOpen); }}
          className={`
            w-7 h-7 rounded-full flex items-center justify-center
            ${insideBubble
              ? (dotsVisible || menuOpen)
                ? "opacity-100 pointer-events-auto"
                : "opacity-0 pointer-events-none"
              : ""}
            transition-opacity duration-150
            transition-colors duration-100
            ${isMe
              ? menuOpen
                ? "bg-white/20 text-white"
                : "text-white/90 hover:text-white hover:bg-white/15"
              : menuOpen
                ? "bg-black/10 text-foreground dark:bg-white/15"
                : "text-foreground/80 hover:text-foreground hover:bg-black/10 dark:hover:bg-white/10"
            }
          `}
          aria-label="More message actions"
          aria-expanded={menuOpen}
          title="More actions"
        >
          <MoreHorizontal size={14} strokeWidth={2.5} />
        </button>

        {/* Portal dropdown — renders at document.body, above all stacking contexts */}
        <DropdownMenu
          triggerRef={triggerBtnRef}
          open={menuOpen}
          onClose={() => onMenuOpenChange(false)}
          align="right"
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onReply(msg);
              onMenuOpenChange(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-foreground hover:bg-white/[0.08] transition-colors"
            role="menuitem"
          >
            <Reply size={14} className="text-foreground-muted shrink-0" />
            <span>Reply</span>
          </button>

          {canCopy && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCopy(msg);
                onMenuOpenChange(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-foreground hover:bg-white/[0.08] transition-colors"
              role="menuitem"
            >
              <Copy size={14} className="text-foreground-muted shrink-0" />
              <span>Copy</span>
            </button>
          )}

          {isMe && (
            <>
              <div className="h-px bg-white/[0.08]" role="separator" />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteClick();
                  onMenuOpenChange(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                role="menuitem"
              >
                <Trash2 size={14} className="shrink-0" />
                <span>Delete</span>
              </button>
            </>
          )}
        </DropdownMenu>
      </div>
      )}
    </div>
  );
}

/**
 * Splits a plain text chunk into alternating text/emoji nodes so emoji
 * glyphs can be rendered at a larger size than the surrounding text,
 * matching WhatsApp's mixed-content style.
 */
function renderTextWithEmoji(text: string, key: string | number): React.ReactNode {
  const EMOJI_CLUSTER =
    /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:[\u{1F3FB}-\u{1F3FF}])?(?:\u20E3)?(?:\uFE0F)?(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:[\u{1F3FB}-\u{1F3FF}])?(?:\uFE0F)?)*[\uFE0F\uFE0E]?/gu;

  const segments: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  EMOJI_CLUSTER.lastIndex = 0;

  while ((m = EMOJI_CLUSTER.exec(text)) !== null) {
    if (m.index > last) segments.push(text.slice(last, m.index));
    segments.push(
      <span
        key={`e-${m.index}`}
        style={{ fontSize: "1.35em", lineHeight: 1, verticalAlign: "-0.15em", display: "inline-block" }}
      >
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push(text.slice(last));

  // If no emoji was found just return the string (avoids wrapping in a Fragment).
  if (segments.length === 1 && typeof segments[0] === "string") return segments[0];
  return <Fragment key={key}>{segments}</Fragment>;
}

/**
 * Renders message text with URLs converted to clickable anchors and emoji
 * glyphs enlarged to WhatsApp-style proportions.
 * Shows a WhatsApp-style link-preview card for the first URL found.
 * Only rendered for non-deleted, non-pending messages.
 */
function MessageContent({
  content,
  isMe,
  showPreview,
}: {
  content: string;
  isMe: boolean;
  showPreview: boolean;
}) {
  const previewUrl = showPreview ? extractFirstUrl(content) : null;

  // Split text on URLs so we can wrap each URL in an <a>.
  const URL_RE = /https?:\/\/[^\s<>"'()[\]{}]+/gi;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(content)) !== null) {
    const url = m[0].replace(/[.,;:!?)]+$/, "");
    // Enlarge emoji in the plain-text segment before this URL.
    if (m.index > last) parts.push(renderTextWithEmoji(content.slice(last, m.index), last));
    parts.push(
      <a
        key={m.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`underline underline-offset-2 break-all ${
          isMe ? "text-accent-foreground/90 hover:text-accent-foreground" : "text-foreground hover:opacity-80"
        }`}
      >
        {url}
      </a>,
    );
    last = m.index + m[0].length;
  }
  // Enlarge emoji in the trailing plain-text segment.
  if (last < content.length) parts.push(renderTextWithEmoji(content.slice(last), last));

  return (
    <>
      <p
        className={`font-body text-sm whitespace-pre-wrap break-words ${
          isMe ? "text-accent-foreground" : "text-foreground"
        }`}
      >
        {parts}
      </p>
      {previewUrl && <LinkPreview url={previewUrl} isMe={isMe} />}
    </>
  );
}

/**
 * Returns true when the entire message text is 1–3 emoji with no other content.
 * Handles ZWJ sequences, skin-tone modifiers, variation selectors, and keycap combiners.
 */
function isEmojiOnly(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Each "cluster" is one rendered emoji glyph, including ZWJ chains like 👨‍👩‍👧.
  const EMOJI_CLUSTER =
    /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:[\u{1F3FB}-\u{1F3FF}])?(?:\u20E3)?(?:\uFE0F)?(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:[\u{1F3FB}-\u{1F3FF}])?(?:\uFE0F)?)*[\uFE0F\uFE0E]?/gu;

  const clusters = [...trimmed.matchAll(EMOJI_CLUSTER)];
  if (clusters.length === 0 || clusters.length > 3) return false;

  // After stripping matched clusters and whitespace, nothing should be left.
  const remainder = trimmed.replace(EMOJI_CLUSTER, "").replace(/\s/g, "");
  return remainder.length === 0;
}

/** Placeholder shown for soft-deleted messages. */
function DeletedBubble({ isMe, createdAt }: { isMe: boolean; createdAt: string }) {
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-2xl px-3 py-2 select-none
        ${isMe
          ? "rounded-tr-sm bg-accent/50 border border-white/10"
          : "rounded-tl-sm bg-surface-raised/60 border border-white/5"
        }`}
    >
      <Ban size={13} className={isMe ? "text-accent-foreground/40 shrink-0" : "text-foreground-muted/50 shrink-0"} />
      <span className={`font-body text-xs italic ${isMe ? "text-accent-foreground/50" : "text-foreground-muted/60"}`}>
        {isMe ? "You deleted this message" : "This message was deleted"}
      </span>
      <span className={`font-mono text-[10px] ml-1 shrink-0 ${isMe ? "text-accent-foreground/40" : "text-foreground-muted/50"}`}>
        {fmtTime(createdAt)}
      </span>
    </div>
  );
}

export function MessageBubble({
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
  onCopy,
  onDelete,
}: MessageBubbleProps) {
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [nearBubble, setNearBubble] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);

  /** Show three-dot button when mouse is within 40 px of the bubble's right edge. */
  function handleRowMouseMove(e: React.MouseEvent) {
    if (!bubbleRef.current) return;
    const r = bubbleRef.current.getBoundingClientRect();
    const withinX = e.clientX >= r.right - 150 && e.clientX <= r.right + 150;
    const withinY = e.clientY >= r.top - 4 && e.clientY <= r.bottom + 4;
    setNearBubble(withinX && withinY);
  }

  const sender    = msg.users;
  const reactions = msg.reactions ?? [];
  const replyTo   = msg.reply_to ?? null;
  const imageUrl  = msg.image_url ?? null;
  const uploading = msg.status === "sending" && !!imageUrl;
  const failed    = msg.status === "failed";
  const isDeleted = !!msg.deleted_at;

  // Show as a large bubble-free emoji when the entire message is 1–3 emoji glyphs.
  const isEmojiMsg =
    !isDeleted &&
    !imageUrl &&
    !replyTo &&
    !!msg.content &&
    isEmojiOnly(msg.content);

  const rowHighlight = highlighted ? "bg-black/60" : "";

  const handleDeleteConfirm = () => {
    setDeleteConfirmOpen(false);
    onDelete(msg.id);
  };

  // ── Unified Slack-style layout: all messages left-aligned with avatar ──
  const showHeader = !isSameAuthor || isFirstUnread;

  return (
    <Fragment>
      {unreadDivider}
      {deleteConfirmOpen && (
        <DeleteConfirmDialog
          isMe={isMe}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      )}
      <div
        data-message-id={msg.id}
        className={`group flex items-start gap-2 w-full px-5 transition-colors duration-300 ${rowHighlight} ${
          isSameAuthor && !isFirstUnread ? "mt-0.5" : "mt-3"
        }`}
        onMouseMove={handleRowMouseMove}
        onMouseLeave={() => setNearBubble(false)}
      >
        {/* Avatar column — always on the left */}
        <div className="w-7 shrink-0 mt-0.5">
          {showHeader && sender && !isDeleted && (
            <ChatAvatar name={sender.name} url={sender.avatar_url} size={7} />
          )}
        </div>

        {/* Content column */}
        <div className="max-w-[65%]">
          {/* Sender name */}
          {showHeader && sender && !isDeleted && (
            <p className={`font-body text-[11px] font-semibold mb-0.5 ml-0.5 ${
              isMe ? "text-accent" : "text-foreground-muted"
            }`}>
              {sender.name}
            </p>
          )}

          {isDeleted ? (
            <DeletedBubble isMe={isMe} createdAt={msg.created_at} />
          ) : isEmojiMsg ? (
            /* ── Big emoji — no bubble background ── */
            <div className="flex items-center gap-1">
              <div className="relative">
                <div className="flex flex-col items-start select-none">
                  <span style={{ fontSize: EMOJI_MESSAGE_SIZE, lineHeight: 1.1 }}>{msg.content}</span>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="font-mono text-[10px] text-foreground-muted/70">
                      {fmtTime(msg.created_at)}
                    </span>
                    {isMe && msg.status === "sending" && (
                      <Clock size={10} className="text-foreground-muted/60 animate-pulse" />
                    )}
                    {isMe && (msg.status === "sent" || !msg.status) && (
                      <CheckCheck size={11} className="text-foreground-muted/70" />
                    )}
                    {isMe && msg.status === "failed" && (
                      <span className="text-[10px] text-red-400">!</span>
                    )}
                  </div>
                </div>
                <ReactionPills reactions={reactions} currentUserId={currentUserId} isMe={isMe} msgId={msg.id} onReaction={onReaction} />
              </div>
              <MessageHoverActions
                msg={msg}
                isMe={isMe}
                isDeleted={isDeleted}
                currentUserId={currentUserId}
                onReaction={onReaction}
                onReply={onReply}
                onCopy={onCopy}
                onDeleteClick={() => setDeleteConfirmOpen(true)}
                menuOpen={menuOpen}
                onMenuOpenChange={setMenuOpen}
              />
            </div>
          ) : (
            /* ── Normal bubble ── */
            <div className="flex items-center gap-1">
              {failed && <RetryIndicator onRetry={() => onRetrySend(msg.id)} />}
              <div className="relative min-w-0">
                <div
                  ref={bubbleRef}
                  className={`relative rounded-2xl px-3 pt-2 pb-1.5 select-none transition-shadow duration-150 ${
                    menuOpen ? "ring-2 ring-white/20 ring-offset-2 ring-offset-transparent" : ""
                  } ${
                    isMe
                      ? msg.status === "sending"
                        ? "bg-accent opacity-70"
                        : msg.status === "failed"
                        ? "bg-red-500/80"
                        : "bg-accent"
                      : "bg-surface-raised shadow-sm"
                  }`}
                >
                  {replyTo && <ReplyBubble reply={replyTo} isMe={isMe} onReplyClick={onReplyClick} />}
                  {imageUrl && (
                    <BubbleImage
                      url={imageUrl}
                      isMe={isMe}
                      uploading={uploading}
                      onCancel={() => onCancelSend(msg.id)}
                    />
                  )}
                  {msg.content && (
                    <MessageContent
                      content={msg.content}
                      isMe={isMe}
                      showPreview={msg.status !== "failed"}
                    />
                  )}
                  <div className="flex items-center justify-end gap-1 mt-1">
                    <span className={`font-mono text-[10px] ${
                      isMe ? "text-accent-foreground/60" : "text-foreground-muted"
                    }`}>
                      {fmtTime(msg.created_at)}
                    </span>
                    {isMe && msg.status === "sending" && (
                      <Clock size={10} className="text-accent-foreground/60 animate-pulse" />
                    )}
                    {isMe && (msg.status === "sent" || !msg.status) && (
                      <CheckCheck size={11} className="text-accent-foreground/70" />
                    )}
                    {isMe && msg.status === "failed" && (
                      <span className="text-[10px] text-red-200">!</span>
                    )}
                  </div>
                  <MessageHoverActions
                    msg={msg}
                    isMe={isMe}
                    isDeleted={isDeleted}
                    currentUserId={currentUserId}
                    onReaction={onReaction}
                    onReply={onReply}
                    onCopy={onCopy}
                    onDeleteClick={() => setDeleteConfirmOpen(true)}
                    menuOpen={menuOpen}
                    onMenuOpenChange={setMenuOpen}
                    showReaction={false}
                    insideBubble
                    dotsVisible={nearBubble}
                  />
                </div>
                <ReactionPills reactions={reactions} currentUserId={currentUserId} isMe={isMe} msgId={msg.id} onReaction={onReaction} />
              </div>
              {/* Emoji reaction button to the right of bubble */}
              <MessageHoverActions
                msg={msg}
                isMe={isMe}
                isDeleted={isDeleted}
                currentUserId={currentUserId}
                onReaction={onReaction}
                onReply={onReply}
                onCopy={onCopy}
                onDeleteClick={() => setDeleteConfirmOpen(true)}
                menuOpen={menuOpen}
                onMenuOpenChange={setMenuOpen}
                showMenu={false}
              />
            </div>
          )}
          {reactions.length > 0 && !isDeleted && <div className="h-5" />}
        </div>
      </div>
    </Fragment>
  );
}
