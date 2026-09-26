"use client";

import Link from "next/link";
import {
  CalendarDays,
  ChevronRight,
  Figma,
  FileText,
  MessageCircle,
  Package,
  Play,
  Sparkles,
  Type,
  Users,
  Video,
  Wrench,
  BookOpen,
  Shapes,
  Palette,
  LayoutTemplate,
  type LucideIcon,
} from "lucide-react";
import { ChatAvatar } from "./ChatAvatar";
import { fmtTime, formatCommenters } from "./chatUtils";
import { MessageBubbleTail } from "./MessageBubbleTail";
import {
  NotificationHoverActions,
  NotificationReactionPills,
} from "./NotificationHoverActions";
import { userColorVar } from "@/lib/communities/user-color";
import { RESOURCE_TYPES } from "@/lib/communities/models/resources";
import type { CachedContentEvent, ContentEventKind } from "@/lib/communities/cache";
import {
  KIND_THEME,
  firstLine,
  fmtEventSchedule,
  prettyUrl,
  splitBody,
} from "@/lib/communities/content-notifications";
import { eventZoneLabel, eventZoneTooltip } from "@/lib/communities/event-display";

interface ContentNotificationBubbleProps {
  event: CachedContentEvent;
  communityId: string;
  currentUserId: string;
  /** Toggle/replace the current user's emoji reaction on this card. */
  onReaction?: (emoji: string) => void;
  /** Open the composer with this card as the reply anchor. */
  onReply?: () => void;
}

/** Eyebrow / fallback tile icon per content kind. */
const KIND_ICON: Record<ContentEventKind, LucideIcon> = {
  thread:    MessageCircle,
  showcase:  Sparkles,
  resource:  FileText,
  event:     CalendarDays,
};

/** Resource-type icon map — mirrors resourceTypeIcons.tsx (raw components). */
const RESOURCE_TILE_ICON: Record<string, LucideIcon> = {
  figma:       Figma,
  article:     FileText,
  tool:        Wrench,
  video:       Play,
  book:        BookOpen,
  font:        Type,
  icon_pack:   Shapes,
  color:       Palette,
  template:    LayoutTemplate,
  inspiration: Sparkles,
  other:       Package,
};

function hrefFor(kind: ContentEventKind, communityId: string, id: string): string {
  switch (kind) {
    case "thread":   return `/dashboard/communities/${communityId}/threads/${id}`;
    case "showcase": return `/dashboard/communities/${communityId}/showcase/${id}`;
    case "resource": return `/dashboard/communities/${communityId}/resources/${id}`;
    case "event":    return `/dashboard/communities/${communityId}/events/${id}`;
  }
}

function resourceTypeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return RESOURCE_TYPES.find((t) => t.value === value)?.label ?? null;
}

/** "a thread" vs "an event" — the vowel-taking nouns get "an". */
function withArticle(noun: string): string {
  return /^[aeiou]/i.test(noun) ? `an ${noun}` : `a ${noun}`;
}

/**
 * Colored eyebrow above the card title — "✦ SHOWCASE", "📅 EVENT" — tinted
 * per content kind; resources surface their concrete type instead. On the
 * author's own blue bubble everything is white, matching the message text.
 */
function Eyebrow({ event, isMe }: { event: CachedContentEvent; isMe: boolean }) {
  const theme = KIND_THEME[event.kind];
  const Icon = KIND_ICON[event.kind];
  const resourceLabel = resourceTypeLabel(event.meta?.resource_type);

  return (
    <span
      className={`flex items-center gap-1.5 font-body text-[10px] font-bold tracking-[0.08em] uppercase ${
        isMe ? "text-accent-foreground" : ""
      }`}
      style={{ color: isMe ? undefined : theme.accent }}
    >
      <Icon size={12} strokeWidth={2.5} />
      {resourceLabel ?? theme.label}
    </span>
  );
}

/**
 * The permanent "John created a …" card in the chat timeline — rendered as a
 * rich preview card inside a WhatsApp-style chat bubble: left-aligned in a
 * raised bubble for other members, right-aligned in the own-message blue for
 * the author. Covers showcase posts, resources and events (threads render
 * through the same design via ThreadNotificationBubble).
 */
