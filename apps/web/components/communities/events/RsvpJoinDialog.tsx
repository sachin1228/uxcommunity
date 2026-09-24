"use client";

import { Check, MessageSquare, Pin, UserCheck } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";

/**
 * The confirmation in front of "I'm going".
 *
 * RSVP-ing is not only a number: it is how somebody enters the event's group
 * chat, and that room appears in their sidebar (pinned, until the event date).
 * An RSVP that silently did all of that would be a surprise, so the button
 * opens this dialog first and the RSVP is sent only from its confirm button —
 * one tap is the whole decision, the member just gets to see what it means.
 */

function fmtEventDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function RsvpJoinDialog({
  open,
  onClose,
  onConfirm,
  eventTitle,
  eventDate,
  pending,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  eventTitle: string;
  /** The event's start — the anchor for "pinned until". */
  eventDate: string;
  pending: boolean;
  error?: string | null;
}) {
  return (
    <Modal
      open={open}
      onClose={pending ? () => undefined : onClose}
      title="Confirm your RSVP"
      maxWidth="max-w-md"
    >
      <p className="text-pretty font-body text-sm leading-6 text-foreground-muted">
        RSVP-ing to <span className="font-medium text-foreground">{eventTitle}</span> also joins you
        to the event&apos;s group chat, where everybody going talks about it.
      </p>

      <ul className="mt-5 flex flex-col gap-3">
        <li className="flex items-start gap-3">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-raised text-foreground-muted">
            <UserCheck strokeWidth={2.5} size={13} />
          </span>
          <p className="font-body text-sm leading-6 text-foreground-muted">
            You count as going, and the host sees your RSVP.
          </p>
        </li>
        <li className="flex items-start gap-3">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-raised text-foreground-muted">
            <MessageSquare strokeWidth={2.5} size={13} />
          </span>
          <p className="font-body text-sm leading-6 text-foreground-muted">
            You join the event&apos;s group chat and can post there straight away.
          </p>
        </li>
        <li className="flex items-start gap-3">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-raised text-foreground-muted">
            <Pin strokeWidth={2.5} size={13} />
          </span>
          <p className="font-body text-sm leading-6 text-foreground-muted">
            It is pinned to the top of your sidebar until{" "}
            <span className="font-medium text-foreground">{fmtEventDate(eventDate)}</span>. Leave
            the RSVP and you leave the room.
          </p>
        </li>
      </ul>

      {error && (
        <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-body text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="mt-6 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="modal-btn modal-btn-secondary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="modal-btn modal-btn-primary"
        >
          {pending ? <Spinner size={15} className="text-white" /> : <Check strokeWidth={2.5} size={15} />}
          {pending ? "Confirming…" : "Confirm RSVP"}
        </button>
      </div>
    </Modal>
  );
}
