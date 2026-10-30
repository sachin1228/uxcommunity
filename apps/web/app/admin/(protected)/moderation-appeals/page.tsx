"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Scale, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ModalError } from "@/components/ui/ModalError";
import { PendingButton } from "@/components/ui/PendingButton";
import { reportReasonLabel } from "@/lib/communities/report-reasons";

interface AppealReport {
  id: string;
  target_type: string;
  target_id: string;
  context_id: string | null;
  community_id: string | null;
  target_excerpt: string | null;
  context_title: string | null;
  reason: string;
  details: string | null;
  status: string;
  resolution_note: string | null;
  target_snapshot: Record<string, unknown> | null;
}

interface Appeal {
  id: string;
  report_id: string;
  user_id: string;
  target_type: string;
  target_id: string;
  user_name: string;
  is_blocked: boolean;
  suspended_until: string | null;
  message: string;
  status: "pending" | "granted" | "denied";
  resolution_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  report: AppealReport | null;
}

const STATUS_TABS = [
  { value: "pending", label: "Pending" },
  { value: "granted", label: "Granted" },
  { value: "denied", label: "Denied" },
  { value: "all", label: "All" },
] as const;

const TARGET_LABELS: Record<string, string> = {
  thread_comment: "Comment",
  showcase_comment: "Comment",
  resource_comment: "Comment",
  event_comment: "Comment",
  community_message: "Chat message",
  profile: "Profile",
  community: "Community",
  job: "Job listing",
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ModerationAppealsPage() {
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [status, setStatus] = useState<(typeof STATUS_TABS)[number]["value"]>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{ appeal: Appeal; action: "grant" | "deny" } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/moderation-appeals?status=${status}`);
      const data = (await res.json().catch(() => null)) as
        | { appeals?: Appeal[]; error?: string }
        | null;
      if (!res.ok) {
        setError(data?.error ?? "Failed to load appeals.");
        return;
      }
      setAppeals(data?.appeals ?? []);
    } catch {
      setError("Failed to load appeals.");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function submitReview() {
    if (!review || busy) return;
    setBusy(true);
    setReviewError(null);
    try {
      const res = await fetch(`/api/admin/moderation-appeals/${review.appeal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: review.action, note: note.trim() || undefined }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setReviewError(data?.error ?? "Failed to review the appeal.");
        return;
      }
      setReview(null);
      setNote("");
      await load();
    } catch {
      setReviewError("Failed to review the appeal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
          <Scale size={18} strokeWidth={2.5} />
          Moderation appeals
        </h1>
        <p className="mt-1 font-body text-xs text-foreground-muted">
          Members can appeal a removal, warning, suspension or ban once. Granting
          lifts account restrictions and restores hidden communities or deactivated
          listings where possible; deleted comments and messages cannot be
          restored.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setStatus(tab.value)}
            className={`rounded-full px-3 py-1.5 font-body text-xs transition-colors ${
              status === tab.value
                ? "bg-foreground text-background"
                : "border border-border text-foreground-muted hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-body text-xs text-red-400">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center rounded-xl border border-border bg-surface py-16">
          <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
        </div>
      ) : appeals.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface py-16 text-center font-body text-xs text-foreground-muted">
          {status === "pending" ? "No pending appeals." : "Nothing here."}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {appeals.map((appeal) => (
            <article
              key={appeal.id}
              className="rounded-xl border border-border bg-surface p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-body text-sm font-medium text-foreground">
                    {appeal.user_name}
                    {appeal.is_blocked && (
                      <span className="ml-2 rounded-full border border-red-500/30 px-2 py-0.5 text-[10px] text-red-400">
                        Banned
                      </span>
                    )}
                    {!appeal.is_blocked && appeal.suspended_until && (
                      <span className="ml-2 rounded-full border border-amber-500/30 px-2 py-0.5 text-[10px] text-amber-500">
                        Suspended until {formatDate(appeal.suspended_until)}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 font-body text-xs text-foreground-muted">
                    {TARGET_LABELS[appeal.report?.target_type ?? appeal.target_type] ??
                      appeal.target_type}
                    {" · "}
                    {appeal.report?.context_title ||
                      (appeal.report?.target_snapshot?.name as string | undefined) ||
                      (appeal.report?.target_snapshot?.title as string | undefined) ||
                      appeal.report_id.slice(0, 8)}
                    {" · "}
                    {appeal.report ? reportReasonLabel(appeal.report.reason) : "Unknown reason"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-body text-[11px] text-foreground-subtle">
                    Filed {formatDate(appeal.created_at)}
                  </p>
                  {appeal.status !== "pending" && (
                    <p className="mt-1 font-body text-[11px] text-foreground-muted">
                      {appeal.status === "granted" ? "Granted" : "Denied"}
                      {appeal.reviewed_at ? ` · ${formatDate(appeal.reviewed_at)}` : ""}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-3 rounded-lg bg-surface-raised px-3 py-2">
                <p className="font-body text-[10px] uppercase tracking-wide text-foreground-subtle">
                  Appeal
                </p>
                <p className="mt-1 whitespace-pre-wrap font-body text-xs leading-5 text-foreground-muted">
                  {appeal.message}
                </p>
              </div>

              {appeal.report?.target_excerpt && (
                <p className="mt-2 line-clamp-2 font-body text-[11px] text-foreground-subtle">
                  Reported content: {appeal.report.target_excerpt}
                </p>
              )}

              {appeal.resolution_note && (
                <p className="mt-2 font-body text-[11px] text-foreground-muted">
                  Decision note: {appeal.resolution_note}
                </p>
              )}

              {appeal.status === "pending" && (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setNote("");
                      setReviewError(null);
                      setReview({ appeal, action: "grant" });
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 px-2.5 py-1.5 font-body text-[11px] text-emerald-500 transition-colors hover:bg-emerald-500/10"
                  >
                    <Check size={11} strokeWidth={2.5} />
                    Grant appeal
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNote("");
                      setReviewError(null);
                      setReview({ appeal, action: "deny" });
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-body text-[11px] text-foreground-muted transition-colors hover:bg-surface-raised"
                  >
                    <X size={11} strokeWidth={2.5} />
                    Deny appeal
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(review)}
        onClose={() => {
          if (!busy) {
            setReview(null);
            setNote("");
          }
        }}
        maxWidth="max-w-md"
      >
        {review && (
          <>
            <h2 className="font-display text-lg font-semibold text-foreground">
              {review.action === "grant" ? "Grant this appeal?" : "Deny this appeal?"}
            </h2>
            <p className="mt-1 font-body text-xs leading-5 text-foreground-muted">
              {review.action === "grant"
                ? "Account restrictions are lifted, a hidden community is restored and a deactivated listing is reopened. A deleted comment or message cannot be restored."
                : "The original moderation decision stands. The member is told the outcome."}
            </p>
            <label
              htmlFor="appeal-note"
              className="mt-4 block font-body text-[11px] font-medium text-foreground"
            >
              Decision note (optional)
            </label>
            <textarea
              id="appeal-note"
              value={note}
              onChange={(event) => setNote(event.target.value.slice(0, 500))}
              rows={3}
              maxLength={500}
              className="field mt-1.5 w-full resize-none leading-5"
              placeholder="Quoted to the member and stored in the audit log."
            />
            {reviewError && <ModalError className="mt-3">{reviewError}</ModalError>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setReview(null)}
                className="modal-btn modal-btn-secondary"
              >
                Cancel
              </button>
              <PendingButton
                type="button"
                pending={busy}
                pendingLabel="Saving…"
                spinnerSize={13}
                onClick={() => void submitReview()}
                className={
                  review.action === "grant"
                    ? "modal-btn modal-btn-primary"
                    : "modal-btn modal-btn-danger"
                }
              >
                {review.action === "grant" ? "Grant appeal" : "Deny appeal"}
              </PendingButton>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
