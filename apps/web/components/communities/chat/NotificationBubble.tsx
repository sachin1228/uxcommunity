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

interface KindAccent {
  icon: LucideIcon;
  label: string;
  /**
   * Tile gradient — the saturated pair of the hue. `-600` (the vivid mid stop)
   * down to `-900` (the deep stop in light mode, the bright one in dark), which
   * is what keeps the tile as saturated as the reference in *both* themes.
   * The `-800` end read as mud in dark mode.
   */
  from: string;
  to: string;
  /** Ink for the small kind glyph on the card's label row. */
  ink: string;
  /** Ring tint for the bubble and its payload card, mixed down by the caller. */
  ring: string;
}

/**
 * One accent per kind, taken from the design-system color scales rather than
 * new colors: the tile is a gradient between two stops of the hue, and the
 * ring is mixed from the same hue so the bubble itself is tinted to match.
 * Threads ink blue, showcase pink, resources purple, events amber — so four
 * created things never read as the same card.
 */
const KIND_ACCENT: Record<ContentEventKind, KindAccent> = {
  thread: {
    icon: MessageCircle,
    label: "Thread",
    from: "var(--ds-blue-600)",
    to: "var(--ds-blue-900)",
    ink: "var(--ds-blue-900)",
    ring: "var(--ds-blue-600)",
  },
  showcase: {
    icon: ImageIcon,
    label: "Showcase",
    from: "var(--ds-pink-600)",
    to: "var(--ds-pink-900)",
    ink: "var(--ds-pink-900)",
    ring: "var(--ds-pink-600)",
  },
  resource: {
    icon: LayoutTemplate,
    label: "Resource",
    from: "var(--ds-purple-600)",
    to: "var(--ds-purple-900)",
    ink: "var(--ds-purple-900)",
    ring: "var(--ds-purple-600)",
  },
  event: {
    icon: CalendarDays,
    label: "Event",
    from: "var(--ds-amber-600)",
    to: "var(--ds-amber-900)",
    ink: "var(--ds-amber-900)",
    ring: "var(--ds-amber-600)",
  },
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
 * same grammar as a chat message: avatar column, a raised bubble with a tail on
 * its first line, the sender's name in their per-user color, and the timestamp
 * inside the bubble's bottom-right corner.
 *
 * The payload is one nested card inside the bubble — a gradient icon tile, the
 * uppercase kind label, the title (plus an optional subtitle) and a chevron —
 * with both the card and the bubble ringed in the kind's accent, so a created
 * event reads differently from a created resource at a glance.
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
  const accent = KIND_ACCENT[kind];
  const Icon = accent.icon;
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
        <div
          className="relative select-none rounded-[14px] rounded-tl-none bg-surface-raised px-2.5 pt-2 pb-1.5"
          // Hairline ring in the kind's hue plus the bubble's usual lift. The
          // ring is an inline color-mix() because Tailwind cannot apply an
          // opacity modifier to a bare var() color (it would emit
          // rgb(var(--x) / 0.26), which never resolves for a hex token).
          style={{
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accent.ring} 40%, transparent), var(--shadow-sm)`,
          }}
        >
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
            aria-label={`View ${accent.label.toLowerCase()}: ${title}`}
            className="group/card mt-1.5 flex items-center gap-2.5 rounded-[12px] bg-black/[0.02] p-1.5 pr-2.5 transition-colors hover:bg-black/[0.05] dark:bg-white/[0.04] dark:hover:bg-white/[0.08]"
            style={{
              boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accent.ring} 60%, transparent)`,
            }}
          >
            {/* Kind tile — gradient of the kind's hue, glossy top edge */}
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[12px] text-white"
              style={{
                backgroundImage: `linear-gradient(145deg, ${accent.from}, ${accent.to})`,
                boxShadow:
                  "inset 0 1px 0 rgb(255 255 255 / 0.22), var(--shadow-xs)",
              }}
            >
              {thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumbnailUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <Icon size={20} strokeWidth={2.25} />
              )}
            </span>

            {/* Kind label + title + optional subtitle */}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-1 font-body text-[11px] font-semibold uppercase leading-none tracking-[0.14em] text-foreground-muted">
                <Icon size={12} strokeWidth={2.75} style={{ color: accent.ink }} />
                {accent.label}
              </span>
              <span className="mt-1.5 font-body text-sm font-medium leading-snug text-foreground line-clamp-2">
                {title}
              </span>
              {subtitle && (
                <span className="mt-0.5 truncate font-body text-xs leading-snug text-foreground-muted">
                  {subtitle}
                </span>
              )}
            </span>

            <ChevronRight
              size={16}
              strokeWidth={2.5}
              className="shrink-0 text-foreground-muted transition-transform group-hover/card:translate-x-0.5"
            />
          </Link>

          {/* Timestamp, message-bubble style. The exact time is the label; the
              relative "6h ago" rides along as the tooltip. */}
          <div className="mt-0.5 flex items-center justify-end">
            <span
              className="font-body text-[11px] text-foreground-muted"
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
