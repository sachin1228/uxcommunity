"use client";

import { Pin } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { CommunityAvatar } from "@/components/communities/panel/CommunityAvatar";
import { eventChatName } from "@/lib/communities/event-chat-rules";

/**
 * Shown right after an event is created: the event exists, so its group chat
 * does too. The copy says what the room is for — gathering the people going,
 * who RSVP their way in and talk in one place — and the row draws it the way
 * the sidebar will show it, so the creator recognises it there, pinned. Okay
 * is the only action; the room opens from that pin.
 */
export function EventGroupCreatedModal({
  eventTitle,
  eventDate,
  eventEnd,
  coverImageUrl,
  onClose,
}: {
  eventTitle: string;
  /** The event's start — the DP's date badge. */
  eventDate: string;
  /** The event's end (or its start when it has none) — the badge's LIVE window. */
  eventEnd: string | null;
  /** The event's cover, which the room wears as its own DP. */
  coverImageUrl: string | null;
  onClose: () => void;
}) {
  // The room's name is the event's, capped the same way — so this row says
  // exactly what the sidebar will. See eventChatName.
  const roomName = eventChatName(eventTitle);

  return (
    <Modal open onClose={onClose} title="A group chat for everyone going" maxWidth="max-w-md">
      <p className="text-pretty font-body text-sm leading-6 text-foreground-muted">
        People RSVP to your event and join this chat — everyone going talks in one place.
      </p>

      {/* The sidebar's row, pre-rendered: same avatar (date badge included),
          same name, same pin mark and member line, so the room the creator
          meets here is the room they will scroll past tomorrow. */}
      <div className="mt-5 flex items-center gap-[11px] rounded-lg border border-border px-[9px] py-[9px]">
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
          <div className="font-body text-[11px] leading-none text-foreground-muted">
            {/* Only the creator is in the room the moment it is made. */}
            1 member
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-end">
        <button type="button" onClick={onClose} className="modal-btn modal-btn-secondary">
          Okay
        </button>
      </div>
    </Modal>
  );
}
