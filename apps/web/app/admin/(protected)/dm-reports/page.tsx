"use client";

// The DM report queue: one row per report a member filed from a direct
// conversation, with the reported member, the reporter, the stored message
// snapshot and the review state. Rows expand in place to show the full
// details plus the snapshot — the reviewer sees what was reported without
// entering the chat. Filters (status, reason, search) ride the query string
// to /api/admin/dm-reports, which reads the dm_report_queue view.
//
// Actions: Mark reviewed / Dismiss close a report (distinct states keep "we
// acted on this" apart from "nothing to do"); Reopen is the way back.

import { Fragment, useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Check,
  EyeOff,
  Flag,
  RotateCcw,
  Search,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { REPORT_REASONS, reportReasonLabel } from "@/lib/communities/report-reasons";

type ReportStatus = "pending" | "reviewed" | "dismissed";
type StatusFilter = ReportStatus | "all";

interface SnapshotMessage {
  id: string;
  user_id: string;
  author_name: string;
  content: string | null;
  image_url: string | null;
  deleted_at: string | null;
  created_at: string;
}

interface DmReportRow {
  id: string;
  /** Null after the reporter's account was deleted; the report is retained. */
  reporter_id: string | null;
  reporter_name: string | null;
  reporter_deleted_at: string | null;
  reported_user_id: string | null;
  reported_user_name: string | null;
  conversation_id: string | null;
  reason: string;
  details: string | null;
  message_snapshot: SnapshotMessage[] | null;
  status: ReportStatus;
  resolved_at: string | null;
  created_at: string;
}

const STATUS_TABS: Array<{ value: StatusFilter; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "reviewed", label: "Reviewed" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
];

const PAGE_SIZE = 25;

function StatusBadge({ status }: { status: ReportStatus }) {
  const styles: Record<ReportStatus, string> = {
    pending: "bg-amber-500/10 text-amber-400",
    reviewed: "bg-emerald-500/10 text-emerald-400",
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

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** One snapshot line — deleted messages and image-only sends get stand-ins. */
function snapshotText(message: SnapshotMessage): string {
  if (message.deleted_at) return "Message deleted";
  if (message.content && message.image_url) return `${message.content} · Photo`;
  if (message.image_url) return "Photo";
  return message.content ?? "Empty message";
}

export default function AdminDmReportsPage() {
  const [reports, setReports] = useState<DmReportRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [reasonFilter, setReasonFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [counts, setCounts] = useState<Record<StatusFilter, number>>({
    pending: 0,
    reviewed: 0,
    dismissed: 0,
    all: 0,
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Typing settles before the request fires; every keystroke would otherwise
  // re-order and re-page the table under the admin's cursor.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const fetchReports = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), status: statusFilter });
      if (reasonFilter) params.set("reason", reasonFilter);
      if (search) params.set("search", search);
      const res = await fetch(`/api/admin/dm-reports?${params}`);
      const data = await res.json();
      setReports(data.reports ?? []);
      setTotal(data.total ?? 0);
      const next = data.counts ?? { pending: 0, reviewed: 0, dismissed: 0 };
      setCounts({
        pending: next.pending ?? 0,
        reviewed: next.reviewed ?? 0,
        dismissed: next.dismissed ?? 0,
        all: (next.pending ?? 0) + (next.reviewed ?? 0) + (next.dismissed ?? 0),
      });
    } catch {
      // ignore — the table keeps its last good page
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, reasonFilter, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchReports();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchReports]);

  async function runAction(report: DmReportRow, action: "reviewed" | "dismissed" | "reopen") {
    setBusyId(report.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/dm-reports/${report.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setActionError(payload?.error ?? "Failed to update the report.");
        return;
      }
      await fetchReports();
    } catch {
      setActionError("Failed to update the report.");
    } finally {
      setBusyId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(reasonFilter || search);

  const selectClass =
    "rounded-md border border-border bg-surface px-2.5 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:text-foreground focus:border-accent focus:outline-none";

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">DM Reports</h1>
          <p className="mt-0.5 font-body text-xs text-foreground-muted">
            {counts.pending} pending report{counts.pending === 1 ? "" : "s"} from direct messages
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
                setExpandedId(null);
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

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[15rem] flex-1">
          <Search
            size={13}
            strokeWidth={2.5}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-foreground-subtle"
          />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search reported member or reporter…"
            className="w-full rounded-md border border-border bg-surface py-1.5 pr-2.5 pl-8 font-body text-xs text-foreground placeholder:text-foreground-subtle focus:border-accent focus:outline-none"
          />
        </div>
        <select
          value={reasonFilter}
          onChange={(event) => {
            setLoading(true);
            setReasonFilter(event.target.value);
            setPage(1);
          }}
          className={selectClass}
          aria-label="Filter by reason"
        >
          <option value="">All reasons</option>
          {REPORT_REASONS.map((reason) => (
            <option key={reason.value} value={reason.value}>
              {reason.label}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button
            onClick={() => {
              setLoading(true);
              setSearchInput("");
              setSearch("");
              setReasonFilter("");
              setPage(1);
            }}
            className="rounded-md px-2 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            Clear filters
          </button>
        )}
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem]">
              <thead>
                <tr className="border-b border-border">
                  {["Reported member", "Reported by", "Reason", "Details", "Messages", "Reported", "Status", ""].map((heading) => (
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
                  const busy = busyId === report.id;
                  const expanded = expandedId === report.id;
                  const snapshot = report.message_snapshot ?? [];
                  return (
                    <Fragment key={report.id}>
                      <tr
                        className={`${index < reports.length - 1 || expanded ? "border-b border-border-subtle" : ""} align-top transition-colors hover:bg-surface-raised`}
                      >
                        <td className="px-4 py-3">
                          <p className="font-body text-xs font-medium text-foreground">
                            {report.reported_user_name ?? "Unknown member"}
                          </p>
                        </td>
                        <td className="max-w-[12rem] px-4 py-3">
                          <p className="font-body text-xs text-foreground-muted">
                            {report.reporter_id
                              ? report.reporter_name ?? "Unknown member"
                              : "Deleted user"}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded-full border border-border px-1.5 py-0.5 font-body text-[10px] text-foreground-muted">
                            {reportReasonLabel(report.reason)}
                          </span>
                        </td>
                        <td className="max-w-[16rem] px-4 py-3">
                          <p className="line-clamp-2 font-body text-xs text-foreground-muted">
                            {report.details || "—"}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-[10px] text-foreground-muted">
                            {snapshot.length} message{snapshot.length === 1 ? "" : "s"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <p className="font-mono text-[10px] text-foreground-muted">
                            {formatDateTime(report.created_at)}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={report.status} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col items-end gap-1.5">
                            <button
                              onClick={() => setExpandedId(expanded ? null : report.id)}
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 font-body text-xs text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                            >
                              {expanded ? (
                                <ChevronDown strokeWidth={2.5} size={12} />
                              ) : (
                                <ChevronRight strokeWidth={2.5} size={12} />
                              )}
                              {expanded ? "Close" : "Open"}
                            </button>
                            {report.status === "pending" ? (
                              <>
                                <button
                                  onClick={() => void runAction(report, "reviewed")}
                                  disabled={busy}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 px-2.5 py-1 font-body text-xs text-accent transition-colors hover:bg-accent/10 disabled:opacity-40"
                                >
                                  {busy ? <Spinner size={12} /> : <Check strokeWidth={2.5} size={12} />}
                                  Mark reviewed
                                </button>
                                <button
                                  onClick={() => void runAction(report, "dismissed")}
                                  disabled={busy}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 font-body text-xs text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-40"
                                >
                                  {busy ? <Spinner size={12} /> : <EyeOff strokeWidth={2.5} size={12} />}
                                  Dismiss
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => void runAction(report, "reopen")}
                                disabled={busy}
                                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 font-body text-xs text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-40"
                              >
                                {busy ? <Spinner size={12} /> : <RotateCcw strokeWidth={2.5} size={12} />}
                                Reopen
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className={index < reports.length - 1 ? "border-b border-border-subtle" : ""}>
                          <td colSpan={8} className="bg-background/40 px-4 py-3">
                            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                              <div>
                                <p className="font-body text-[10px] font-medium uppercase tracking-wider text-foreground-muted">
                                  Report details
                                </p>
                                <p className="mt-1.5 whitespace-pre-wrap font-body text-xs leading-5 text-foreground">
                                  {report.details || "No details provided."}
                                </p>
                                {report.resolved_at && (
                                  <p className="mt-2 font-mono text-[10px] text-foreground-subtle">
                                    Resolved {formatDateTime(report.resolved_at)}
                                  </p>
                                )}
                              </div>
                              <div>
                                <p className="font-body text-[10px] font-medium uppercase tracking-wider text-foreground-muted">
                                  Conversation at report time
                                </p>
                                {snapshot.length === 0 ? (
                                  <p className="mt-1.5 font-body text-xs text-foreground-subtle">
                                    No messages were stored with this report.
                                  </p>
                                ) : (
                                  <div className="mt-1.5 max-h-64 space-y-1 overflow-y-auto">
                                    {snapshot.map((message) => (
                                      <div
                                        key={message.id}
                                        className="flex items-baseline gap-2 rounded-md bg-surface px-2.5 py-1.5"
                                      >
                                        <span className="shrink-0 font-body text-[10px] font-medium text-foreground-muted">
                                          {message.author_name}
                                        </span>
                                        <span className="shrink-0 font-mono text-[10px] text-foreground-subtle">
                                          {formatDateTime(message.created_at)}
                                        </span>
                                        <span className="min-w-0 flex-1 font-body text-xs text-foreground">
                                          {snapshotText(message)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
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
              Prev
            </button>
            <button
              onClick={() => {
                setLoading(true);
                setPage((current) => Math.min(totalPages, current + 1));
              }}
              disabled={page === totalPages}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
