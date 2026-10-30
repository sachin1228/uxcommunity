"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Loader2, Scale } from "lucide-react";
import { ModalError } from "@/components/ui/ModalError";
import { PendingButton } from "@/components/ui/PendingButton";
import { reportReasonLabel } from "@/lib/communities/report-reasons";
import {
  APPEAL_MESSAGE_MAX_LENGTH,
  APPEAL_MESSAGE_MIN_LENGTH,
  APPEAL_STATUS_LABELS,
  type AppealStatus,
} from "@/lib/moderation/appeals";

interface Appeal {
  id: string;
  message: string;
  status: AppealStatus;
  resolution_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

interface ModeratedItem {
  id: string;
  target_type: string;
  target_id: string;
  community_id: string | null;
  context_title: string | null;
  target_excerpt: string | null;
  reason: string;
  status: string;
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
  appeal: Appeal | null;
}

const TARGET_LABELS: Record<string, string> = {
  thread_comment: "Comment",
  showcase_comment: "Showcase comment",
  resource_comment: "Resource comment",
  event_comment: "Event comment",
  community_message: "Chat message",
  profile: "Profile",
  community: "Community",
  job: "Job listing",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function targetHref(item: ModeratedItem): string | null {
  switch (item.target_type) {
    case "community":
      return `/dashboard/communities/${item.target_id}`;
    case "job":
      return `/dashboard/jobs/${item.target_id}`;
    default:
      return item.community_id ? `/dashboard/communities/${item.community_id}` : null;
  }
}

/**
 * Moderation appeals for the signed-in member.
 *
 * The list is every resolved moderation action against this account. Each one
 * can be appealed once; the form disappears after submission (or if an appeal
 * already exists), so the member cannot spam the queue from this screen.
 */
export function AppealsView() {
  const [items, setItems] = useState<ModeratedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/moderation/appeals");
      const data = (await res.json().catch(() => null)) as
        | { items?: ModeratedItem[]; error?: string }
        | null;
      if (!res.ok) {
        setError(data?.error ?? "Failed to load your moderation history.");
        return;
      }
      setItems(data?.items ?? []);
    } catch {
      setError("Failed to load your moderation history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function submit(item: ModeratedItem) {
    if (submitting) return;
    const message = (messages[item.id] ?? "").trim();
    if (message.length < APPEAL_MESSAGE_MIN_LENGTH) {
      setFormError((current) => ({
        ...current,
        [item.id]: `Add at least ${APPEAL_MESSAGE_MIN_LENGTH} characters.`,
      }));
      return;
    }

    setSubmitting(item.id);
    setFormError((current) => ({ ...current, [item.id]: "" }));
    try {
      const res = await fetch("/api/moderation/appeals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_id: item.id, message }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setFormError((current) => ({
          ...current,
          [item.id]: data?.error ?? "Failed to submit your appeal.",
        }));
        return;
      }
      setOpenForm(null);
      await load();
    } catch {
      setFormError((current) => ({
        ...current,
        [item.id]: "Failed to submit your appeal.",
      }));
    } finally {
      setSubmitting(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div>
        <h1 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
          <Scale size={18} strokeWidth={2.5} />
          Moderation appeals
        </h1>
        <p className="mt-1 font-body text-xs leading-5 text-foreground-muted">
          If you believe a moderation decision was wrong, you can appeal it once.
          Explain what happened and why the decision should be reviewed — a
          moderator will read it.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-body text-xs text-red-400">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-5 py-12 text-center">
          <Check className="mx-auto h-6 w-6 text-emerald-500" strokeWidth={2.5} />
          <p className="mt-3 font-body text-sm text-foreground">
            No moderation actions against your account
          </p>
          <p className="mt-1 font-body text-xs text-foreground-muted">
            If content is removed or your account is restricted, it will appear here.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => {
            const href = targetHref(item);
            const isOpen = openForm === item.id;
            const canAppeal = !item.appeal;
            return (
              <article
                key={item.id}
                className="rounded-xl border border-border bg-surface p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-body text-sm font-medium text-foreground">
                      {TARGET_LABELS[item.target_type] ?? item.target_type}
                      {item.context_title ? ` · ${item.context_title}` : ""}
                    </p>
                    <p className="mt-0.5 font-body text-xs text-foreground-muted">
                      {item.status === "removed"
                        ? "Removed"
                        : item.status === "actioned"
                          ? "Account action"
                          : "Reviewed"}{" "}
                      · {reportReasonLabel(item.reason)} · {formatDate(item.resolved_at)}
                    </p>
                  </div>
                  {href && item.target_type !== "job" && (
                    <Link
                      href={href}
                      className="font-body text-[11px] text-accent hover:underline"
                    >
                      View community
                    </Link>
                  )}
                </div>

                {item.target_excerpt && (
                  <p className="mt-2 line-clamp-2 rounded-lg bg-surface-raised px-3 py-2 font-body text-[11px] text-foreground-muted">
                    {item.target_excerpt}
                  </p>
                )}

                {item.resolution_note && (
                  <p className="mt-2 font-body text-[11px] text-foreground-muted">
                    Moderator note: {item.resolution_note}
                  </p>
                )}

                {item.appeal ? (
                  <div className="mt-3 rounded-lg border border-border px-3 py-2">
                    <p className="font-body text-[11px] font-medium text-foreground">
                      {APPEAL_STATUS_LABELS[item.appeal.status]}
                      {item.appeal.reviewed_at
                        ? ` · ${formatDate(item.appeal.reviewed_at)}`
                        : ""}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap font-body text-[11px] text-foreground-muted">
                      {item.appeal.message}
                    </p>
                    {item.appeal.resolution_note && (
                      <p className="mt-1.5 font-body text-[11px] text-foreground-muted">
                        Decision: {item.appeal.resolution_note}
                      </p>
                    )}
                  </div>
                ) : canAppeal && isOpen ? (
                  <div className="mt-3">
                    <label
                      htmlFor={`appeal-${item.id}`}
                      className="font-body text-[11px] font-medium text-foreground"
                    >
                      Why should this be reviewed?
                    </label>
                    <textarea
                      id={`appeal-${item.id}`}
                      value={messages[item.id] ?? ""}
                      onChange={(event) =>
                        setMessages((current) => ({
                          ...current,
                          [item.id]: event.target.value.slice(0, APPEAL_MESSAGE_MAX_LENGTH),
                        }))
                      }
                      rows={4}
                      maxLength={APPEAL_MESSAGE_MAX_LENGTH}
                      className="field mt-1.5 w-full resize-none leading-5"
                      placeholder="Explain what happened, with any context a moderator should know."
                    />
                    <div className="mt-1 flex items-center justify-between">
                      <span className="font-body text-[10px] text-foreground-subtle">
                        One appeal per decision · {APPEAL_MESSAGE_MIN_LENGTH}–{APPEAL_MESSAGE_MAX_LENGTH} characters
                      </span>
                      <span className="font-mono text-[10px] text-foreground-subtle">
                        {(messages[item.id] ?? "").length}/{APPEAL_MESSAGE_MAX_LENGTH}
                      </span>
                    </div>
                    {formError[item.id] && (
                      <ModalError className="mt-2">{formError[item.id]}</ModalError>
                    )}
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setOpenForm(null)}
                        disabled={submitting === item.id}
                        className="modal-btn modal-btn-secondary"
                      >
                        Cancel
                      </button>
                      <PendingButton
                        type="button"
                        pending={submitting === item.id}
                        pendingLabel="Submitting…"
                        spinnerSize={13}
                        onClick={() => void submit(item)}
                        className="modal-btn modal-btn-primary"
                      >
                        Submit appeal
                      </PendingButton>
                    </div>
                  </div>
                ) : canAppeal ? (
                  <button
                    type="button"
                    onClick={() => {
                      setOpenForm(item.id);
                      setFormError((current) => ({ ...current, [item.id]: "" }));
                    }}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-body text-xs text-foreground transition-colors hover:bg-surface-raised"
                  >
                    <Scale size={12} strokeWidth={2.5} />
                    Appeal this decision
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
