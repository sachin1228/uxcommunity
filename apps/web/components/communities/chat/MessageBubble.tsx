"use client";

import { Fragment, useState, useRef, useEffect } from "react";
import { Clock, CheckCheck, X, RefreshCw, Reply, Copy, Smile, Trash2, Ban, ChevronDown } from "lucide-react";
import { ChatAvatar } from "./ChatAvatar";
import { fmtTime } from "./chatUtils";
import type { CachedMessage, MessageReaction, ReplyPreview } from "@/lib/communities/cache";

type MenuPlacement = "above" | "below";

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
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuPlacement, setMenuPlacement] = useState<MenuPlacement>("above");
  const pickerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
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

  // Flip the menu to the side with enough room inside the chat viewport.
  useEffect(() => {
    if (!showMenu || !menuOpen) return;

    const updateMenuPlacement = () => {
      const root = menuRef.current;
      if (!root) return;

      const trigger = root.querySelector<HTMLButtonElement>(
        '[aria-label="More message actions"]'
      );
      const menu = root.querySelector<HTMLElement>('[role="menu"]');
      if (!trigger || !menu) return;

      const triggerRect = trigger.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const scrollViewport = root.closest<HTMLElement>(
        "[data-chat-scroll-container]"
      );
      const viewportRect = scrollViewport?.getBoundingClientRect() ?? {
        top: 0,
        bottom: window.innerHeight,
      };
      const gap = 8;
      const spaceAbove = triggerRect.top - viewportRect.top;
      const spaceBelow = viewportRect.bottom - triggerRect.bottom;
      const fitsAbove = spaceAbove >= menuRect.height + gap;
      const fitsBelow = spaceBelow >= menuRect.height + gap;

      setMenuPlacement(() => {
        if (fitsAbove) return "above";
        if (fitsBelow) return "below";
        return spaceAbove >= spaceBelow ? "above" : "below";
      });
    };

    const frame = requestAnimationFrame(updateMenuPlacement);
    const scrollViewport = menuRef.current?.closest<HTMLElement>(
      "[data-chat-scroll-container]"
    );
    window.addEventListener("resize", updateMenuPlacement);
    scrollViewport?.addEventListener("scroll", updateMenuPlacement, true);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateMenuPlacement);
      scrollViewport?.removeEventListener("scroll", updateMenuPlacement, true);
    };
  }, [menuOpen, showMenu]);

  // Close the action menu when clicking outside or pressing Escape.
  useEffect(() => {
    if (!showMenu || !menuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onMenuOpenChange(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onMenuOpenChange(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen, onMenuOpenChange, showMenu]);

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
      <div className={insideBubble ? "contents" : "relative"} ref={menuRef}>
        <button
          onClick={(e) => { e.stopPropagation(); onMenuOpenChange(!menuOpen); }}
          className={`
            ${insideBubble ? "absolute top-1 right-1 z-30" : ""}
            w-7 h-7 rounded-full flex items-center justify-center
            ${insideBubble ? "opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto" : ""}
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
          <ChevronDown size={14} strokeWidth={2.5} />
        </button>

        {menuOpen && (
          <div
            className={`
              absolute z-40 min-w-32
              ${menuPlacement === "above" ? "bottom-full mb-2" : "top-full mt-2"}
              right-0
            `}
          >
            {/* Connector flips with the menu so it always points at the chevron. */}
            <span
              aria-hidden="true"
              className={`
                pointer-events-none absolute h-2 w-px bg-white/20
                ${menuPlacement === "above" ? "bottom-[-8px]" : "top-[-8px]"}
                right-3.5
              `}
            >
              <span
                className={`
                  absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-white/40
                  ${menuPlacement === "above" ? "bottom-[-3px]" : "top-[-3px]"}
                `}
              />
            </span>

            <div
              className="overflow-hidden rounded-xl border border-white/[0.1] bg-[#1c1c1e]/85 backdrop-blur-md shadow-2xl"
              role="menu"
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
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
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

  const sender    = msg.users;
  const reactions = msg.reactions ?? [];
  const replyTo   = msg.reply_to ?? null;
  const imageUrl  = msg.image_url ?? null;
  const uploading = msg.status === "sending" && !!imageUrl;
  const failed    = msg.status === "failed";
  const isDeleted = !!msg.deleted_at;

  const rowHighlight = highlighted ? "bg-black/60" : "";

  const handleDeleteConfirm = () => {
    setDeleteConfirmOpen(false);
    onDelete(msg.id);
  };

  if (isMe) {
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
          className={`flex flex-col items-end w-full px-5 transition-colors duration-300 ${rowHighlight} ${
            isSameAuthor && !isFirstUnread ? "mt-0.5" : "mt-3"
          }`}
        >
          <div className="flex items-center justify-end gap-2 w-full">
            {failed && (
              <RetryIndicator onRetry={() => onRetrySend(msg.id)} />
            )}
            <div className="max-w-[65%]">
              {isDeleted ? (
                /* Deleted placeholder — no hover actions */
                <div className="flex justify-end">
                  <DeletedBubble isMe createdAt={msg.created_at} />
                </div>
              ) : (
                /* group scoped here — hover only triggers on [actions + bubble], not the full row */
                <div className="group flex items-center gap-1 justify-end">
                  {/* Actions sit to the LEFT of sent bubbles */}
                  <MessageHoverActions
                    msg={msg}
                    isMe
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
                  <div className="relative min-w-0">
                    <div
                      className={`relative rounded-2xl rounded-tr-sm px-3 pt-2 pb-1.5 select-none transition-shadow duration-150 ${
                        menuOpen ? "ring-2 ring-white/20 ring-offset-2 ring-offset-transparent" : ""
                      } ${
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
                      <MessageHoverActions
                        msg={msg}
                        isMe
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
                      />
                    </div>
                    <ReactionPills reactions={reactions} currentUserId={currentUserId} isMe msgId={msg.id} onReaction={onReaction} />
                  </div>
                </div>
              )}
              {reactions.length > 0 && !isDeleted && <div className="h-5" />}
            </div>
          </div>
        </div>
      </Fragment>
    );
  }

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
        className={`flex items-start gap-2 w-full px-5 transition-colors duration-300 ${rowHighlight} ${
          isSameAuthor && !isFirstUnread ? "mt-0.5" : "mt-3"
        }`}
      >
        <div className="w-7 shrink-0">
          {!isSameAuthor && sender && !isDeleted && (
            <ChatAvatar name={sender.name} url={sender.avatar_url} size={7} />
          )}
        </div>
        <div className="max-w-[65%]">
          {!isSameAuthor && sender && !isDeleted && (
            <p className="font-body text-[11px] font-medium text-foreground-muted mb-0.5 ml-0.5">
              {sender.name}
            </p>
          )}

          {isDeleted ? (
            <DeletedBubble isMe={false} createdAt={msg.created_at} />
          ) : (
            /* group scoped here — hover only triggers on [bubble + actions], not the full row */
            <div className="group flex items-center gap-1">
              <div className="relative min-w-0">
                <div className={`relative rounded-2xl rounded-tl-sm bg-surface-raised shadow-sm px-3 pt-2 pb-1.5 select-none transition-shadow duration-150 ${
                  menuOpen ? "ring-2 ring-white/20 ring-offset-2 ring-offset-transparent" : ""
                }`}>
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
                  <MessageHoverActions
                    msg={msg}
                    isMe={false}
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
                  />
                </div>
                <ReactionPills reactions={reactions} currentUserId={currentUserId} isMe={false} msgId={msg.id} onReaction={onReaction} />
              </div>
              {/* Actions sit to the RIGHT of received bubbles */}
              <MessageHoverActions
                msg={msg}
                isMe={false}
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
