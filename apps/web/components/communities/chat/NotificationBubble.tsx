"use client";

import Link from "next/link";
import {
  CalendarDays,
  ChevronRight,
  Image as ImageIcon,
  LayoutTemplate,
  MessageCircle,
  type LucideIcon,
} from "lucide-react";
import { ChatAvatar } from "./ChatAvatar";
import { MessageBubbleTail } from "./MessageBubbleTail";
import { fmtTime, fmtTimeAgo } from "./chatUtils";
import { userColorVar } from "@/lib/communities/user-color";
import type { ContentEventKind } from "@/lib/communities/cache";

/**
 * Per-kind accent, taken from the design-system color scales. The -100 stop
 * tints the card's icon tile and the -900 stop inks the glyph and the kind
 * label. Those two stops are the light-mode / dark-mode pair of the same hue
 * (dark -100 is a deep tint, dark -900 a bright ink), so a single pair covers
 * both themes with no hard-coded hex and no `dark:` overrides.
 */
const KIND_THEME: Record<
  ContentEventKind,
  { icon: LucideIcon; label: string; ink: string; tile: string }
> = {
  thread:   { icon: MessageCircle,  label: "Thread",   ink: "var(--ds-blue-900)",   tile: "var(--ds-blue-100)"   },
  showcase: { icon: ImageIcon,      label: "Showcase", ink: "var(--ds-pink-900)",   tile: "var(--ds-pink-100)"   },
  resource: { icon: LayoutTemplate, label: "Resource", ink: "var(--ds-purple-900)", tile: "var(--ds-purple-100)" },
  event:    { icon: CalendarDays,   label: "Event",    ink: "var(--ds-amber-900)",  tile: "var(--ds-amber-100)"  },
};

interface NotificationBubbleProps {
  kind: ContentEventKind;
  title: string;
  /** Absolute link to the thread / showcase post / resource / event. */
  href: string;
  createdAt: string;
  /** Author's real display name — the avatar keys off this, never "You". */
  senderName: string | null;
  senderId: string;
  avatarUrl: string | null;
  /** The current user created it, so the name row reads "You". */
  isMe: boolean;
  /** Optional second line under the title (event date/time, thread category). */
  subtitle?: string | null;
  /** First image attachment, shown in the tile instead of the kind glyph. */
  thumbnailUrl?: string | null;
}

/**
 * A "John created a thread/resource/event/showcase" entry, rendered with the
 * same grammar as a chat message: avatar column, a raised bubble with a tail
 * on its first line, the sender's name in their per-user color, and the
 * timestamp inside the bubble's bottom-right corner.
 *
 * The payload is one nested card that carries the kind's accent — a tinted
 * icon tile, an uppercase kind label, the title (plus an optional subtitle),
 * and a chevron — so a created resource reads differently from a created event
 * at a glance, the way the reference design does.
 *
 * The card is a Next <Link>, not a raw anchor: a raw anchor forces a full page
 * reload and throws away every module-level client cache.
 */
export function NotificationBubble({
  kind,
  title,
  href,
  createdAt,
  senderName,
  senderId,
  avatarUrl,
  isMe,
  subtitle = null,
  thumbnailUrl = null,
}: NotificationBubbleProps) {
  const theme = KIND_THEME[kind];
  const Icon = theme.icon;
  // "You" is only the label — the avatar and its color still key off the real
  // name so the author's own cards don't render as "Y".
  const name = isMe ? "You" : senderName ?? "Someone";

  return (
    <div className="flex w-full items-start gap-2 px-5 mt-3">
      {/* Avatar column */}
      <div className="w-7 shrink-0 mt-0.5">
        {senderName && <ChatAvatar name={senderName} url={avatarUrl} size={7} />}
      </div>

      {/* Content column */}
      <div className="min-w-0 max-w-[26rem]">
        <div className="relative select-none rounded-[10px] rounded-tl-none bg-surface-raised px-2.5 pt-2 pb-1.5 shadow-sm">
          <MessageBubbleTail side="left" className="text-surface-raised" />

          {/* Sender name, colored per user — same row as a message bubble */}
          <p
            className="font-body text-xs font-semibold leading-4 break-words"
            style={{ color: userColorVar(senderId) }}
          >
            {name}
          </p>

          {/* Nested card — the notification's payload */}
          <Link
            href={href}
            aria-label={`View ${theme.label.toLowerCase()}: ${title}`}
            className="group/card mt-1.5 flex items-center gap-2.5 rounded-xl bg-accent-soft p-2 pr-2.5 shadow-xs transition-colors hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
          >
            {/* Kind tile */}
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px]"
              style={{ backgroundColor: theme.tile, color: theme.ink }}
            >
              {thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumbnailUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <Icon size={18} strokeWidth={2.5} />
              )}
            </span>

            {/* Kind label + title + optional subtitle */}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-1 font-body text-[10px] font-semibold uppercase leading-none tracking-[0.12em] text-foreground-muted">
                <Icon size={11} strokeWidth={2.75} style={{ color: theme.ink }} />
                {theme.label}
              </span>
              <span className="mt-1 font-body text-sm font-medium leading-snug text-foreground line-clamp-2">
                {title}
              </span>
              {subtitle && (
                <span className="mt-0.5 truncate font-body text-[11px] leading-snug text-foreground-muted">
                  {subtitle}
                </span>
              )}
            </span>

            <ChevronRight
              size={15}
              strokeWidth={2.5}
              className="shrink-0 text-foreground-subtle transition-transform group-hover/card:translate-x-0.5"
            />
          </Link>

          {/* Timestamp, message-bubble style. The exact time is the label; the
              relative "6h ago" rides along as the tooltip. */}
          <div className="mt-0.5 flex items-center justify-end">
            <span
              className="font-mono text-[10px] text-foreground-muted"
              title={fmtTimeAgo(createdAt)}
            >
              {fmtTime(createdAt)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
