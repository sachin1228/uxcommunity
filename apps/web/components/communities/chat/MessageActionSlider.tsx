"use client";

import { useEffect, useRef, useCallback } from "react";
import { Reply, Copy } from "lucide-react";
import type { CachedMessage, MessageReaction } from "@/lib/communities/cache";

interface MessageActionSliderProps {
  message: CachedMessage | null;
  isMe: boolean;
  currentUserId: string;
  communityId: string;
  onClose: () => void;
  onReply: (msg: CachedMessage) => void;
  onCopy: (msg: CachedMessage) => void;
  onReactionToggled: (msgId: string, reactions: MessageReaction[]) => void;
}

const REACTIONS = [
  { emoji: "❤️", label: "Love",    bg: "bg-red-500",    activeBg: "bg-red-400"    },
  { emoji: "👍", label: "Like",    bg: "bg-green-500",  activeBg: "bg-green-400"  },
  { emoji: "👎", label: "Dislike", bg: "bg-orange-500", activeBg: "bg-orange-400" },
  { emoji: "😮", label: "Wow",     bg: "bg-purple-500", activeBg: "bg-purple-400" },
  { emoji: "🔥", label: "Fire",    bg: "bg-blue-500",   activeBg: "bg-blue-400"   },
];

export function MessageActionSlider({
  message,
  isMe,
  currentUserId,
  communityId,
  onClose,
  onReply,
  onCopy,
  onReactionToggled,
}: MessageActionSliderProps) {
  const sheetRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    document.body.style.overflow = message ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [message]);

  const handleReaction = useCallback(
    async (emoji: string) => {
      if (!message) return;
      const msgId = message.id;

      // Optimistic update: toggle immediately in UI
      const existing = (message.reactions ?? []).find(
        (r) => r.emoji === emoji && r.user_ids.includes(currentUserId)
      );
      let optimistic: MessageReaction[];
      if (existing) {
        // Remove current user from this emoji
        optimistic = (message.reactions ?? [])
          .map((r) =>
            r.emoji === emoji
              ? { ...r, user_ids: r.user_ids.filter((id) => id !== currentUserId) }
              : r
          )
          .filter((r) => r.user_ids.length > 0);
      } else {
        // Remove any prior reaction from current user, then add new one
        const withoutUser = (message.reactions ?? [])
          .map((r) => ({ ...r, user_ids: r.user_ids.filter((id) => id !== currentUserId) }))
          .filter((r) => r.user_ids.length > 0);
        const group = withoutUser.find((r) => r.emoji === emoji);
        if (group) {
          optimistic = withoutUser.map((r) =>
            r.emoji === emoji ? { ...r, user_ids: [...r.user_ids, currentUserId] } : r
          );
        } else {
          optimistic = [...withoutUser, { emoji, user_ids: [currentUserId] }];
        }
      }
      onReactionToggled(msgId, optimistic);
      onClose();

      // Sync with server (realtime will propagate to other clients)
      try {
        const res = await fetch(
          `/api/communities/${communityId}/messages/${msgId}/reactions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ emoji }),
          }
        );
        if (res.ok) {
          const { reactions } = await res.json();
          // Server is authoritative — reconcile if needed
          onReactionToggled(msgId, reactions);
        }
      } catch {
        // Network error — realtime will correct state when reconnected
      }
    },
    [message, currentUserId, communityId, onReactionToggled, onClose]
  );

  const isOpen = !!message;

  // Which emoji does the current user have on this message (if any)?
  const myEmoji = message?.reactions?.find((r) =>
    r.user_ids.includes(currentUserId)
  )?.emoji;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`absolute inset-0 z-40 transition-all duration-300 ${
          isOpen
            ? "bg-black/50 backdrop-blur-[2px] pointer-events-auto"
            : "bg-transparent pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Bottom Sheet */}
      <div
        ref={sheetRef}
        className={`absolute inset-x-0 bottom-0 z-50 transition-transform duration-300 ease-out ${
          isOpen ? "translate-y-0" : "translate-y-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Message actions"
      >
        <div className="bg-[#111113] rounded-t-3xl border-t border-white/10 shadow-2xl">
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-white/20" />
          </div>

          {/* Message preview */}
          {message && (
            <div className="px-5 py-3 border-b border-white/[0.06]">
              <p className="font-body text-xs text-foreground-muted line-clamp-2">
                {message.content}
              </p>
            </div>
          )}

          {/* Emoji reactions */}
          <div className="flex items-center justify-around px-6 py-5">
            {REACTIONS.map(({ emoji, label, bg, activeBg }) => {
              const isActive = myEmoji === emoji;
              return (
                <button
                  key={label}
                  onClick={() => handleReaction(emoji)}
                  className={`${isActive ? activeBg : bg} w-12 h-12 rounded-full flex items-center justify-center text-xl shadow-lg
                    active:scale-90 hover:scale-110 transition-transform duration-150
                    ${isActive ? "ring-2 ring-white/60 ring-offset-2 ring-offset-[#111113]" : ""}`}
                  aria-label={`${isActive ? "Remove" : "Add"} ${label} reaction`}
                >
                  {emoji}
                </button>
              );
            })}
          </div>

          {/* Action rows */}
          <div className="mx-4 mb-4 rounded-2xl bg-white/[0.06] overflow-hidden divide-y divide-white/[0.06]">
            {/* Reply */}
            <button
              className="w-full flex items-center gap-3 px-4 py-4 text-left hover:bg-white/[0.05] active:bg-white/10 transition-colors"
              onClick={() => {
                if (message) onReply(message);
                onClose();
              }}
            >
              <Reply size={18} className="text-foreground-muted shrink-0" />
              <span className="font-body text-sm text-foreground">Reply</span>
            </button>

            {/* Copy */}
            <button
              className="w-full flex items-center gap-3 px-4 py-4 text-left hover:bg-white/[0.05] active:bg-white/10 transition-colors"
              onClick={() => {
                if (message) onCopy(message);
                onClose();
              }}
            >
              <Copy size={18} className="text-foreground-muted shrink-0" />
              <span className="font-body text-sm text-foreground">Copy</span>
            </button>
          </div>

          {/* Safe-area spacer for mobile */}
          <div className="h-2" />
        </div>
      </div>
    </>
  );
}
