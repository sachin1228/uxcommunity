"use client";

import Link from "next/link";
import {
  ChevronRight,
  HelpCircle,
  MessageCircle,
  Lightbulb,
  Flag,
  Video,
  type LucideIcon,
} from "lucide-react";
import { ChatAvatar } from "./ChatAvatar";
import { fmtTime } from "./chatUtils";
import { MessageBubbleTail } from "./MessageBubbleTail";
import {
  NotificationHoverActions,
  NotificationReactionPills,
} from "./NotificationHoverActions";
import { userColorVar } from "@/lib/communities/user-color";
import type { CachedThreadEvent } from "@/lib/communities/cache";
import { THREAD_CATEGORIES } from "@/components/communities/threads/types";
import {
  KIND_THEME,
  firstLine,
} from "@/lib/communities/content-notifications";

interface ThreadNotificationBubbleProps {
  event: CachedThreadEvent;
  communityId: string;
  currentUserId: string;
  /** Toggle/replace the current user's emoji reaction on this card. */
  onReaction?: (emoji: string) => void;
  /** Open the composer with this card as the reply anchor. */
  onReply?: () => void;
}

function categoryLabel(value: string): string {
  return (
    THREAD_CATEGORIES.find((c) => c.value === value)?.label ?? value
  );
}

/** Icon shown in the thumbnail when there is no image attachment. */
const CATEGORY_ICON: Record<string, LucideIcon> = {
  question:   HelpCircle,
  discussion: MessageCircle,
  idea:       Lightbulb,
  feedback:   Flag,
};

/** Picks the first image attachment from a thread, if any. */
function thumbnailUrl(event: CachedThreadEvent): string | null {
  const img = event.attachments.find((a) =>
    a.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(a.name)
  );
  return img?.url ?? null;
}

/** First video attachment's poster frame, if any. */
function videoPosterUrl(event: CachedThreadEvent): string | null {
  return event.attachments.find((a) => a.type.startsWith("video/"))?.poster ?? null;
}

/**
 * The thread variant of the timeline's "created a …" card — same bubble-wrapped
 * rich card as ContentNotificationBubble, plus the thread's category badge.
 */
