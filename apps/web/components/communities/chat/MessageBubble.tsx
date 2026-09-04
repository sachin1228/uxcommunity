"use client";

import { Fragment, useMemo, useState, useRef, useEffect, memo } from "react";
import { Clock, CheckCheck, X, RefreshCw, Reply, Copy, Smile, Trash2, Ban, MoreHorizontal, Pencil } from "lucide-react";
import { ChatAvatar } from "./ChatAvatar";
import { fmtTime } from "./chatUtils";
import { MessageBubbleTail } from "./MessageBubbleTail";
import { AnimatedEmoji } from "./AnimatedEmoji";

import type { CachedMessage, MessageMention, MessageReaction, ReplyPreview } from "@/lib/communities/cache";
import { LinkPreview } from "./LinkPreview";
import { extractFirstUrl } from "@/lib/communities/linkPreview";
import { splitContentByMentions } from "@/lib/communities/mentions";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { canEditMessage, MESSAGE_EDIT_WINDOW_MS } from "@/lib/communities/message-edit";


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
  onDelete: (msgId: string) => void;
  /** Opens the full-screen image viewer for a chat image URL. */
  onImageClick: (url: string) => void;
  /** Moderator (owner/admin with delete permission) may delete other members' messages. */
  canModerate?: boolean;
  /** Play the entrance animation (bubble pop + word wave). Only for live arrivals. */
  animate?: boolean;
}

