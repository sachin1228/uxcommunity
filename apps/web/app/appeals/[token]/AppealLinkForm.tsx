"use client";

import { useState } from "react";
import { Check, Scale } from "lucide-react";
import { ModalError } from "@/components/ui/ModalError";
import { PendingButton } from "@/components/ui/PendingButton";
import {
  APPEAL_MESSAGE_MAX_LENGTH,
  APPEAL_MESSAGE_MIN_LENGTH,
} from "@/lib/moderation/appeals";

/**
 * The emailed appeal form. No session is needed: the signed token in the URL
 * is the proof, and the API re-checks it against the report's owner.
 */
export function AppealLinkForm({
  token,
  decision,
  alreadyAppealed,
}: {
  token: string;
  decision: string;
  alreadyAppealed: boolean;
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  if (alreadyAppealed || done) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Check size={22} strokeWidth={2.5} />
        </div>
        <h1 className="mt-4 font-display text-lg font-semibold text-foreground">
          {done ? "Appeal submitted" : "Appeal already on file"}
        </h1>
        <p className="mx-auto mt-2 max-w-sm font-body text-xs leading-5 text-foreground-muted">
          {done
            ? "A moderator will review your appeal. You will get an email when a decision is made."
            : "You have already appealed this decision. A moderator will review it and you will get an email when a decision is made."}
        </p>
      </div>
    );
  }

  async function submit() {
    if (submitting) return;
    if (message.trim().length < APPEAL_MESSAGE_MIN_LENGTH) {
      setError(`Add at least ${APPEAL_MESSAGE_MIN_LENGTH} characters.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/moderation/appeals/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, message }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(payload?.error ?? "Failed to submit your appeal.");
        return;
      }
      setDone(true);
    } catch {
      setError("Failed to submit your appeal.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-6">
      <div className="flex items-center gap-2">
        <Scale size={18} strokeWidth={2.5} className="text-accent" />
        <h1 className="font-display text-lg font-semibold text-foreground">
          Appeal this decision
        </h1>
      </div>

      <p className="mt-3 rounded-lg bg-surface-raised px-3 py-2 font-body text-xs leading-5 text-foreground-muted">
        {decision}
      </p>

      <label
        htmlFor="appeal-message"
        className="mt-4 block font-body text-[11px] font-medium text-foreground"
      >
        Why should this be reviewed?
      </label>
      <textarea
        id="appeal-message"
        value={message}
        onChange={(event) => setMessage(event.target.value.slice(0, APPEAL_MESSAGE_MAX_LENGTH))}
        rows={6}
        maxLength={APPEAL_MESSAGE_MAX_LENGTH}
        className="field mt-1.5 w-full resize-none leading-6"
        placeholder="Explain what happened, with any context a moderator should know."
      />
      <div className="mt-1 flex items-center justify-between font-body text-[10px] text-foreground-subtle">
        <span>
          One appeal per decision · {APPEAL_MESSAGE_MIN_LENGTH}–{APPEAL_MESSAGE_MAX_LENGTH}{" "}
          characters
        </span>
        <span className="font-mono">
          {message.length}/{APPEAL_MESSAGE_MAX_LENGTH}
        </span>
      </div>

      {error && <ModalError className="mt-3">{error}</ModalError>}

      <div className="mt-4 flex justify-end">
        <PendingButton
          type="button"
          pending={submitting}
          pendingLabel="Submitting…"
          spinnerSize={13}
          onClick={() => void submit()}
          className="modal-btn modal-btn-primary"
        >
          Submit appeal
        </PendingButton>
      </div>
    </div>
  );
}
