"use client";

/**
 * The in-app content report flow, opened from the "Report" item in a thread,
 * showcase, resource or event options menu.
 *
 * Step 1 picks a reason from the shared reason list (pill chips, like every
 * other filter row in the app); step 2 lets the reporter explain in their own
 * words — optional — and submits. On success the menu's Report item flips to
 * "Reported" via `onReported`; the report itself lands in the admin dashboard.
 */

import { useState } from "react";
import {
  ArrowLeft,
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
import { Spinner } from "@/components/ui/Spinner";
import { filterChip } from "./filter-chip";
import {
  REPORT_CONTENT_LABELS,
  REPORT_DETAILS_MAX_LENGTH,
  REPORT_REASONS,
  type ReportableContentType,
  type ReportReason,
} from "@/lib/communities/report-reasons";

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

type Step = "reason" | "details" | "done";

interface ReportModalProps {
  open: boolean;
  onClose: () => void;
  contentType: ReportableContentType;
  contentId: string;
  /** Fired once the report is accepted (or was already on file), so the
   *  caller's menu can show the acknowledged "Reported" state. */
  onReported?: () => void;
}

export function ReportModal({
  open,
  onClose,
  contentType,
  contentId,
  onReported,
}: ReportModalProps) {
  const [step, setStep] = useState<Step>("reason");
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Every close resets the wizard, so a previous reason/details pair never
  // leaks into the next post the user reports.
  function handleClose() {
    setStep("reason");
    setReason(null);
    setDetails("");
    setError(null);
    setSubmitting(false);
    onClose();
  }

  async function handleSubmit() {
    if (!reason || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/content-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_type: contentType,
          content_id: contentId,
          reason,
          details: details.trim(),
        }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        // 409 = a report from an earlier session is still open; treat it as
        // acknowledged so the menu stops inviting a duplicate.
        if (response.status === 409) onReported?.();
        setError(payload?.error ?? "Failed to submit your report. Please try again.");
        return;
      }

      onReported?.();
      setStep("done");
    } catch {
      setError("Failed to submit your report. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const label = REPORT_CONTENT_LABELS[contentType];
  const selected = REPORT_REASONS.find((item) => item.value === reason);

  return (
    <Modal open={open} onClose={handleClose} maxWidth="max-w-md">
      {step === "done" ? (
        <div className="px-1 py-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent">
            <Check strokeWidth={2.5} size={22} />
          </div>
          <h2 className="mt-4 font-display text-lg font-semibold text-foreground">
            Thanks for reporting
          </h2>
          <p className="mx-auto mt-1.5 max-w-xs font-body text-xs leading-5 text-foreground-muted">
            Our team will review this {label}. You&apos;ll get a notification once it&apos;s been
            looked at.
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
              {step === "reason" ? `Report this ${label}` : "Add any details"}
            </h2>
            <p className="mt-1 font-body text-xs leading-5 text-foreground-muted">
              {step === "reason"
                ? "Select your reporting reason — our team reviews every report."
                : "Optional — tell us what's wrong so we can review it faster."}
            </p>
          </div>

          {step === "reason" ? (
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
          ) : (
            <>
              {selected && (
                <span className={filterChip(true)} aria-label={`Reason: ${selected.label}`}>
                  <Check size={13} strokeWidth={2.5} aria-hidden="true" />
                  {selected.label}
                </span>
              )}

              <label htmlFor="report-details" className="sr-only">
                Report details
              </label>
              <textarea
                id="report-details"
                value={details}
                onChange={(event) => setDetails(event.target.value.slice(0, REPORT_DETAILS_MAX_LENGTH))}
                rows={4}
                placeholder="Optional details…"
                className="field mt-4 w-full resize-none leading-6"
              />
              <div className="mt-1 flex items-center justify-between gap-3">
                <span className="font-body text-[11px] text-foreground-subtle">
                  Your report is anonymous to the author.
                </span>
                <span className="shrink-0 font-mono text-[10px] text-foreground-subtle">
                  {details.length}/{REPORT_DETAILS_MAX_LENGTH}
                </span>
              </div>

              {error && (
                <p role="alert" className="mt-3 font-body text-xs text-red-400">
                  {error}
                </p>
              )}
            </>
          )}

          <div className="mt-6 flex items-center justify-between gap-2">
            {step === "reason" ? (
              <>
                <button type="button" onClick={handleClose} className="modal-btn modal-btn-secondary">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!reason}
                  onClick={() => setStep("details")}
                  className="modal-btn modal-btn-primary"
                >
                  Next
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setStep("reason");
                  }}
                  disabled={submitting}
                  className="modal-btn modal-btn-secondary"
                >
                  <ArrowLeft strokeWidth={2.5} size={14} />
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={submitting}
                  className="modal-btn modal-btn-primary"
                >
                  {submitting ? <Spinner size={14} /> : <Flag strokeWidth={2.5} size={14} />}
                  {submitting ? "Submitting…" : "Submit report"}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
