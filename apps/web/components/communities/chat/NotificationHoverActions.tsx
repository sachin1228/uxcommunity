"use client";

import { useState, useRef, useEffect } from "react";
import { Reply, Smile } from "lucide-react";
import { AnimatedEmoji } from "./AnimatedEmoji";
import type { MessageReaction } from "@/lib/communities/cache";

export const NOTIFICATION_REACTIONS = [
  { emoji: "❤️", label: "Love",    bg: "bg-red-500"    },
  { emoji: "👍", label: "Like",    bg: "bg-green-500"  },
  { emoji: "👎", label: "Dislike", bg: "bg-orange-500" },
  { emoji: "😮", label: "Wow",     bg: "bg-purple-500" },
  { emoji: "🔥", label: "Fire",    bg: "bg-blue-500"   },
];

/**
 * Hover actions for the chat timeline's "created a …" notification cards:
 * emoji reaction + reply only — the underlying content is managed in its own
 * tab, so no delete/edit here. Mirrors MessageBubble's hover-actions row
 * (including the reaction picker that opens above the button).
 */
export function NotificationHoverActions({
  reactions,
  currentUserId,
  onReaction,
  onReply,
  isOwn,
}: {
  reactions: MessageReaction[];
  currentUserId: string;
  onReaction: (emoji: string) => void;
  onReply: () => void;
  isOwn: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const myEmoji = reactions.find((r) => r.user_ids.includes(currentUserId))?.emoji;

  // Close the picker on outside click (same pattern as MessageHoverActions).
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
    <div
      className={`flex items-center gap-0.5 shrink-0 self-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto transition-opacity duration-150`}
    >
      {/* Emoji reaction picker */}
      <div className="relative" ref={pickerRef}>
        {pickerOpen && (
          <div
            className="absolute bottom-full mb-2 z-40 left-1/2 -translate-x-1/2
              flex items-center gap-0.5
              bg-[#1c1c1e] border border-white/[0.08] rounded-2xl shadow-2xl px-1.5 py-1
              animate-in fade-in slide-in-from-bottom-2 duration-150"
          >
            {NOTIFICATION_REACTIONS.map(({ emoji, label, bg }) => {
              const isActive = myEmoji === emoji;
              return (
                <button
                  key={label}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onReaction(emoji);
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
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); setPickerOpen((v) => !v); }}
          className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors duration-100 ${
            pickerOpen
              ? isOwn
                ? "bg-white/20 text-white"
                : "bg-black/10 text-foreground dark:bg-white/15"
              : isOwn
                ? "text-white/90 hover:text-white hover:bg-white/15"
                : "text-foreground/80 hover:text-foreground hover:bg-black/10 dark:hover:bg-white/10"
          }`}
          aria-label="React to this"
          title="React"
        >
          <Smile strokeWidth={2.5} size={14} />
        </button>
      </div>

      {/* Reply */}
      <button
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); onReply(); }}
        className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors duration-100 ${
          isOwn
            ? "text-white/90 hover:text-white hover:bg-white/15"
            : "text-foreground/80 hover:text-foreground hover:bg-black/10 dark:hover:bg-white/10"
        }`}
        aria-label="Reply to this"
        title="Reply"
      >
        <Reply strokeWidth={2.5} size={14} />
      </button>
    </div>
  );
}

/**
 * Reaction pills rendered under a notification card — same visual as
 * MessageBubble's ReactionPills (absolute, bottom-left overlap).
 */
export function NotificationReactionPills({
  reactions,
  currentUserId,
  onReaction,
}: {
  reactions: MessageReaction[];
  currentUserId: string;
  onReaction: (emoji: string) => void;
}) {
  if (!reactions || reactions.length === 0) return null;

  // Defensive: collapse repeated emoji groups (server grouping and optimistic
  // writes can briefly disagree) so each emoji renders exactly one pill — the
  // emoji is also the React key, and duplicates made it render twice.
  const grouped = new Map<string, Set<string>>();
  for (const { emoji, user_ids } of reactions) {
    const ids = grouped.get(emoji) ?? new Set<string>();
    for (const id of user_ids) ids.add(id);
    grouped.set(emoji, ids);
  }

  return (
    <div className="absolute -bottom-[14px] left-3 flex flex-wrap justify-start gap-1">
      {[...grouped].map(([emoji, idSet]) => {
        const user_ids = [...idSet];
        const iMine = user_ids.includes(currentUserId);
        return (
          <button
            key={emoji}
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); onReaction(emoji); }}
            title={iMine ? "Remove reaction" : undefined}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] font-medium
              border transition-colors duration-100
              bg-[#2a2a2a] border border-black text-foreground hover:bg-[#333]"
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
