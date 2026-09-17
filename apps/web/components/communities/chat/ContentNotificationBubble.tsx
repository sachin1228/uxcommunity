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
import { fmtTimeAgo } from "./chatUtils";
import type { CachedContentEvent, ContentEventKind } from "@/lib/communities/cache";

interface ContentNotificationBubbleProps {
  event: CachedContentEvent;
  communityId: string;
  currentUserId: string;
}

/** Icon shown in the card thumbnail per content kind. */
const KIND_ICON: Record<ContentEventKind, LucideIcon> = {
  thread:    MessageCircle,
  showcase:  ImageIcon,
  resource:  LayoutTemplate,
  event:     CalendarDays,
};

const KIND_NOUN: Record<ContentEventKind, string> = {
  thread:    "thread",
  showcase:  "showcase",
  resource:  "resource",
  event:     "event",
};

function hrefFor(kind: ContentEventKind, communityId: string, id: string): string {
  switch (kind) {
    case "thread":   return `/dashboard/communities/${communityId}/threads/${id}`;
    case "showcase": return `/dashboard/communities/${communityId}/showcase/${id}`;
    case "resource": return `/dashboard/communities/${communityId}/resources/${id}`;
    case "event":    return `/dashboard/communities/${communityId}/events/${id}`;
  }
}

/**
 * The permanent "John created a …" card in the chat timeline. Unlike the
 * thread-only bubble that preceded it, this renders for showcase posts,
 * resources and events too, and — because it is seeded from the bootstrap
 * history (not just session state) — survives reloads exactly like a normal
 * message bubble does.
 */
export function ContentNotificationBubble({
  event,
  communityId,
  currentUserId,
}: ContentNotificationBubbleProps) {
  const sender = event.users;
  // The avatar must key off the real display name — "You" is only the label.
  const senderName = sender?.name ?? "Someone";
  const name = event.user_id === currentUserId ? "You" : senderName;
  const timeAgo = fmtTimeAgo(event.created_at);
  const Icon = KIND_ICON[event.kind] ?? MessageCircle;
  const href = hrefFor(event.kind, communityId, event.id);

  return (
    <div className="flex items-start gap-2 w-full px-5 mt-3">
      {/* Avatar column */}
      <div className="w-7 shrink-0 mt-0.5">
        {sender && (
          <ChatAvatar name={senderName} url={sender.avatar_url} size={7} />
        )}
      </div>

      {/* Content column */}
      <div className="flex-1 min-w-0">
        {/* Header line */}
        <p className="font-body text-[11px] text-foreground-muted mb-1.5 ml-0.5">
          <span className="font-semibold text-foreground">{name}</span>
          {` created a ${KIND_NOUN[event.kind]}`}
          <span className="mx-1.5 opacity-40">·</span>
          {timeAgo}
        </p>

        {/* Card — a Next <Link>: a raw anchor would force a full page reload
            and throw away every module-level client cache. */}
        <Link
          href={href}
          className="flex items-center gap-3 rounded-xl bg-surface-raised border border-white/[0.06] px-3 py-2.5 hover:bg-white/[0.06] transition-colors group"
        >
          <div className="h-9 w-9 shrink-0 rounded-lg overflow-hidden flex items-center justify-center bg-white/[0.06]">
            <Icon size={18} strokeWidth={2.5} className="text-foreground-muted" />
          </div>

          <div className="flex-1 min-w-0">
            <p className="font-body text-sm font-medium text-foreground line-clamp-2 leading-snug">
              {event.title}
            </p>
            <p className="font-body text-xs text-accent mt-1.5 flex items-center gap-0.5 group-hover:underline">
              View {KIND_NOUN[event.kind]}
              <ChevronRight size={12} strokeWidth={2.5} />
            </p>
          </div>
        </Link>
      </div>
    </div>
  );
}