const REACTIONS = [
  { emoji: "❤️", label: "Love",    bg: "bg-red-500"    },
  { emoji: "👍", label: "Like",    bg: "bg-green-500"  },
  { emoji: "👎", label: "Dislike", bg: "bg-orange-500" },
  { emoji: "😮", label: "Wow",     bg: "bg-purple-500" },
  { emoji: "🔥", label: "Fire",    bg: "bg-blue-500"   },
];

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
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onReplyClick(reply.id); }}
      className={`mb-1 px-2.5 py-1.5 rounded-xl border-l-2 text-left max-w-full cursor-pointer
        ${isMe
          ? "bg-black/20 border-white/20 hover:bg-black/30"
          : "bg-black/10 border-white/15 hover:bg-black/20"
        } transition-colors`}
    >
      <p className={`font-body text-[10px] font-semibold truncate ${isMe ? "text-accent-foreground opacity-80" : "text-foreground-muted"}`}>
        {reply.user_name}
      </p>
      <p className={`font-body text-[11px] truncate ${isMe ? "text-accent-foreground opacity-70" : "text-foreground-muted"}`}>
        {reply.content || "📷 Image"}
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
  url, isMe, uploading, onCancel, standalone = false, createdAt, status, isFirstInGroup, onClick,
}: {
  url: string;
  isMe: boolean;
  uploading?: boolean;
  onCancel?: () => void;
  standalone?: boolean;
  createdAt?: string;
  status?: CachedMessage["status"];
  isFirstInGroup?: boolean;
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
          ? `relative overflow-hidden ${isFirstInGroup ? (isMe ? "rounded-tr-none" : "rounded-tl-none") : "rounded-[10px]"} border-2 ${
              isMe
                ? "border-[var(--ds-blue-700)]"
                : "border-border bg-surface-raised"
            }`
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
        className={`block max-w-full object-cover ${
          standalone ? "" : "rounded-xl"
        } ${isMe ? "opacity-95" : ""} ${uploading ? "opacity-50" : ""} ${onClick ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}`}
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
  onEdit,
  onCopy,
  onDeleteClick,
  menuOpen,
  onMenuOpenChange,
  showReaction = true,
  showMenu = true,
  insideBubble = false,
  dotsVisible = false,
  canModerate = false,
}: {
  msg: CachedMessage;
  isMe: boolean;
  isDeleted: boolean;
  currentUserId: string;
  onReaction: (msgId: string, emoji: string) => void;
  onReply: (msg: CachedMessage) => void;
  onEdit: (msg: CachedMessage) => void;
  onCopy: (msg: CachedMessage) => void;
  onDeleteClick: () => void;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  showReaction?: boolean;
  showMenu?: boolean;
  insideBubble?: boolean;
  /** Controls three-dot button visibility when insideBubble=true (proximity-based). */
  dotsVisible?: boolean;
  /** Moderator may delete other members' messages. */
  canModerate?: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerBtnRef = useRef<HTMLButtonElement>(null);
  const myEmoji = msg.reactions?.find((r) => r.user_ids.includes(currentUserId))?.emoji;
  const canCopy = !!msg.content && !isDeleted;
  const [editAvailable, setEditAvailable] = useState(() => canEditMessage(msg.created_at));

  useEffect(() => {
    const createdAtMs = Date.parse(msg.created_at);
    const remaining = createdAtMs + MESSAGE_EDIT_WINDOW_MS - Date.now();

    if (!Number.isFinite(createdAtMs) || remaining <= 0) return;

    const timeoutId = window.setTimeout(() => setEditAvailable(false), remaining + 1);
    return () => window.clearTimeout(timeoutId);
  }, [msg.created_at]);

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

  // No actions on deleted messages
  if (isDeleted) return null;

  // While sending, render an invisible spacer that matches the reaction
  // button's footprint so the bubble's available width doesn't change (and
  // the text doesn't re-wrap) the moment the message flips to "sent".
  if (msg.status === "sending") {
    if (insideBubble || !showReaction) return null;
    return <div aria-hidden className="w-7 h-7 shrink-0" />;
  }

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
                      w-8 h-8 rounded-full flex items-center justify-center
                      transition-transform duration-100 hover:scale-125 active:scale-90
                      ${isActive
                        ? `${bg} ring-2 ring-white/50 ring-offset-1 ring-offset-[#1c1c1e]`
                        : "hover:bg-white/10"
                      }
                    `}
                    aria-label={`${isActive ? "Remove" : "Add"} ${label} reaction`}
                    title={label}
                  >
                    <AnimatedEmoji emoji={emoji} size={20} />
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
            <Smile strokeWidth={2.5} size={14} />
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
            <Reply strokeWidth={2.5} size={14} className="text-foreground-muted shrink-0" />
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
              <Copy strokeWidth={2.5} size={14} className="text-foreground-muted shrink-0" />
              <span>Copy</span>
            </button>
          )}

          {isMe && canCopy && editAvailable && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(msg);
                onMenuOpenChange(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-foreground hover:bg-white/[0.08] transition-colors"
              role="menuitem"
            >
              <Pencil strokeWidth={2.5} size={14} className="text-foreground-muted shrink-0" />
              <span>Edit</span>
            </button>
          )}

          {(isMe || canModerate) && (
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
                <Trash2 strokeWidth={2.5} size={14} className="shrink-0" />
                <span>{isMe ? "Delete" : "Delete for everyone"}</span>
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
      <AnimatedEmoji
        key={`e-${m.index}`}
        emoji={m[0]}
        size={20}
        className="inline-block align-middle mx-0.5"
      />,
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
/** Linkifies URLs and enlarges emoji inside a single whitespace-free chunk. */
function renderRichChunk(chunk: string, isMe: boolean, keyBase: number): React.ReactNode[] {
  const URL_RE = /https?:\/\/[^\s<>"'()[\]{}]+/gi;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(chunk)) !== null) {
    const url = m[0].replace(/[.,;:!?)]+$/, "");
    if (m.index > last) parts.push(renderTextWithEmoji(chunk.slice(last, m.index), keyBase + last));
    parts.push(
      <a
        key={keyBase + m.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`underline underline-offset-2 break-all ${
          isMe ? "text-accent-foreground opacity-90 hover:opacity-100" : "text-foreground hover:opacity-80"
        }`}
      >
        {url}
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (last < chunk.length) parts.push(renderTextWithEmoji(chunk.slice(last), keyBase + last));
  return parts;
}

/** Highlighted chip for a `@Name` mention inside a message bubble. */
function MentionChip({ text, isMe }: { text: string; isMe: boolean }) {
  return (
    <span
      className={`inline-block max-w-full rounded-[5px] px-[3px] break-normal ${
        isMe
          ? "bg-black/25 text-accent-foreground"
          : "bg-accent/15 text-accent"
      }`}
    >
      {text}</span>
  );
}

function MessageContent({
  content,
  mentions,
  isMe,
  showPreview,
  animate = false,
}: {
  content: string;
  mentions: MessageMention[];
  isMe: boolean;
  showPreview: boolean;
  /** When true, each word rises into place with a staggered delay. */
  animate?: boolean;
}) {
  const previewUrl = showPreview ? extractFirstUrl(content) : null;

  // Mentions are matched against the raw text first (longest name wins), so
  // exactly the stored mentions become chips and everything else — including
  // hand-typed @words that were never picked — renders as plain text.
  const segments = useMemo(
    () => splitContentByMentions(content, mentions ?? []),
    [content, mentions],
  );

  let parts: React.ReactNode[];

  if (animate) {
    // Split each plain-text segment on whitespace (keeping the whitespace so
    // pre-wrap newlines survive) and wrap every word in a span that carries
    // its stagger index. Mention chips are whole tokens with a single index.
    let wordIdx = 0;
    let keyIdx = 0;
    parts = [];
    for (const segment of segments) {
      if (segment.mention) {
        const i = wordIdx++;
        const key = keyIdx++;
        parts.push(
          <span
            key={key}
            className="chat-word-in"
            style={{ "--i": i } as React.CSSProperties}
          >
            <MentionChip text={segment.text} isMe={isMe} />
          </span>,
        );
        continue;
      }
      const tokens = segment.text.split(/(\s+)/);
      for (const tok of tokens) {
        const key = keyIdx++;
        if (!tok) continue;
        if (/^\s+$/.test(tok)) {
          parts.push(tok);
          continue;
        }
        const i = wordIdx++;
        parts.push(
          <span
            key={key}
            className="chat-word-in"
            style={{ "--i": i } as React.CSSProperties}
          >
            {renderRichChunk(tok, isMe, key)}
          </span>,
        );
      }
    }
  } else {
    parts = [];
    let keyIdx = 0;
    for (const segment of segments) {
      if (segment.mention) {
        parts.push(
          <MentionChip key={keyIdx++} text={segment.text} isMe={isMe} />,
        );
      } else if (segment.text) {
        parts.push(...renderRichChunk(segment.text, isMe, keyIdx));
        keyIdx += segment.text.length;
      }
    }
  }

  return (
    <>
      <div
        className={`chat-message-text font-body text-sm font-medium leading-6 whitespace-pre-wrap break-words select-text cursor-text ${
          isMe ? "text-accent-foreground" : "text-foreground"
        }`}
      >
        {parts}
      </div>
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
function DeletedBubble({
  isMe,
  createdAt,
  isFirstInGroup,
}: {
  isMe: boolean;
  createdAt: string;
  isFirstInGroup: boolean;
}) {
  return (
    <div
      className={`relative inline-flex select-none items-center gap-1.5 rounded-[10px] ${isFirstInGroup ? (isMe ? "rounded-tr-none" : "rounded-tl-none") : ""} px-3 pt-2 pb-1.5 shadow-sm
        ${isMe
          ? "bg-[var(--ds-blue-700)] [--color-accent-foreground:white]"
          : "bg-surface-raised"
        }`}
    >
      {isFirstInGroup && (
        <MessageBubbleTail
          side={isMe ? "right" : "left"}
          className={isMe ? "text-[var(--ds-blue-700)]" : "text-surface-raised"}
        />
      )}
      <Ban strokeWidth={2.5} size={13} className={isMe ? "shrink-0 text-accent-foreground" : "shrink-0 text-foreground-muted"} />
      <span className={`font-body text-xs ${isMe ? "text-accent-foreground" : "text-foreground-muted"}`}>
        {isMe ? "You deleted this message" : "This message was deleted"}
      </span>
      <span className={`ml-1 shrink-0 font-mono text-[10px] ${isMe ? "text-accent-foreground opacity-60" : "text-foreground-muted"}`}>
        {fmtTime(createdAt)}
      </span>
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
  animate = false,
}: MessageBubbleProps) {
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [nearBubble, setNearBubble] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);

  /**
   * Show three-dot button when the mouse is anywhere over the bubble (with a
   * small margin), plus a bit of runway on the reaction-button side so the
   * dots stay visible while moving between the bubble and the emoji button.
   * Using the full bubble rect (not just a fixed band near one edge) means
   * wide, multi-line bubbles behave the same as short ones.
   */
  function handleRowMouseMove(e: React.MouseEvent) {
    if (!bubbleRef.current) return;
    const r = bubbleRef.current.getBoundingClientRect();
    const PAD = 8;
    const REACH = 48; // room for the reaction button beside the bubble
    const minX = isMe ? r.left - REACH : r.left - PAD;
    const maxX = isMe ? r.right + PAD : r.right + REACH;
    const withinX = e.clientX >= minX && e.clientX <= maxX;
    const withinY = e.clientY >= r.top - PAD && e.clientY <= r.bottom + PAD;
    setNearBubble(withinX && withinY);
  }

  const sender    = msg.users;
  const reactions = msg.reactions ?? [];
  const replyTo   = msg.reply_to ?? null;
  const imageUrl  = msg.image_url ?? null;
  const uploading = msg.status === "sending" && !!imageUrl;
  const failed    = msg.status === "failed";
  const isDeleted = !!msg.deleted_at;
  const imageOnly = !!imageUrl && !msg.content && !replyTo;

  // Show as a large bubble-free emoji when the entire message is 1–3 emoji glyphs.
  const isEmojiMsg =
    !isDeleted &&
    !imageUrl &&
    !replyTo &&
    !!msg.content &&
    isEmojiOnly(msg.content);

  // Inline style: Tailwind does not emit color-mix() for arbitrary CSS-var
  // utilities with an opacity modifier (bg-[var(--x)]/25 never compiles), so
  // the translucent blue row flash is applied directly.
  const rowHighlightStyle: React.CSSProperties | undefined = highlighted
    ? {
        backgroundColor:
          "color-mix(in srgb, var(--ds-blue-700) 25%, transparent)",
      }
    : undefined;
  const isFirstInGroup = !isSameAuthor;

  const handleDeleteConfirm = () => {
    setDeleteConfirmOpen(false);
    onDelete(msg.id);
  };

  // ── Unified layout: own messages right-aligned, others left-aligned ──
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
        style={rowHighlightStyle}
        className={`group flex w-full items-start gap-2 px-5 transition-colors duration-300 ${
          isMe ? "justify-end" : "justify-start"
        } ${isSameAuthor && !isFirstUnread ? "mt-0.5" : "mt-3"}`}
        onMouseMove={handleRowMouseMove}
        onMouseLeave={() => setNearBubble(false)}
      >
        {/* Avatar column — hidden for own messages */}
        {!isMe && (
          <div className="w-7 shrink-0 mt-0.5">
            {showHeader && sender && (
              <ChatAvatar name={sender.name} url={sender.avatar_url} size={7} />
            )}
          </div>
        )}

        {/* Content column */}
        <div className="min-w-0 max-w-[65%]">
          {/* Sender name — hidden for the current user's own messages */}
          {showHeader && sender && !isDeleted && !isMe && (
            <p className="font-body text-[11px] font-semibold mb-1 ml-0.5 text-foreground-muted">
              <span>{sender.name}</span>
            </p>
          )}

          {isDeleted ? (
            <DeletedBubble isMe={isMe} createdAt={msg.created_at} isFirstInGroup={isFirstInGroup} />
          ) : isEmojiMsg ? (
            /* ── Big emoji — no bubble background ── */
            <div className={`flex items-center gap-1 ${isMe ? "flex-row-reverse" : ""}`}>
              <div
                className={`relative ${animate ? "chat-bubble-in" : ""}`}
                data-side={isMe ? "right" : "left"}
              >
                <div className="flex flex-col items-start select-none">
                  <AnimatedEmoji emoji={msg.content} size={EMOJI_MESSAGE_SIZE} />
                  <div className="flex items-center gap-1 mt-0.5">
                    {msg.edited_at && (
                      <span className="font-body text-[10px] text-foreground-muted/60">edited</span>
                    )}
                    <span className="font-mono text-[10px] text-foreground-muted/70">
                      {fmtTime(msg.created_at)}
                    </span>
                    {isMe && msg.status === "sending" && (
                      <Clock strokeWidth={2.5} size={10} className="text-foreground-muted/60 animate-pulse" />
                    )}
                    {isMe && (msg.status === "sent" || !msg.status) && (
                      <CheckCheck strokeWidth={2.5} size={11} className="text-foreground-muted/70" />
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
                  ref={bubbleRef}
                  className={`relative select-none transition-shadow duration-150 ${
                    menuOpen ? "ring-2 ring-white/20 ring-offset-2 ring-offset-transparent" : ""
                  } ${
                    imageOnly
                      ? "flex flex-col items-start"
                      : `relative rounded-[10px] ${isFirstInGroup ? (isMe ? "rounded-tr-none" : "rounded-tl-none") : ""} px-3 pt-2 pb-1.5 shadow-sm ${
                          isMe
                            ? msg.status === "failed"
                              ? "bg-red-500/80"
                              : "bg-[var(--ds-blue-700)] [--color-accent-foreground:white]"
                            : "bg-surface-raised"
                        }`
                  }`}
                >
                  {isFirstInGroup && (
                    <MessageBubbleTail
                      side={isMe ? "right" : "left"}
                      className={isMe
                        ? msg.status === "failed"
                          ? "text-red-500/80"
                          : "text-[var(--ds-blue-700)]"
                        : "text-surface-raised"}
                    />
                  )}
                  {replyTo && <ReplyBubble reply={replyTo} isMe={isMe} onReplyClick={onReplyClick} />}
                  {imageUrl && (
                    <BubbleImage
                      url={imageUrl}
                      isMe={isMe}
                      uploading={uploading}
                      standalone={imageOnly}
                      createdAt={msg.created_at}
                      status={msg.status}
                      isFirstInGroup={isFirstInGroup}
                      onCancel={() => onCancelSend(msg.id)}
                      onClick={() => onImageClick(imageUrl)}
                    />
                  )}
                  {msg.content && (
                    <MessageContent
                      content={msg.content}
                      mentions={msg.mentions ?? []}
                      isMe={isMe}
                      showPreview={msg.status !== "failed"}
                      animate={animate}
                    />
                  )}
                  {!imageOnly && (
                    <div className="flex items-center justify-end gap-1 mt-1">
                      {msg.edited_at && (
                        <span className={`font-body text-[10px] ${isMe ? "text-accent-foreground opacity-50" : "text-foreground-muted"}`}>
                          edited
                        </span>
                      )}
                      <span className={`font-mono text-[10px] ${
                        isMe ? "text-accent-foreground opacity-60" : "text-foreground-muted"
                      }`}>
                        {fmtTime(msg.created_at)}
                      </span>
                      {isMe && msg.status === "sending" && (
                        <Clock strokeWidth={2.5} size={10} className="text-accent-foreground opacity-60 animate-pulse" />
                      )}
                      {isMe && (msg.status === "sent" || !msg.status) && (
                        <CheckCheck strokeWidth={2.5} size={11} className="text-accent-foreground opacity-70" />
                      )}
                      {isMe && msg.status === "failed" && (
                        <span className="text-[10px] text-red-200">!</span>
                      )}
                    </div>
                  )}
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
                    showReaction={false}
                    insideBubble
                    dotsVisible={nearBubble}
                    canModerate={canModerate}
                  />
                </div>
                <ReactionPills reactions={reactions} currentUserId={currentUserId} msgId={msg.id} onReaction={onReaction} />
              </div>
              {/* Emoji reaction button to the right of bubble */}
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
                showMenu={false}
                canModerate={canModerate}
              />
            </div>
          )}
          {reactions.length > 0 && !isDeleted && <div className="h-5" />}
        </div>
      </div>
    </Fragment>
  );
});
