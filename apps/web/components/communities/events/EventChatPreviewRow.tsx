"use client";

import { Pin } from "lucide-react";
import { CommunityAvatar } from "@/components/communities/panel/CommunityAvatar";
import { eventChatName } from "@/lib/communities/event-chat-rules";

/**
 * An event's group chat drawn the way the sidebar will show it: same DP (date
 * badge included), same name, the pin mark and the member count. Always static
 * — a preview, not a control — so every surface that announces or confirms the
 * room (the created-event modal, the RSVP confirm) says the same thing about
 * it, and the room the member meets there is the room they scroll past
 * afterwards.
 */
export function EventChatPreviewRow({
  eventTitle,
  eventDate,
  eventEnd,
  coverImageUrl,
  memberCount,
  className = "",
}: {
  eventTitle: string;
  /** The event's start — the DP's date badge. */
  eventDate: string;
  /** The event's end (or its start when it has none) — the badge's LIVE window. */
  eventEnd: string | null;
  /** The event's cover, which the room wears as its own DP. */
  coverImageUrl: string | null;
  /** The room's current member count; null/undefined hides the line. */
  memberCount?: number | null;
  /** Spacing where the row sits (e.g. "mt-5"). */
  className?: string;
}) {
  const roomName = eventChatName(eventTitle);

  return (
    <div
      className={`flex items-center gap-[11px] rounded-lg border border-border px-[9px] py-[9px] ${className}`}
    >
      <CommunityAvatar
        imageUrl={coverImageUrl}
        name={roomName}
        type="event"
        eventDate={eventDate}
        eventEnd={eventEnd}
      />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex min-w-0 items-center gap-1">
          <span className="min-w-0 truncate font-body text-[14px] font-medium text-foreground">
            {roomName}
          </span>
          <span
            role="img"
            aria-label="Pinned until the event"
            title="Pinned until the event"
            className="inline-flex shrink-0 items-center text-foreground-muted"
          >
            <Pin strokeWidth={2.5} size={11} aria-hidden="true" />
          </span>
        </div>
        {memberCount != null && (
          <div className="font-body text-[11px] leading-none text-foreground-muted">
            {memberCount} member{memberCount === 1 ? "" : "s"}
          </div>
        )}
      </div>
    </div>
  );
}
