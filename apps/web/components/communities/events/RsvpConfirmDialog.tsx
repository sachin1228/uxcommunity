"use client";

import { Check, LogOut, MessageSquare, Pin, PinOff, UserCheck, UserX } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";

/**
 * The confirmation in front of both halves of an RSVP.
 *
 * RSVP-ing is not only a number: it is how somebody enters the event's group
 * chat, and that room appears in their sidebar (pinned, until the event date).
 * Taking the RSVP back undoes all of it. Neither direction should happen under
 * a stray tap, so the button opens this dialog and the request is sent only
 * from its confirm button — one tap is the whole decision, the member just
 * gets to see what it means first.
 */

function fmtEventDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export type RsvpConfirmMode = "join" | "leave";

function Point({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-raised text-foreground-muted">
        {icon}
      </span>
      <p className="text-pretty font-body text-sm leading-6 text-foreground-muted">{children}</p>
    </li>
  );
}

export function RsvpConfirmDialog({
  mode,
  open,
  onClose,
  onConfirm,
  eventTitle,
  eventDate,
  isOwner = false,
  pending,
  error,
}: {
  mode: RsvpConfirmMode;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  eventTitle: string;
  /** The event's start — the anchor for "pinned until". */
  eventDate: string;
  /** The host keeps their own group chat, so backing out costs them less. */
  isOwner?: boolean;
  pending: boolean;
  error?: string | null;
}) {
  const joining = mode === "join";
  const date = fmtEventDate(eventDate);

  return (
    <Modal
      open={open}
      onClose={pending ? () => undefined : onClose}
      title={joining ? "Confirm your RSVP" : "Withdraw your RSVP?"}
      maxWidth="max-w-md"
    >
      <p className="text-pretty font-body text-sm leading-6 text-foreground-muted">
        {joining ? (
          <>
            RSVP-ing to <span className="font-medium text-foreground">{eventTitle}</span> also joins
            you to the event&apos;s group chat, where everybody going talks about it.
          </>
        ) : (
          <>
            You&apos;re going to{" "}
            <span className="font-medium text-foreground">{eventTitle}</span>. Taking that back is
            what takes you out of its group chat too — your RSVP is what put you in it.
          </>
        )}
      </p>

      <ul className="mt-5 flex flex-col gap-3">
        {joining ? (
          <>
            <Point icon={<UserCheck strokeWidth={2.5} size={13} />}>
              You count as going, and the host sees your RSVP.
            </Point>
            <Point icon={<MessageSquare strokeWidth={2.5} size={13} />}>
              You join the event&apos;s group chat and can post there straight away.
            </Point>
            <Point icon={<Pin strokeWidth={2.5} size={13} />}>
              It is pinned to the top of your sidebar until{" "}
              <span className="font-medium text-foreground">{date}</span>. Leave the RSVP and you
              leave the room.
            </Point>
          </>
        ) : (
          <>
            <Point icon={<UserX strokeWidth={2.5} size={13} />}>
              You stop counting as going, and the host sees that you are no longer coming.
            </Point>
            {isOwner ? (
              <Point icon={<MessageSquare strokeWidth={2.5} size={13} />}>
                You host this event, so the group chat stays yours — you keep it, and everybody
                going keeps talking in it.
              </Point>
            ) : (
              <Point icon={<LogOut strokeWidth={2.5} size={13} />}>
                You leave the event&apos;s group chat and stop getting its messages and previews.
              </Point>
            )}
            <Point icon={<PinOff strokeWidth={2.5} size={13} />}>
              {isOwner ? (
                <>
                  It stays pinned in your sidebar until{" "}
                  <span className="font-medium text-foreground">{date}</span>.
                </>
              ) : (
                <>
                  It drops out of your sidebar — the pin lasts only as long as the RSVP. You can
                  RSVP again any time before{" "}
                  <span className="font-medium text-foreground">{date}</span>.
                </>
              )}
            </Point>
          </>
        )}
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
          {joining ? "Cancel" : "No, keep going"}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="modal-btn modal-btn-primary"
        >
          {pending ? (
            <Spinner size={15} className="text-white" />
          ) : joining ? (
            <Check strokeWidth={2.5} size={15} />
          ) : (
            <UserX strokeWidth={2.5} size={15} />
          )}
          {pending ? (joining ? "Confirming…" : "Withdrawing…") : joining ? "Confirm RSVP" : "Yes, not going"}
        </button>
      </div>
    </Modal>
  );
}
