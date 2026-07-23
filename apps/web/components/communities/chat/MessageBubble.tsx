"use client";

import { Fragment, useState, useRef, useEffect } from "react";
import { Clock, CheckCheck, X, RefreshCw, Reply, Copy, Smile } from "lucide-react";
import { ChatAvatar } from "./ChatAvatar";
import { fmtTime } from "./chatUtils";
import type { CachedMessage, MessageReaction, ReplyPreview } from "@/lib/communities/cache";

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
}

const REACTIONS = [
  { emoji: "❤️", label: "Love",    bg: "bg-red-500"    },
  { emoji: "👍", label: "Like",    bg: "bg-green-500"  },
  { emoji: "👎", label: "Dislike", bg: "bg-orange-500" },
  { emoji: "😮", label: "Wow",     bg: "bg-purple-500" },
  { emoji: "🔥", label: "Fire",    bg: "bg-blue-500"   },
];

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
 * Side action buttons that appear beside the message bubble on hover.
 * Shows: Emoji reaction (opens picker above bubble) + Reply + Copy.
 */
function MessageHoverActions({
  msg,
  isMe,
  currentUserId,
  onReaction,
  onReply,
  onCopy,
}: {
  msg: CachedMessage;
  isMe: boolean;
  currentUserId: string;
  onReaction: (msgId: string, emoji: string) => void;
  onReply: (msg: CachedMessage) => void;
  onCopy: (msg: CachedMessage) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const myEmoji = msg.reactions?.find((r) => r.user_ids.includes(currentUserId))?.emoji;
  const canCopy = !!msg.content;

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

  return (
    /* Inline beside the bubble — group is on the [actions+bubble] wrapper, not the whole row */
    <div
      className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity duration-150"
    >
      {/* Emoji reaction button — clicking opens picker above the bubble */}
      <div className="relative" ref={pickerRef}>
        {/* Emoji picker popup — appears above the message row */}
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

        {/* Smiley trigger button */}
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

      {/* Reply */}
      <button
        onClick={(e) => { e.stopPropagation(); onReply(msg); }}
        className="w-7 h-7 rounded-full flex items-center justify-center text-foreground-muted hover:text-foreground hover:bg-white/10 transition-colors"
        aria-label="Reply"
        title="Reply"
      >
        <Reply size={14} />
      </button>

      {/* Copy — only shown when there's text */}
      {canCopy && (
        <button
          onClick={(e) => { e.stopPropagation(); onCopy(msg); }}
          className="w-7 h-7 rounded-full flex items-center justify-center text-foreground-muted hover:text-foreground hover:bg-white/10 transition-colors"
          aria-label="Copy text"
          title="Copy"
        >
          <Copy size={14} />
        </button>
      )}
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
}: MessageBubbleProps) {
  const sender    = msg.users;
  const reactions = msg.reactions ?? [];
  const replyTo   = msg.reply_to ?? null;
  const imageUrl  = msg.image_url ?? null;
  const uploading = msg.status === "sending" && !!imageUrl;
  const failed    = msg.status === "failed";

  const rowHighlight = highlighted ? "bg-black/60" : "";

  if (isMe) {
    return (
      <Fragment>
        {unreadDivider}
        <div
          data-message-id={msg.id}
          className={`flex flex-col items-end w-full px-5 transition-colors duration-300 ${rowHighlight} ${
            isSameAuthor && !isFirstUnread ? "mt-0.5" : "mt-3"
          }`}
        >
          <div className="flex items-center justify-end gap-2 w-full">
            {failed && (
              <RetryIndicator onRetry={() => onRetrySend(msg.id)} />
            )}
            <div className="max-w-[65%]">
              {/* group scoped here — hover only triggers on [actions + bubble], not the full row */}
              <div className="group flex items-center gap-1 justify-end">
                {/* Actions sit to the LEFT of sent bubbles */}
                <MessageHoverActions
                  msg={msg}
                  isMe
                  currentUserId={currentUserId}
                  onReaction={onReaction}
                  onReply={onReply}
                  onCopy={onCopy}
                />
                <div className="relative min-w-0">
                  <div
                    className={`rounded-2xl rounded-tr-sm px-3 pt-2 pb-1.5 select-none ${
                      msg.status === "sending"
                        ? "bg-accent opacity-70"
                        : msg.status === "failed"
                        ? "bg-red-500/80"
                        : "bg-accent"
                    }`}
                  >
                    {replyTo && <ReplyBubble reply={replyTo} isMe onReplyClick={onReplyClick} />}
                    {imageUrl && (
                      <BubbleImage
                        url={imageUrl}
                        isMe
                        uploading={uploading}
                        onCancel={() => onCancelSend(msg.id)}
                      />
                    )}
                    {msg.content && (
                      <p className="font-body text-sm text-accent-foreground whitespace-pre-wrap break-words">
                        {msg.content}
                      </p>
                    )}
                    <div className="flex items-center justify-end gap-1 mt-1">
                      <span className="font-mono text-[10px] text-accent-foreground/60">
                        {fmtTime(msg.created_at)}
                      </span>
                      {msg.status === "sending" && (
                        <Clock size={10} className="text-accent-foreground/60 animate-pulse" />
                      )}
                      {(msg.status === "sent" || !msg.status) && (
                        <CheckCheck size={11} className="text-accent-foreground/70" />
                      )}
                      {msg.status === "failed" && (
                        <span className="text-[10px] text-red-200">!</span>
                      )}
                    </div>
                  </div>
                  <ReactionPills reactions={reactions} currentUserId={currentUserId} isMe msgId={msg.id} onReaction={onReaction} />
                </div>
              </div>
              {reactions.length > 0 && <div className="h-5" />}
            </div>
          </div>
        </div>
      </Fragment>
    );
  }

  return (
    <Fragment>
      {unreadDivider}
      <div
        data-message-id={msg.id}
        className={`flex items-start gap-2 w-full px-5 transition-colors duration-300 ${rowHighlight} ${
          isSameAuthor && !isFirstUnread ? "mt-0.5" : "mt-3"
        }`}
      >
        <div className="w-7 shrink-0">
          {!isSameAuthor && sender && (
            <ChatAvatar name={sender.name} url={sender.avatar_url} size={7} />
          )}
        </div>
        <div className="max-w-[65%]">
          {!isSameAuthor && sender && (
            <p className="font-body text-[11px] font-medium text-foreground-muted mb-0.5 ml-0.5">
              {sender.name}
            </p>
          )}
          {/* group scoped here — hover only triggers on [bubble + actions], not the full row */}
          <div className="group flex items-center gap-1">
            <div className="relative min-w-0">
              <div className="rounded-2xl rounded-tl-sm bg-surface-raised shadow-sm px-3 pt-2 pb-1.5 select-none">
                {replyTo && <ReplyBubble reply={replyTo} isMe={false} onReplyClick={onReplyClick} />}
                {imageUrl && (
                  <BubbleImage
                    url={imageUrl}
                    isMe={false}
                    uploading={uploading}
                    onCancel={() => onCancelSend(msg.id)}
                  />
                )}
                {msg.content && (
                  <p className="font-body text-sm text-foreground whitespace-pre-wrap break-words">
                    {msg.content}
                  </p>
                )}
                <p className="font-mono text-[10px] text-foreground-muted text-right mt-1">
                  {fmtTime(msg.created_at)}
                </p>
              </div>
              <ReactionPills reactions={reactions} currentUserId={currentUserId} isMe={false} msgId={msg.id} onReaction={onReaction} />
            </div>
            {/* Actions sit to the RIGHT of received bubbles */}
            <MessageHoverActions
              msg={msg}
              isMe={false}
              currentUserId={currentUserId}
              onReaction={onReaction}
              onReply={onReply}
              onCopy={onCopy}
            />
          </div>
          {reactions.length > 0 && <div className="h-5" />}
        </div>
      </div>
    </Fragment>
  );
}
