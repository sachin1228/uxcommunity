"use client";

import Link from "next/link";
import { Pin } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { CommunityAvatar } from "@/components/communities/panel/CommunityAvatar";
import { eventChatName } from "@/lib/communities/event-chat-rules";

/**
 * Shown right after an event is created: the event exists, so its group chat
 * does too. The room is drawn the way the sidebar will show it — same DP, same
 * name, pinned the same way — so the creator recognises it there later, and the
 * one line of copy says the part the row can't: the pin runs out with the
 * event, and people join by RSVP.
 */
export function EventGroupCreatedModal({
  eventTitle,
  eventDate,
  eventEnd,
  coverImageUrl,
  chatCommunityId,
  onClose,
}: {
  eventTitle: string;
  /** The event's start — the DP's date badge. */
  eventDate: string;
  /** The event's end (or its start when it has none) — the badge's LIVE window. */
  eventEnd: string | null;
  /** The event's cover, which the room wears as its own DP. */
  coverImageUrl: string | null;
  /** The room that was created for this event. */
  chatCommunityId: string;
  onClose: () => void;
}) {
  // The room's name is the event's, capped the same way — so this row says
  // exactly what the sidebar will. See eventChatName.
  const roomName = eventChatName(eventTitle);

  return (
    <Modal open onClose={onClose} title="Your event's group chat is ready" maxWidth="max-w-md">
      <p className="text-pretty font-body text-sm leading-6 text-foreground-muted">
        It&apos;s pinned at the top of your sidebar until the event is over — everyone going joins
        it by RSVP.
      </p>

      {/* The sidebar's row, pre-rendered: same avatar (date badge included),
          same name, same pin mark and member line, so the room the creator
          meets here is the room they will scroll past tomorrow. The whole row
          is the link — exactly like the sidebar — with the Open chip as its
          visible affordance. */}
      <Link
        href={`/dashboard/communities/${chatCommunityId}`}
        onClick={onClose}
        className="mt-5 flex items-center gap-[11px] rounded-lg border border-border px-[9px] py-[9px] transition-colors hover:bg-surface-raised"
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
          <div className="font-body text-[11px] leading-none text-foreground-muted">
            {/* Only the creator is in the room the moment it is made. */}
            1 member
          </div>
        </div>
        <span className="modal-btn modal-btn-primary">Open</span>
      </Link>

      <div className="mt-6 flex items-center justify-end">
        <button type="button" onClick={onClose} className="modal-btn modal-btn-secondary">
          Okay
        </button>
      </div>
    </Modal>
  );
}
