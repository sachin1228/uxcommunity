"use client";

/**
 * The DM report modal, opened from the chat header's ⋯ menu. One screen:
 * pick a reason, optionally say what happened, submit. The report lands in
 * the admin dashboard's DM Reports queue together with a snapshot of the
 * conversation's recent messages, so the reviewer sees what was reported
 * without entering the chat.
 */

import { useState } from "react";
import {
  Ban,
  Check,
  Copyright,
  EyeOff,
  Flag,
  Info,
  MessageSquareWarning,
  ShieldAlert,
  ThumbsDown,
  UserX,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ModalError } from "@/components/ui/ModalError";
import { PendingButton } from "@/components/ui/PendingButton";
import { filterChip } from "@/components/communities/filter-chip";
import {
  REPORT_DETAILS_MAX_LENGTH,
  REPORT_REASONS,
  type ReportReason,
} from "@/lib/communities/report-reasons";
import { dmUrls } from "@/lib/direct-messages/client";

const REASON_ICONS: Record<ReportReason, typeof Flag> = {
  spam: Ban,
  harassment: UserX,
  hate: ShieldAlert,
  misinformation: Info,
  inappropriate: EyeOff,
  intellectual_property: Copyright,
  off_topic: ThumbsDown,
  other: MessageSquareWarning,
};

export function DmReportModal({
  open,
  onClose,
  conversationId,
  peerName,
}: {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  /** The reported member's name — the title names who this is about. */
  peerName: string;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Every close resets the form, so a previous reason/details pair never
  // leaks into the next report.
  function handleClose() {
    setReason(null);
    setDetails("");
    setError(null);
    setSubmitting(false);
    setDone(false);
    onClose();
  }

  async function handleSubmit() {
    if (!reason || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(dmUrls.reports, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          reason,
          details: details.trim(),
        }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setError(payload?.error ?? "Failed to submit your report. Please try again.");
        return;
      }

      setDone(true);
    } catch {
      setError("Failed to submit your report. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} maxWidth="max-w-md">
      {done ? (
        <div className="px-1 py-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent">
            <Check strokeWidth={2.5} size={22} />
          </div>
          <h2 className="mt-4 font-display text-lg font-semibold text-foreground">
            Thanks for reporting
          </h2>
          <p className="mx-auto mt-1.5 max-w-xs font-body text-xs leading-5 text-foreground-muted">
            Our team will review this conversation. {peerName} won&apos;t see who reported them.
          </p>
          <button
            type="button"
            onClick={handleClose}
            className="modal-btn modal-btn-primary mt-6 w-full"
          >
            Done
          </button>
        </div>
      ) : (
        <>
          <div className="mb-5 pr-8">
            <h2 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
              Report {peerName}
            </h2>
            <p className="mt-1 font-body text-xs leading-5 text-foreground-muted">
              Select a reason — our team reviews every report.
            </p>
          </div>

          <div role="group" aria-label="Reporting reason" className="flex flex-wrap gap-2">
            {REPORT_REASONS.map((option) => {
              const Icon = REASON_ICONS[option.value];
              const active = reason === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setReason(option.value)}
                  className={filterChip(active)}
                >
                  <Icon size={13} strokeWidth={2.5} aria-hidden="true" />
                  {option.label}
                </button>
              );
            })}
          </div>

          <label htmlFor="dm-report-details" className="sr-only">
            Report details
          </label>
          <textarea
            id="dm-report-details"
            value={details}
            onChange={(event) => setDetails(event.target.value.slice(0, REPORT_DETAILS_MAX_LENGTH))}
            rows={4}
            placeholder="Tell us what happened… (optional)"
            className="field mt-4 w-full resize-none leading-6"
          />
          <div className="mt-1 flex items-center justify-between gap-3">
            <span className="font-body text-[11px] text-foreground-subtle">
              Your report is anonymous to {peerName}.
            </span>
            <span className="shrink-0 font-mono text-[10px] text-foreground-subtle">
              {details.length}/{REPORT_DETAILS_MAX_LENGTH}
            </span>
          </div>

          {error && <ModalError className="mt-3">{error}</ModalError>}

          <div className="mt-6 flex items-center justify-between gap-2">
            <button type="button" onClick={handleClose} className="modal-btn modal-btn-secondary">
              Cancel
            </button>
            <PendingButton
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!reason}
              pending={submitting}
              pendingLabel="Submitting…"
              spinnerSize={14}
              className="modal-btn modal-btn-primary"
            >
              <Flag strokeWidth={2.5} size={14} />
              Submit report
            </PendingButton>
          </div>
        </>
      )}
    </Modal>
  );
}
