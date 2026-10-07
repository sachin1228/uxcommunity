"use client";

import { Modal } from "@/components/ui/Modal";
import { EventChatPreviewRow } from "./EventChatPreviewRow";

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
  return (
    <Modal open onClose={onClose} title="A group chat for everyone going" maxWidth="max-w-md">
      <p className="text-pretty font-body text-sm leading-6 text-foreground-muted">
        People RSVP to your event and join this chat — everyone going talks in one place.
      </p>

      {/* The room the moment it is made: only the creator is in it. */}
      <EventChatPreviewRow
        className="mt-5"
        eventTitle={eventTitle}
        eventDate={eventDate}
        eventEnd={eventEnd}
        coverImageUrl={coverImageUrl}
        memberCount={1}
      />

      <div className="mt-6 flex items-center justify-end">
        <button type="button" onClick={onClose} className="modal-btn modal-btn-secondary">
          Okay
        </button>
      </div>
    </Modal>
  );
}
