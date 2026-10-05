"use client";

// The report review queue. Every row is one member report on a thread,
// showcase post, resource or event; "Delete post" takes the content down
// through the same removal path the community delete routes use and notifies
// the author (with the reason) and every reporter (thank-you). "Dismiss"
// closes the report and leaves the post up.

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Flag, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/Spinner";
import {
  REPORT_CONTENT_LABELS,
  reportReasonLabel,
  type ReportableContentType,
} from "@/lib/communities/report-reasons";

type ReportStatus = "pending" | "removed" | "dismissed";
type StatusFilter = ReportStatus | "all";

interface ReportItem {
  id: string;
  content_type: ReportableContentType;
  content_id: string;
  content_title: string | null;
  reason: string;
  details: string | null;
  status: ReportStatus;
  created_at: string;
  resolved_at: string | null;
  reporter_name: string;
  author_name: string;
  community_name: string | null;
  content_exists: boolean;
  href: string | null;
}

const STATUS_TABS: Array<{ value: StatusFilter; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "removed", label: "Removed" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
];

const PAGE_SIZE = 25;

function StatusBadge({ status }: { status: ReportStatus }) {
  const styles: Record<ReportStatus, string> = {
    pending: "bg-amber-500/10 text-amber-400",
    removed: "bg-red-500/10 text-red-400",
    dismissed: "bg-surface-raised text-foreground-muted",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-[10px] font-medium capitalize ${styles[status]}`}
    >
      {status}
    </span>
  );
}

export default function AdminReportsPage() {
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [counts, setCounts] = useState<Record<StatusFilter, number>>({
    pending: 0,
    removed: 0,
    dismissed: 0,
    all: 0,
  });
  const [confirmTarget, setConfirmTarget] = useState<ReportItem | null>(null);
  const [busyReportId, setBusyReportId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchReports = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), status: statusFilter });
      const res = await fetch(`/api/admin/reports?${params}`);
      const data = await res.json();
      setReports(data.reports ?? []);
      setTotal(data.total ?? 0);
      const next = data.counts ?? { pending: 0, removed: 0, dismissed: 0 };
      setCounts({
        pending: next.pending ?? 0,
        removed: next.removed ?? 0,
        dismissed: next.dismissed ?? 0,
        all: (next.pending ?? 0) + (next.removed ?? 0) + (next.dismissed ?? 0),
      });
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  // Page/filter handlers flip the spinner on before the fetch; the fetch
  // itself only settles it, so the effect below never cascades a render.
  // The fetch starts in a timeout, like the notifications hook, so the
  // effect body itself stays free of synchronous state writes.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchReports();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchReports]);

  async function resolveReport(report: ReportItem, action: "remove" | "dismiss") {
    setBusyReportId(report.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/reports/${report.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setActionError(payload?.error ?? "Failed to resolve the report.");
        return;
      }
      await fetchReports();
    } catch {
      setActionError("Failed to resolve the report.");
    } finally {
      setBusyReportId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">Reports</h1>
          <p className="mt-0.5 font-body text-xs text-foreground-muted">
            {counts.pending} pending report{counts.pending === 1 ? "" : "s"} across all communities
          </p>
        </div>
        <span className="font-mono text-xs text-foreground-muted">{total} total</span>
      </div>

      {/* Status tabs */}
      <div className="mb-3 flex gap-0.5 border-b border-border">
        {STATUS_TABS.map(({ value, label }) => {
          const isActive = statusFilter === value;
          return (
            <button
              key={value}
              onClick={() => {
                setLoading(true);
                setStatusFilter(value);
                setPage(1);
              }}
              className={`-mb-px border-b-2 px-3.5 py-2 font-body text-xs font-medium transition-colors ${
                isActive
                  ? "border-accent text-accent"
                  : "border-transparent text-foreground-muted hover:text-foreground"
              }`}
            >
              {label}
              <span
                className={`ml-1.5 rounded-full px-1.5 py-0.5 font-mono text-[10px] ${
                  isActive ? "bg-accent/15 text-accent" : "bg-surface-raised text-foreground-muted"
                }`}
              >
                {counts[value]}
              </span>
            </button>
          );
        })}
      </div>

      {actionError && (
        <p role="alert" className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-body text-xs text-red-400">
          {actionError}
        </p>
      )}

      {/* Table */}
      <div className="mb-3 overflow-hidden rounded-xl border border-border bg-surface">
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-4 w-4" />
          </div>
        ) : reports.length === 0 ? (
          <div className="py-12 text-center">
            <Flag strokeWidth={2.5} size={20} className="mx-auto mb-2 text-foreground-muted opacity-50" />
            <p className="font-body text-xs text-foreground-muted">
              {statusFilter === "pending" ? "No pending reports." : "Nothing here."}
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {["Reported content", "Author", "Reported by", "Reason", "Received", "Status", ""].map((heading) => (
                  <th
                    key={heading}
                    className="px-4 py-2.5 text-left font-body text-[10px] font-medium uppercase tracking-wider text-foreground-muted"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reports.map((report, index) => {
                const isPending = report.status === "pending";
                const busy = busyReportId === report.id;
                return (
                  <tr
                    key={report.id}
                    className={`${index < reports.length - 1 ? "border-b border-border-subtle" : ""} align-top transition-colors hover:bg-surface-raised`}
                  >
                    <td className="max-w-[18rem] px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="rounded-full bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-foreground-muted">
                          {REPORT_CONTENT_LABELS[report.content_type] ?? report.content_type}
                        </span>
                        {!report.content_exists && (
                          <span className="font-mono text-[10px] text-foreground-subtle">deleted</span>
                        )}
                      </div>
                      <p className="mt-1.5 line-clamp-2 font-body text-xs font-medium text-foreground">
                        {report.content_title || "(no title)"}
                      </p>
                      {report.href && report.content_exists && (
                        <a
                          href={report.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 font-body text-[11px] text-accent hover:underline"
                        >
                          View post <ExternalLink size={10} strokeWidth={2.5} />
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-body text-xs text-foreground-muted">{report.author_name}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-body text-xs text-foreground-muted">{report.reporter_name}</p>
                      <p className="mt-0.5 font-body text-[10px] text-foreground-subtle">
                        {report.community_name ?? "Public feed"}
                      </p>
                    </td>
                    <td className="max-w-[16rem] px-4 py-3">
                      <p className="font-body text-xs text-foreground">{reportReasonLabel(report.reason)}</p>
                      {report.details && (
                        <p className="mt-1 line-clamp-3 font-body text-[11px] leading-5 text-foreground-subtle">
                          {report.details}
                        </p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <p className="font-mono text-[10px] text-foreground-muted">
                        {new Date(report.created_at).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={report.status} />
                    </td>
                    <td className="px-4 py-3">
                      {isPending ? (
                        <div className="flex flex-col items-end gap-1.5">
                          <button
                            onClick={() => setConfirmTarget(report)}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 px-2.5 py-1 font-body text-xs text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-40"
                          >
                            {busy ? <Spinner size={12} /> : <Trash2 strokeWidth={2.5} size={12} />}
                            Delete post
                          </button>
                          <button
                            onClick={() => void resolveReport(report, "dismiss")}
                            disabled={busy}
                            className="rounded-md border border-border px-2.5 py-1 font-body text-xs text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-40"
                          >
                            Dismiss
                          </button>
                        </div>
                      ) : (
                        <p className="text-right font-mono text-[10px] text-foreground-subtle">
                          {report.resolved_at
                            ? new Date(report.resolved_at).toLocaleDateString("en-GB", {
                                day: "numeric",
                                month: "short",
                              })
                            : ""}
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="font-body text-xs text-foreground-muted">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                setLoading(true);
                setPage((current) => Math.max(1, current - 1));
              }}
              disabled={page === 1}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-40"
            >
              <ChevronLeft strokeWidth={2.5} size={13} /> Prev
            </button>
            <button
              onClick={() => {
                setLoading(true);
                setPage((current) => Math.min(totalPages, current + 1));
              }}
              disabled={page === totalPages}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-40"
            >
              Next <ChevronRight strokeWidth={2.5} size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={confirmTarget !== null}
        title="Delete this post?"
        message={
          confirmTarget
            ? `This removes the ${REPORT_CONTENT_LABELS[confirmTarget.content_type]} (reported for "${reportReasonLabel(confirmTarget.reason)}") and notifies the author plus every reporter.`
            : ""
        }
        confirmLabel="Delete post"
        onClose={() => setConfirmTarget(null)}
        onConfirm={async () => {
          if (!confirmTarget) return;
          await resolveReport(confirmTarget, "remove");
          setConfirmTarget(null);
        }}
      />
    </div>
  );
}
