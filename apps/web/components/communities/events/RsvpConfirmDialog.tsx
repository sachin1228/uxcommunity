"use client";

import { Check, UserX } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { EventChatPreviewRow } from "./EventChatPreviewRow";

/**
 * The confirmation in front of both halves of an RSVP.
 *
 * RSVP-ing is not only a number: it is how somebody enters the event's group
 * chat, so the dialog's whole point is the room it shows — drawn exactly as the
 * sidebar will draw it (name, pin, member count). One short line says what the
 * button does to the RSVP; the row shows what it does to the room. Neither
 * direction should happen under a stray tap, so the request is sent only from
 * the confirm button — one tap is the whole decision, the member just gets to
 * see what it means first.
 */
export type RsvpConfirmMode = "join" | "leave";

export function RsvpConfirmDialog({
  mode,
  open,
  onClose,
  onConfirm,
  eventTitle,
  eventDate,
  eventEnd,
  coverImageUrl,
  chatMemberCount = null,
  isOwner = false,
  pending,
  error,
}: {
  mode: RsvpConfirmMode;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  eventTitle: string;
  /** The event's start — the room DP's date badge. */
  eventDate: string;
  /** The event's end (or its start when it has none) — the badge's LIVE window. */
  eventEnd: string | null;
  /** The event's cover, which the room wears as its own DP. */
  coverImageUrl: string | null;
  /** Members in the room; null hides the line (e.g. no room yet). */
  chatMemberCount?: number | null;
  /** The host keeps their own group chat, so backing out costs them less. */
  isOwner?: boolean;
  pending: boolean;
  error?: string | null;
}) {
  const joining = mode === "join";

  return (
    <Modal
      open={open}
      onClose={pending ? () => undefined : onClose}
      title={joining ? "Confirm your RSVP" : "Withdraw your RSVP?"}
      maxWidth="max-w-md"
    >
      <p className="text-pretty font-body text-sm leading-6 text-foreground-muted">
        {joining
          ? "Your RSVP joins you to this chat — everyone going talks in one place."
          : isOwner
            ? "You host this event, so the chat stays yours — everyone going keeps talking in it."
            : "Withdrawing takes you out of this chat — your RSVP is what put you in it."}
      </p>

      <EventChatPreviewRow
        className="mt-5"
        eventTitle={eventTitle}
        eventDate={eventDate}
        eventEnd={eventEnd}
        coverImageUrl={coverImageUrl}
        memberCount={chatMemberCount}
      />

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
