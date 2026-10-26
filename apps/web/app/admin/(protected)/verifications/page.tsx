"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

type Status = "pending" | "approved" | "rejected";

interface VerificationRequest {
  id: string;
  user_id: string;
  linkedin_url: string;
  portfolio_links: string[] | null;
  work_sample_urls: string[] | null;
  email_verified_at: string;
  status: Status;
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  users:
    | { name: string | null; email: string }
    | Array<{ name: string | null; email: string }>
    | null;
}

const TABS: Array<{ value: Status | "all"; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

function userOf(request: VerificationRequest) {
  const value = request.users;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function dateLabel(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function StatusBadge({ status }: { status: Status }) {
  const styles = {
    pending: "bg-amber-500/10 text-amber-500",
    approved: "bg-green-500/10 text-green-500",
    rejected: "bg-red-500/10 text-red-500",
  } as const;
  return (
    <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${styles[status]}`}>
      {status}
    </span>
  );
}

export default function AdminVerificationsPage() {
  const [status, setStatus] = useState<Status | "all">("pending");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [requests, setRequests] = useState<VerificationRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [graceDays, setGraceDays] = useState(0);
  const [graceSaving, setGraceSaving] = useState(false);
  const [graceSaved, setGraceSaved] = useState(false);
  const [graceError, setGraceError] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/verifications?status=${status}&page=${page}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load requests.");
      setRequests(body.requests ?? []);
      setTotal(body.total ?? 0);
      setPageSize(body.pageSize ?? 25);
      setSelectedId(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load requests.");
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    // The loader owns its own pending/error state; it runs once per filter.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchRequests();
  }, [fetchRequests]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/verification-settings");
        const body = await res.json();
        if (active && res.ok) setGraceDays(body.graceDays ?? 0);
      } catch {
        // A failed read leaves the current default; saving still works.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function updateGrace(days: number) {
    setGraceSaving(true);
    setGraceSaved(false);
    setGraceError(null);
    try {
      const res = await fetch("/api/admin/verification-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to save the setting.");
      setGraceDays(days);
      setGraceSaved(true);
    } catch (saveError) {
      setGraceError(saveError instanceof Error ? saveError.message : "Failed to save the setting.");
    } finally {
      setGraceSaving(false);
    }
  }

  async function review(id: string, action: "approve" | "reject") {
    setActionLoading(`${id}:${action}`);
    setError(null);
    try {
      const res = await fetch(`/api/admin/verifications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: action === "reject" ? reason : undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to review this request.");
      setReason("");
      await fetchRequests();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Failed to review this request.");
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">Verifications</h1>
          <p className="mt-0.5 font-body text-xs text-foreground-muted">
            {total} {total === 1 ? "request" : "requests"} in this view
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="grace-days" className="font-body text-xs text-foreground-muted">
            Banner after
          </label>
          <select
            id="grace-days"
            value={graceDays}
            onChange={(event) => void updateGrace(Number(event.target.value))}
            disabled={graceSaving}
            className="field h-8 w-32 px-2 font-body text-xs text-foreground disabled:opacity-60"
          >
            <option value={0}>Immediately</option>
            {Array.from({ length: 30 }, (_, index) => index + 1).map((days) => (
              <option key={days} value={days}>
                {days} {days === 1 ? "day" : "days"}
              </option>
            ))}
          </select>
          <span className="w-12 font-body text-[11px] text-foreground-subtle">
            {graceSaving ? "Saving…" : graceSaved ? "Saved" : ""}
          </span>
        </div>
      </div>

      {graceError ? (
        <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2">
          <p className="font-body text-xs text-red-500">{graceError}</p>
        </div>
      ) : null}

      <div className="mb-3 flex gap-1">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => {
              setStatus(tab.value);
              setPage(1);
            }}
            className={`rounded-md px-3 py-1.5 font-body text-xs transition-colors ${
              status === tab.value
                ? "bg-surface-raised text-foreground"
                : "text-foreground-muted hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2">
          <p className="font-body text-xs text-red-500">{error}</p>
        </div>
      ) : null}

      <div className="rounded-xl border border-border bg-surface">
        {loading ? (
          <div className="flex justify-center py-14">
            <Spinner className="h-4 w-4" />
          </div>
        ) : requests.length === 0 ? (
          <div className="py-14 text-center">
            <p className="font-body text-sm text-foreground-muted">No verification requests here.</p>
          </div>
        ) : (
          <div>
            {requests.map((request, index) => {
              const user = userOf(request);
              const expanded = selectedId === request.id;
              const busy = actionLoading?.startsWith(`${request.id}:`);
              return (
                <div
                  key={request.id}
                  className={index < requests.length - 1 ? "border-b border-border-subtle" : ""}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(expanded ? null : request.id);
                      setReason("");
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-raised"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-raised">
                      <BadgeCheck strokeWidth={2.5} size={15} className="text-foreground-muted" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-body text-xs font-medium text-foreground">
                        {user?.name?.trim() || "Unnamed member"}
                      </p>
                      <p className="truncate font-body text-[11px] text-foreground-muted">
                        {user?.email ?? "—"}
                      </p>
                    </div>
                    <div className="hidden font-mono text-[10px] text-foreground-subtle sm:block">
                      {dateLabel(request.created_at)}
                    </div>
                    <StatusBadge status={request.status} />
                  </button>

                  {expanded ? (
                    <div className="border-t border-border-subtle bg-background/40 px-4 py-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="flex flex-col gap-3">
                          <div>
                            <p className="font-mono text-[10px] uppercase tracking-wider text-foreground-subtle">
                              LinkedIn
                            </p>
                            <a
                              href={request.linkedin_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 inline-flex items-center gap-1 break-all font-body text-xs text-accent hover:underline"
                            >
                              {request.linkedin_url}
                              <ExternalLink strokeWidth={2.5} size={11} className="shrink-0" />
                            </a>
                          </div>

                          <div>
                            <p className="font-mono text-[10px] uppercase tracking-wider text-foreground-subtle">
                              Portfolio
                            </p>
                            <div className="mt-1 flex flex-col gap-1">
                              {(request.portfolio_links ?? []).map((link) => (
                                <a
                                  key={link}
                                  href={link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 break-all font-body text-xs text-accent hover:underline"
                                >
                                  {link}
                                  <ExternalLink strokeWidth={2.5} size={11} className="shrink-0" />
                                </a>
                              ))}
                            </div>
                          </div>

                          <div>
                            <p className="font-mono text-[10px] uppercase tracking-wider text-foreground-subtle">
                              Email
                            </p>
                            <p className="mt-1 flex items-center gap-1 font-body text-xs text-green-500">
                              <CheckCircle2 strokeWidth={2.5} size={12} />
                              Verified {dateLabel(request.email_verified_at)}
                            </p>
                          </div>

                          {request.status === "rejected" && request.rejection_reason ? (
                            <div>
                              <p className="font-mono text-[10px] uppercase tracking-wider text-foreground-subtle">
                                Rejection reason
                              </p>
                              <p className="mt-1 font-body text-xs text-foreground-muted">
                                {request.rejection_reason}
                              </p>
                            </div>
                          ) : null}
                        </div>

                        <div>
                          <p className="font-mono text-[10px] uppercase tracking-wider text-foreground-subtle">
                            Work samples
                          </p>
                          {(request.work_sample_urls ?? []).length === 0 ? (
                            <p className="mt-1 font-body text-xs text-foreground-subtle">
                              None uploaded.
                            </p>
                          ) : (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {(request.work_sample_urls ?? []).map((url) => (
                                <a
                                  key={url}
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="h-20 w-28 overflow-hidden rounded-lg border border-border"
                                >
                                  <img
                                    src={url}
                                    alt="Work sample"
                                    className="h-full w-full object-cover"
                                  />
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {request.status === "pending" ? (
                        <div className="mt-4 flex flex-col gap-3 border-t border-border-subtle pt-4">
                          <textarea
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                            placeholder="Rejection reason (required to reject)"
                            rows={3}
                            className="field w-full resize-none"
                          />
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void review(request.id, "approve")}
                              disabled={busy}
                              className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 font-body text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                            >
                              <CheckCircle2 strokeWidth={2.5} size={13} />
                              {actionLoading === `${request.id}:approve` ? "Approving…" : "Approve"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void review(request.id, "reject")}
                              disabled={busy || reason.trim().length < 5}
                              className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 px-3 py-1.5 font-body text-xs font-medium text-red-500 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <XCircle strokeWidth={2.5} size={13} />
                              {actionLoading === `${request.id}:reject` ? "Rejecting…" : "Reject"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-4 border-t border-border-subtle pt-3 font-body text-[11px] text-foreground-subtle">
                          Reviewed by {request.reviewed_by ?? "an admin"} on{" "}
                          {dateLabel(request.reviewed_at)}.
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {total > pageSize ? (
        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1 || loading}
            className="rounded-md border border-border px-3 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:text-foreground disabled:opacity-50"
          >
            Previous
          </button>
          <span className="font-mono text-[10px] text-foreground-subtle">
            Page {page} of {Math.max(1, Math.ceil(total / pageSize))}
          </span>
          <button
            type="button"
            onClick={() => setPage((value) => value + 1)}
            disabled={page >= Math.ceil(total / pageSize) || loading}
            className="rounded-md border border-border px-3 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:text-foreground disabled:opacity-50"
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