export function ThreadNotificationBubble({
  event,
  communityId,
  currentUserId,
  onReaction,
  onReply,
}: ThreadNotificationBubbleProps) {
  const sender  = event.users;
  const isMe    = event.user_id === currentUserId;
  // The avatar must always key off the real display name — "You" is only the
  // label. Otherwise the fallback renders "Y" (and its color) for the author's
  // own threads instead of their initials.
  const senderName = sender?.name ?? "Someone";
  const name    = isMe ? "You" : senderName;
  const imgUrl  = thumbnailUrl(event);
  const posterUrl = imgUrl ? null : videoPosterUrl(event);
  const label   = categoryLabel(event.category);
  const href    = `/dashboard/communities/${communityId}/threads/${event.id}`;
  const CatIcon = CATEGORY_ICON[event.category] ?? HelpCircle;
  const theme   = KIND_THEME.thread;

  return (
    <div
      data-content-id={event.id}
      className={`group flex w-full items-start gap-2 px-5 mt-2 ${
        isMe ? "justify-end" : "justify-start"
      }`}
    >
      {/* Avatar column — own notifications skip it, matching message bubbles */}
      {!isMe && (
        <div className="w-7 shrink-0 mt-0.5">
          {sender && (
            <ChatAvatar name={senderName} url={sender.avatar_url} size={7} />
          )}
        </div>
      )}

      {/* Bubble column — bubble + hover actions live in one inner row, exactly
          like MessageBubble: actions sit to the RIGHT of other members'
          bubbles and to the LEFT of own (right-aligned) bubbles. */}
      <div className="min-w-0 max-w-[65%]">
        <div className={`flex items-center gap-1 ${isMe ? "flex-row-reverse" : ""}`}>
          <div className="relative min-w-0">
        <div
          className={`relative select-none rounded-[10px] px-3 pt-2 pb-1.5 shadow-sm ${
            isMe
              ? "rounded-tr-none bg-[var(--ds-blue-800)] [--color-accent-foreground:white]"
              : "rounded-tl-none bg-surface-raised"
          }`}
        >
          <MessageBubbleTail
            side={isMe ? "right" : "left"}
            className={isMe ? "text-[var(--ds-blue-800)]" : "text-surface-raised"}
          />

          {/* Header line — "You created a thread" */}
          <p
            className={`font-body text-[11px] mb-1.5 ${
              isMe ? "text-accent-foreground" : "text-foreground-muted"
            }`}
          >
            <span
              className="font-semibold"
              style={!isMe ? { color: userColorVar(event.user_id) } : undefined}
            >
              {name}
            </span>
            {" created a thread"}
          </p>

          {/* Card row — a Next <Link>, not a raw <a>: the raw anchor caused a
              full page reload, which threw away every module-level cache
              (messages, sidebar, request cache) and forced the whole app to
              refetch after merely viewing a thread. */}
          <div className="flex items-stretch gap-2">
            <Link
              href={href}
              className={`flex items-stretch gap-2.5 flex-1 min-w-0 rounded-xl border overflow-hidden transition-colors ${
                isMe
                  ? "bg-black/20 border-white/15 hover:bg-black/30"
                  : "bg-black/[0.03] border-black/[0.06] hover:bg-black/[0.06] dark:bg-white/[0.04] dark:border-white/[0.08] dark:hover:bg-white/[0.08]"
              }`}
            >
              {/* Thumbnail — image, video poster, or tinted category tile.
                  Stretches to the card's full height (min 64px). */}
              <div className="relative w-[64px] min-h-[64px] shrink-0 overflow-hidden">
                {imgUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imgUrl}
                    alt={event.title}
                    className="absolute inset-0 h-full w-full object-cover"
                    loading="lazy"
                    draggable={false}
                  />
                ) : posterUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={posterUrl}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover"
                      loading="lazy"
                      draggable={false}
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white">
                        <Video size={12} strokeWidth={2.5} />
                      </span>
                    </div>
                  </>
                ) : (
                  <div
                    className="flex h-full w-full items-center justify-center"
                    style={{
                      backgroundColor: isMe ? "rgba(255,255,255,0.10)" : theme.tileBg,
                    }}
                  >
                    <CatIcon
                      size={24}
                      strokeWidth={2.5}
                      style={{
                        color: isMe ? "rgba(255,255,255,0.85)" : theme.tileFg,
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Text */}
              <div className="flex-1 min-w-0 py-1.5 pr-1">
                <span
                  className={`flex items-center gap-1.5 font-body text-[10px] font-bold tracking-[0.08em] uppercase ${
                    isMe ? "text-accent-foreground" : ""
                  }`}
                  style={{ color: isMe ? undefined : theme.accent }}
                >
                  <MessageCircle size={12} strokeWidth={2.5} />
                  Thread
                </span>
                <p
                  className={`font-body text-sm font-semibold line-clamp-1 leading-snug mt-0.5 ${
                    isMe ? "text-accent-foreground" : "text-foreground"
                  }`}
                >
                  {event.title}
                </p>
                {event.attachments.length > 0 && (
                  <p
                    className={`font-body text-[11px] line-clamp-1 leading-snug mt-0.5 ${
                      isMe ? "text-accent-foreground/80" : "text-foreground-muted"
                    }`}
                  >
                    {event.attachments.length} attachment{event.attachments.length > 1 ? "s" : ""}
                  </p>
                )}
              </div>

              {/* Chevron affordance */}
              <div className="flex items-center pr-2.5">
                <ChevronRight
                  size={14}
                  strokeWidth={2.5}
                  className={isMe ? "text-accent-foreground/60" : "text-foreground-muted"}
                />
              </div>
            </Link>

            {/* Category badge */}
            <span
              className={`shrink-0 self-center font-body text-[11px] rounded-full px-2.5 py-1 whitespace-nowrap border ${
                isMe
                  ? "text-accent-foreground border-white/20 bg-black/20"
                  : "text-foreground-muted border-black/[0.08] bg-black/[0.03] dark:border-white/[0.10] dark:bg-white/[0.04]"
              }`}
            >
              {label}
            </span>
          </div>

          {/* Timestamp inside the bubble, bottom-right — same row as normal
              message bubbles (reactions reserve space below via the h-4 slot). */}
          <div className="flex items-center justify-end gap-1 mt-0.5">
            <span
              className={`font-mono text-[10px] ${
                isMe ? "text-accent-foreground opacity-70" : "text-foreground-muted"
              }`}
            >
              {fmtTime(event.created_at)}
            </span>
          </div>

          {/* Reaction pills overlap the bubble's bottom edge, like messages */}
          <NotificationReactionPills
            reactions={event.reactions ?? []}
            currentUserId={currentUserId}
            onReaction={(emoji) => onReaction?.(emoji)}
          />
            </div>
          </div>

            {/* Hover actions — emoji reaction + reply only (no delete/edit). */}
            {onReaction && onReply ? (
              <NotificationHoverActions
                reactions={event.reactions ?? []}
                currentUserId={currentUserId}
                onReaction={onReaction}
                onReply={onReply}
                isOwn={isMe}
              />
            ) : null}
        </div>
        {(event.reactions?.length ?? 0) > 0 && <div className="h-4" />}
      </div>
    </div>
  );
}