export function ContentNotificationBubble({
  event,
  communityId,
  currentUserId,
  onReaction,
  onReply,
}: ContentNotificationBubbleProps) {
  const sender = event.users;
  // The avatar must key off the real display name — "You" is only the label.
  const senderName = sender?.name ?? "Someone";
  const isMe = event.user_id === currentUserId;
  const name = isMe ? "You" : senderName;
  const href = hrefFor(event.kind, communityId, event.id);
  const meta = event.meta ?? null;
  const theme = KIND_THEME[event.kind];

  // Thumbnail precedence: real image > video poster > kind icon tile.
  const imageUrl = meta?.image_url ?? null;
  const posterUrl = imageUrl ? null : (meta?.video_poster ?? null);
  const TileIcon =
    event.kind === "resource" && meta?.resource_type
      ? (RESOURCE_TILE_ICON[meta.resource_type] ?? KIND_ICON.resource)
      : KIND_ICON[event.kind];

  // Subtitle line under the title — kind-dependent. Thread and showcase
  // bodies store their whole text in `title`, so split headline vs body.
  let title = event.title;
  let subtitle: string | null = null;
  if (event.kind === "thread" || event.kind === "showcase") {
    const split = splitBody(event.title);
    title = split.title;
    subtitle = split.subtitle ?? (event.kind === "showcase" && meta?.description ? firstLine(meta.description, 80) : null);
  } else if (event.kind === "event") {
    // The chat card is often the first place a member meets an event, so the
    // time it shows names the zone it was read in — see event-display.
    subtitle = meta?.event_date
      ? `${fmtEventSchedule(meta.event_date)} (${eventZoneLabel(meta.event_date)})`
      : null;
  } else if (event.kind === "resource") {
    subtitle = meta?.url ? prettyUrl(meta.url) : null;
  }

  const rsvpCount = event.kind === "event" ? Math.max(0, meta?.rsvp_count ?? 0) : null;
  const goingLabel =
    rsvpCount !== null
      ? rsvpCount > 0
        ? `+${rsvpCount} going`
        : "Be the first to go"
      : null;

  const reactions = event.reactions ?? [];
  // How much discussion the card has on its own detail page — surfaced here so
  // members can judge it without opening the item first, along with the people
  // who spoke most recently.
  const commentCount = Math.max(0, meta?.comment_count ?? 0);
  const commenterNames = formatCommenters(meta?.comment_users);

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

          {/* Header line — "You created a showcase" */}
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
            {` created ${withArticle(theme.label.toLowerCase())}`}
          </p>

          {/* Card — a Next <Link>: a raw anchor would force a full page reload
              and throw away every module-level client cache. */}
          <Link
            href={href}
            className={`flex items-stretch gap-2.5 rounded-xl border overflow-hidden transition-colors ${
              isMe
                ? "bg-black/20 border-white/15 hover:bg-black/30"
                : "bg-black/[0.03] border-black/[0.06] hover:bg-black/[0.06] dark:bg-white/[0.04] dark:border-white/[0.08] dark:hover:bg-white/[0.08]"
            }`}
          >
            {/* Thumbnail — image, video poster, or tinted icon tile. Stretches
                to the card's full height (min 64px) instead of a fixed square. */}
            <div className="relative w-[64px] min-h-[64px] shrink-0 overflow-hidden">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl}
                  alt=""
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
                  <TileIcon
                    size={24}
                    strokeWidth={2.5}
                    style={{
                      color: isMe ? "rgba(255,255,255,0.85)" : theme.tileFg,
                    }}
                  />
                </div>
              )}
            </div>

            {/* Text column */}
            <div className="flex-1 min-w-0 py-1.5 pr-1">
              <Eyebrow event={event} isMe={isMe} />
              <p
                className={`font-body text-sm font-semibold line-clamp-1 leading-snug mt-0.5 ${
                  isMe ? "text-accent-foreground" : "text-foreground"
                }`}
              >
                {title || theme.label}
              </p>
              {subtitle && (
                <p
                  className={`font-body text-[11px] line-clamp-2 leading-snug mt-0.5 ${
                    isMe ? "text-accent-foreground/80" : "text-foreground-muted"
                  }`}
                  title={
                    event.kind === "event" && meta?.event_date
                      ? eventZoneTooltip(meta.event_date)
                      : undefined
                  }
                >
                  {subtitle}
                </p>
              )}
              {goingLabel && (
                <p
                  className={`font-body text-[10px] mt-1 flex items-center gap-1 ${
                    isMe ? "text-accent-foreground/80" : "text-foreground-muted"
                  }`}
                >
                  <Users size={10} strokeWidth={2.5} />
                  {goingLabel}
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

          {/* Bottom row: the discussion sits bottom-LEFT of the bubble, the
              timestamp bottom-right, exactly like a message bubble's footer. */}
          <div className="flex items-center gap-1.5 mt-0.5">
            {commentCount > 0 && (
              <span
                className={`flex min-w-0 items-center gap-1 font-body text-[10px] leading-none ${
                  isMe ? "text-accent-foreground opacity-80" : "text-foreground-muted"
                }`}
                title={
                  commenterNames
                    ? `${commentCount} ${commentCount === 1 ? "comment" : "comments"} · ${commenterNames}`
                    : `${commentCount} ${commentCount === 1 ? "comment" : "comments"}`
                }
              >
                <MessageCircle size={10} strokeWidth={2.5} className="shrink-0" />
                <span className="shrink-0 tabular-nums">{commentCount}</span>
                {commenterNames && (
                  <span className="truncate">
                    <span className="opacity-60">·&nbsp;</span>
                    {commenterNames}
                  </span>
                )}
              </span>
            )}
            <span
              className={`ml-auto shrink-0 font-mono text-[10px] ${
                isMe ? "text-accent-foreground opacity-70" : "text-foreground-muted"
              }`}
            >
              {fmtTime(event.created_at)}
            </span>
          </div>

          {/* Reaction pills overlap the bubble's bottom edge, like messages */}
          <NotificationReactionPills
            reactions={reactions}
            currentUserId={currentUserId}
            onReaction={(emoji) => onReaction?.(emoji)}
          />
            </div>
          </div>

            {/* Hover actions — emoji reaction + reply only (no delete/edit:
                the content is managed in its own tab). */}
            {onReaction && onReply ? (
              <NotificationHoverActions
                reactions={reactions}
                currentUserId={currentUserId}
                onReaction={onReaction}
                onReply={onReply}
                isOwn={isMe}
              />
            ) : null}
        </div>
        {reactions.length > 0 && <div className="h-4" />}
      </div>
    </div>
  );
}
