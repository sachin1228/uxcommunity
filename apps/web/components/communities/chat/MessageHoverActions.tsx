"use client";

import { useState, useRef, useEffect } from "react";
import { Copy, Smile, Trash2, MoreHorizontal, Pencil, Reply } from "lucide-react";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { canEditMessage, MESSAGE_EDIT_WINDOW_MS } from "@/lib/communities/message-edit";
import type { CachedMessage } from "@/lib/communities/cache";
import { AnimatedEmoji } from "./AnimatedEmoji";

const REACTIONS = [
  { emoji: "❤️", label: "Love",    bg: "bg-red-500"    },
  { emoji: "👍", label: "Like",    bg: "bg-green-500"  },
  { emoji: "👎", label: "Dislike", bg: "bg-orange-500" },
  { emoji: "😮", label: "Wow",     bg: "bg-purple-500" },
  { emoji: "🔥", label: "Fire",    bg: "bg-blue-500"   },
];

/**
 * Side action buttons that appear beside the message bubble on hover.
 * Shows: Emoji reaction (opens picker above bubble) + a menu for Reply, Copy,
 * and Delete (own messages).
 */
export function MessageHoverActions({
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
  canModerate = false,
  moderationRole = null,
  animate = false,
  /** Word count of the animated wave (capped at 24) — delays the hover
   * buttons until after the message text has settled. */
  waveIndex = 0,
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
  /** Moderator may delete other members' messages. */
  canModerate?: boolean;
  /** Viewer's managing role when deleting someone else's message — the delete item names it. */
  moderationRole?: "admin" | "moderator" | null;
  /** Live-arrival entrance animation — hover buttons wait for the word wave. */
  animate?: boolean;
  /** Word count of the animated wave (capped at 24) for the entrance delay. */
  waveIndex?: number;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerBtnRef = useRef<HTMLButtonElement>(null);
  const myEmoji = msg.reactions?.find((r) => r.user_ids.includes(currentUserId))?.emoji;
  const canCopy = !!msg.content && !isDeleted;
  const deleteLabel = isMe
    ? "Delete"
    : moderationRole
      ? `Delete for everyone as ${moderationRole === "admin" ? "an admin" : "a moderator"}`
      : "Delete for everyone";
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
    if (!showReaction) return null;
    // Matches the footprint of both side buttons (emoji + more menu) so the
    // bubble's available width doesn't change once the message flips to "sent".
    return <div aria-hidden className="w-[58px] h-7 shrink-0" />;
  }

  return (
    <div
      className={`flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto transition-opacity duration-150 ${
        animate ? "chat-hover-actions-in" : ""
      }`}
      style={animate ? ({ "--i": waveIndex } as React.CSSProperties) : undefined}
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
      <div className="relative">
        <button
          ref={triggerBtnRef}
          onClick={(e) => { e.stopPropagation(); onMenuOpenChange(!menuOpen); }}
          className={`
            w-7 h-7 rounded-full flex items-center justify-center
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
                <span>{deleteLabel}</span>
              </button>
            </>
          )}
        </DropdownMenu>
      </div>
      )}
    </div>
  );
}
