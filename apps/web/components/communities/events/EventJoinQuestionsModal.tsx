"use client";

import { useMemo, useState } from "react";
import { Check, ClipboardList } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import {
  EVENT_JOIN_QUESTIONS,
  joinAnswersPayload,
  type EventJoinAnswers,
  type EventJoinQuestionKey,
} from "@/lib/communities/event-join-questions";

/**
 * The host's compulsory questions, asked before either door into an event's
 * group chat opens — the RSVP's "I'm Going" and the room's own "Join event
 * chat" confirmation. Nothing is sent until all four are answered; the confirm
 * button stays off until then, and says how many are still open.
 */

type Draft = Partial<Record<EventJoinQuestionKey, string>>;

const EMPTY_DRAFT: Draft = {};

export function EventJoinQuestionsModal({
  open,
  onClose,
  onSubmit,
  eventTitle,
  communityName,
  pending = false,
  error,
  confirmLabel = "Confirm",
}: {
  open: boolean;
  onClose: () => void;
  /** Fired only from the confirm button, and only with a complete answer set. */
  onSubmit: (answers: EventJoinAnswers) => void;
  eventTitle: string;
  communityName?: string | null;
  pending?: boolean;
  error?: string | null;
  confirmLabel?: string;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  // Every open is a fresh form: answers from a dismissed attempt must not
  // linger, and a completed join must not leave them behind for the next one.
  // Reset during render (React's state-adjustment pattern) — an effect here
  // would paint one frame of the stale form first.
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setDraft(EMPTY_DRAFT);
    setWasOpen(true);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  const missing = useMemo(
    () =>
      EVENT_JOIN_QUESTIONS.filter(({ key }) => {
        const value = (draft[key] ?? "").trim();
        return value.length === 0;
      }).length,
    [draft],
  );
  const ready = joinAnswersPayload(draft) !== null;

  return (
    <Modal
      open={open}
      onClose={pending ? () => undefined : onClose}
      title="A few questions before you join"
      maxWidth="max-w-lg"
    >
      <p className="text-pretty font-body text-sm leading-6 text-foreground-muted">
        Before you join{" "}
        <span className="font-medium text-foreground">{eventTitle}</span>
        {communityName ? (
          <>
            {" "}hosted by{" "}
            <span className="font-medium text-foreground">{communityName}</span>
          </>
        ) : null}
        , the host asks everyone these — your answers are shared with them.
      </p>

      <form
        className="mt-5 flex flex-col gap-4"
        onSubmit={(formEvent) => {
          formEvent.preventDefault();
          const answers = joinAnswersPayload(draft);
          if (answers && !pending) onSubmit(answers);
        }}
      >
        {EVENT_JOIN_QUESTIONS.map(({ key, label, placeholder, multiline }) => (
          <label key={key} className="flex flex-col gap-1.5">
            <span className="font-body text-xs font-medium text-foreground">
              {label}
              <span className="ml-1 text-red-400" aria-hidden="true">
                *
              </span>
              <span className="sr-only">(required)</span>
            </span>
            {multiline ? (
              <textarea
                value={draft[key] ?? ""}
                onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                placeholder={placeholder}
                rows={3}
                required
                maxLength={2000}
                disabled={pending}
                className="field resize-none"
              />
            ) : (
              <input
                type="text"
                value={draft[key] ?? ""}
                onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                placeholder={placeholder}
                required
                maxLength={key === "work_experience" ? 100 : 200}
                disabled={pending}
                className="field"
              />
            )}
          </label>
        ))}

        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-body text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="mt-2 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="modal-btn modal-btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!ready || pending}
            className="modal-btn modal-btn-primary"
          >
            {pending ? (
              <Spinner size={15} className="text-white" />
            ) : ready ? (
              <Check strokeWidth={2.5} size={15} />
            ) : (
              <ClipboardList strokeWidth={2.5} size={15} />
            )}
            {pending
              ? "Submitting…"
              : ready
                ? confirmLabel
                : missing === EVENT_JOIN_QUESTIONS.length
                  ? "Answer all questions"
                  : `${missing} question${missing === 1 ? "" : "s"} left`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
