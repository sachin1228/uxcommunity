"use client";

import Link from "next/link";
import { MessageSquare, Pin, Users } from "lucide-react";
import { Modal } from "@/components/ui/Modal";

function fmtEventDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Shown right after an event is created: the event exists, so its group chat
 * does too. The creator has never seen this room before, so the modal says what
 * was made, where to find it, and how other people get in — people join it by
 * RSVP-ing to the event, which is worth knowing before the first attendee
 * arrives in a room the host forgot about.
 */
export function EventGroupCreatedModal({
  eventTitle,
  eventDate,
  chatCommunityId,
  onClose,
}: {
  eventTitle: string;
  /** The event's start — the anchor for "pinned until". */
  eventDate: string;
  /** The room that was created for this event. */
  chatCommunityId: string;
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} title="Your event's group chat is ready" maxWidth="max-w-md">
      <p className="text-pretty font-body text-sm leading-6 text-foreground-muted">
        A community group for{" "}
        <span className="font-medium text-foreground">{eventTitle}</span> was created along with the
        event. This is where everybody going can talk about it in one place.
      </p>

      <ul className="mt-5 flex flex-col gap-3">
        <li className="flex items-start gap-3">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-raised text-foreground-muted">
            <Pin strokeWidth={2.5} size={13} />
          </span>
          <p className="text-pretty font-body text-sm leading-6 text-foreground-muted">
            It sits at the top of your sidebar, pinned until{" "}
            <span className="font-medium text-foreground">{fmtEventDate(eventDate)}</span>.
          </p>
        </li>
        <li className="flex items-start gap-3">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-raised text-foreground-muted">
            <Users strokeWidth={2.5} size={13} />
          </span>
          <p className="text-pretty font-body text-sm leading-6 text-foreground-muted">
            People join it by RSVP-ing to your event — they are asked, and their RSVP is what puts
            them in the room.
          </p>
        </li>
        <li className="flex items-start gap-3">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-raised text-foreground-muted">
            <MessageSquare strokeWidth={2.5} size={13} />
          </span>
          <p className="text-pretty font-body text-sm leading-6 text-foreground-muted">
            You can post there straight away — say hello, share the plan, answer questions.
          </p>
        </li>
      </ul>

      <div className="mt-6 flex items-center justify-end gap-3">
        <button type="button" onClick={onClose} className="modal-btn modal-btn-secondary">
          Done
        </button>
        <Link
          href={`/dashboard/communities/${chatCommunityId}`}
          onClick={onClose}
          className="modal-btn modal-btn-primary"
        >
          <MessageSquare strokeWidth={2.5} size={15} />
          Open group chat
        </Link>
      </div>
    </Modal>
  );
}
