"use client";

import {
  ChevronRight,
  HelpCircle,
  MessageCircle,
  Sparkles,
  BookOpen,
  Lightbulb,
  Flag,
  Briefcase,
  Users,
  type LucideIcon,
} from "lucide-react";
import { ChatAvatar } from "./ChatAvatar";
import { fmtTimeAgo } from "./chatUtils";
import type { CachedThreadEvent } from "@/lib/communities/cache";
import { THREAD_CATEGORIES } from "@/components/communities/threads/types";

interface ThreadNotificationBubbleProps {
  event: CachedThreadEvent;
  communityId: string;
  currentUserId: string;
}

function categoryLabel(value: string): string {
  return (
    THREAD_CATEGORIES.find((c) => c.value === value)?.label ?? value
  );
}

/** Icon shown in the thumbnail when there is no image attachment. */
const CATEGORY_ICON: Record<string, LucideIcon> = {
  question:      HelpCircle,
  discussion:    MessageCircle,
  showcase:      Sparkles,
  resource:      BookOpen,
  idea:          Lightbulb,
  feedback:      Flag,
  job:           Briefcase,
  collaboration: Users,
};

/** Picks the first image attachment from a thread, if any. */
function thumbnailUrl(event: CachedThreadEvent): string | null {
  const img = event.attachments.find((a) =>
    a.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(a.name)
  );
  return img?.url ?? null;
}

export function ThreadNotificationBubble({
  event,
  communityId,
  currentUserId,
}: ThreadNotificationBubbleProps) {
  const sender  = event.users;
  const isMe    = event.user_id === currentUserId;
  const name    = isMe ? "You" : (sender?.name ?? "Someone");
  const timeAgo = fmtTimeAgo(event.created_at);
  const imgUrl  = thumbnailUrl(event);
  const label   = categoryLabel(event.category);
  const href    = `/dashboard/communities/${communityId}/threads/${event.id}`;
  const CatIcon = CATEGORY_ICON[event.category] ?? HelpCircle;

  return (
    <div className="flex items-start gap-2 w-full px-5 mt-3">
      {/* Avatar column */}
      <div className="w-7 shrink-0 mt-0.5">
        {sender && (
          <ChatAvatar name={name} url={sender.avatar_url} size={7} />
        )}
      </div>

      {/* Content column */}
      <div className="flex-1 min-w-0">
        {/* Header line */}
        <p className="font-body text-[11px] text-foreground-muted mb-1.5 ml-0.5">
          <span className="font-semibold text-foreground">{name}</span>
          {" created a new thread"}
          <span className="mx-1.5 opacity-40">·</span>
          {timeAgo}
        </p>

        {/* Card row */}
        <div className="flex items-center gap-3">
          {/* Thread card */}
          <a
            href={href}
            className="flex items-center gap-3 flex-1 min-w-0 rounded-xl bg-surface-raised border border-white/[0.06] px-3 py-2.5 hover:bg-white/[0.06] transition-colors group"
          >
            {/* Thumbnail */}
            <div className="h-12 w-12 shrink-0 rounded-lg overflow-hidden flex items-center justify-center bg-white/[0.06]">
              {imgUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imgUrl}
                  alt={event.title}
                  className="h-full w-full object-cover"
                />
              ) : (
                <CatIcon size={22} strokeWidth={1.5} className="text-foreground-muted" />
              )}
            </div>

            {/* Text */}
            <div className="flex-1 min-w-0">
              <p className="font-body text-sm font-semibold text-foreground truncate leading-snug">
                {event.title}
              </p>
              <p className="font-body text-xs text-foreground-muted line-clamp-1 leading-snug mt-0.5">
                {event.description}
              </p>
              <p className="font-body text-xs text-accent mt-1 flex items-center gap-0.5 group-hover:underline">
                View Thread
                <ChevronRight size={12} strokeWidth={2.5} />
              </p>
            </div>
          </a>

          {/* Category badge */}
          <span className="shrink-0 font-body text-xs text-foreground-muted border border-white/[0.12] rounded-full px-3 py-1 bg-surface-raised whitespace-nowrap">
            {label}
          </span>
        </div>
      </div>
    </div>
  );
}
