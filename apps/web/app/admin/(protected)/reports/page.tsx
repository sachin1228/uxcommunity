"use client";

// The report queue, grouped by post: one row per reported thread, showcase
// post, resource or event — a popular post reported by ten members is one row
// with a "10 reports" badge, not ten rows. Filters (status, content type,
// reason, search) and sort (newest, oldest, most reported) ride the query
// string to /api/admin/reports, which reads the report_groups view.
//
// "Delete post" takes the content down through the shared removal path,
// snapshots it for undo, and notifies the author (with the reason) plus every
// reporter; "Dismiss" closes the post's open reports. Both offer an undo
// toast (see lib/undo-toast) — dismissing re-opens the reports, deleting
// restores the post. Rows open the detail page, where the post itself (which
// admins cannot open on the member side) is previewed in full.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Flag,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/Spinner";
import { showUndoToast } from "@/lib/undo-toast";
import {
  REPORT_CONTENT_LABELS,
  REPORT_REASONS,
  reportReasonLabel,
  type ReportableContentType,
} from "@/lib/communities/report-reasons";

type GroupStatus = "pending" | "removed" | "dismissed";
type StatusFilter = GroupStatus | "all";

interface ReportGroup {
  content_type: ReportableContentType;
  content_id: string;
  community_id: string | null;
  content_author_id: string | null;
  content_title: string | null;
  report_count: number;
  pending_count: number;
  status: GroupStatus;
  reasons: string[] | null;
  reporter_names: string[] | null;
  first_reported_at: string;
  last_reported_at: string;
  content_exists: boolean;
  author_name: string | null;
  community_name: string | null;
  can_restore: boolean;
}

const STATUS_TABS: Array<{ value: StatusFilter; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "removed", label: "Removed" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
];

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "most_reported", label: "Most reported" },
];

const PAGE_SIZE = 25;

function groupKey(group: ReportGroup) {
  return `${group.content_type}:${group.content_id}`;
}

function actionUrl(group: ReportGroup) {
  return `/api/admin/reports/${group.content_type}/${group.content_id}`;
}

function groupLabel(group: ReportGroup) {
  return group.content_title || `(untitled ${REPORT_CONTENT_LABELS[group.content_type]})`;
}

function StatusBadge({ status }: { status: GroupStatus }) {
  const styles: Record<GroupStatus, string> = {
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

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function AdminReportsPage() {
  const [groups, setGroups] = useState<ReportGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [contentTypeFilter, setContentTypeFilter] = useState("");
  const [reasonFilter, setReasonFilter] = useState("");
  const [sort, setSort] = useState("newest");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [counts, setCounts] = useState<Record<StatusFilter, number>>({
    pending: 0,
    removed: 0,
    dismissed: 0,
    all: 0,
  });
  const [confirmTarget, setConfirmTarget] = useState<ReportGroup | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
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

  const fetchGroups = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), status: statusFilter, sort });
      if (contentTypeFilter) params.set("content_type", contentTypeFilter);
      if (reasonFilter) params.set("reason", reasonFilter);
      if (search) params.set("search", search);
      const res = await fetch(`/api/admin/reports?${params}`);
      const data = await res.json();
      setGroups(data.groups ?? []);
      setTotal(data.total ?? 0);
      const next = data.counts ?? { pending: 0, removed: 0, dismissed: 0 };
      setCounts({
        pending: next.pending ?? 0,
        removed: next.removed ?? 0,
        dismissed: next.dismissed ?? 0,
        all: (next.pending ?? 0) + (next.removed ?? 0) + (next.dismissed ?? 0),
      });
    } catch {
      // ignore — the table keeps its last good page
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, sort, contentTypeFilter, reasonFilter, search]);

  // Page/filter handlers flip the spinner on before the fetch; the fetch
  // itself only settles it, so the effect below never cascades a render. The
  // fetch starts in a timeout, like the notifications hook, so the effect
  // body itself stays free of synchronous state writes.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchGroups();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchGroups]);

  function refreshAfterAction() {
    return fetchGroups();
  }

  async function dismissGroup(group: ReportGroup) {
    setBusyKey(groupKey(group));
    setActionError(null);
    try {
      const res = await fetch(actionUrl(group), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss" }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setActionError(payload?.error ?? "Failed to dismiss the reports.");
        return;
      }
      await refreshAfterAction();

      const dismissedIds: string[] = payload?.dismissedReportIds ?? [];
      if (dismissedIds.length) {
        showUndoToast({
          message: `Dismissed ${dismissedIds.length} report${dismissedIds.length === 1 ? "" : "s"} on "${groupLabel(group)}".`,
          onAction: async () => {
            const undoRes = await fetch(actionUrl(group), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "reopen", reportIds: dismissedIds }),
            });
            if (!undoRes.ok) throw new Error("reopen failed");
            await refreshAfterAction();
          },
        });
      }
    } catch {
      setActionError("Failed to dismiss the reports.");
    } finally {
      setBusyKey(null);
    }
  }

  async function removeGroup(group: ReportGroup) {
    setBusyKey(groupKey(group));
    setActionError(null);
    try {
      const res = await fetch(actionUrl(group), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove" }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setActionError(payload?.error ?? "Failed to remove the post.");
        return;
      }
      await refreshAfterAction();

      if (payload?.removed) {
        showUndoToast({
          message: "Post removed — the author and reporters were notified.",
          onAction: async () => {
            const undoRes = await fetch(actionUrl(group), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "restore" }),
            });
            if (!undoRes.ok) throw new Error("restore failed");
            await refreshAfterAction();
          },
        });
      }
    } catch {
      setActionError("Failed to remove the post.");
    } finally {
      setBusyKey(null);
    }
  }

  async function restoreGroup(group: ReportGroup) {
    setBusyKey(groupKey(group));
    setActionError(null);
    try {
      const res = await fetch(actionUrl(group), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setActionError(payload?.error ?? "Failed to restore the post.");
        return;
      }
      await refreshAfterAction();
    } catch {
      setActionError("Failed to restore the post.");
    } finally {
      setBusyKey(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(contentTypeFilter || reasonFilter || search);

  const selectClass =
    "rounded-md border border-border bg-surface px-2.5 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:text-foreground focus:border-accent focus:outline-none";

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
            placeholder="Search title, author or community…"
            className="w-full rounded-md border border-border bg-surface py-1.5 pr-2.5 pl-8 font-body text-xs text-foreground placeholder:text-foreground-subtle focus:border-accent focus:outline-none"
          />
        </div>
        <select
          value={contentTypeFilter}
          onChange={(event) => {
            setLoading(true);
            setContentTypeFilter(event.target.value);
            setPage(1);
          }}
          className={selectClass}
          aria-label="Filter by content type"
        >
          <option value="">All content</option>
          {Object.entries(REPORT_CONTENT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label.charAt(0).toUpperCase() + label.slice(1)}
            </option>
          ))}
        </select>
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
        <select
          value={sort}
          onChange={(event) => {
            setLoading(true);
            setSort(event.target.value);
            setPage(1);
          }}
          className={selectClass}
          aria-label="Sort reports"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button
            onClick={() => {
              setLoading(true);
              setSearchInput("");
              setSearch("");
              setContentTypeFilter("");
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
        ) : groups.length === 0 ? (
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
                  {["Reported content", "Author", "Community", "Reported by", "Reasons", "Last report", "Status", ""].map((heading) => (
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
                {groups.map((group, index) => {
                  const key = groupKey(group);
                  const busy = busyKey === key;
                  return (
                    <tr
                      key={key}
                      className={`${index < groups.length - 1 ? "border-b border-border-subtle" : ""} align-top transition-colors hover:bg-surface-raised`}
                    >
                      <td className="max-w-[20rem] px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded-full bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-foreground-muted">
                            {REPORT_CONTENT_LABELS[group.content_type] ?? group.content_type}
                          </span>
                          <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-400">
                            {group.report_count} report{group.report_count === 1 ? "" : "s"}
                          </span>
                          {!group.content_exists && (
                            <span className="font-mono text-[10px] text-foreground-subtle">deleted</span>
                          )}
                        </div>
                        <Link
                          href={`/admin/reports/${group.content_type}/${group.content_id}`}
                          className="mt-1.5 line-clamp-2 font-body text-xs font-medium text-foreground hover:text-accent hover:underline"
                        >
                          {groupLabel(group)}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {group.content_author_id ? (
                          <Link
                            href={`/admin/users/${group.content_author_id}`}
                            className="font-body text-xs text-foreground-muted hover:text-accent hover:underline"
                          >
                            {group.author_name ?? "Unknown"}
                          </Link>
                        ) : (
                          <span className="font-body text-xs text-foreground-muted">
                            {group.author_name ?? "Unknown"}
                          </span>
                        )}
                      </td>
                      <td className="max-w-[12rem] px-4 py-3">
                        {group.community_id ? (
                          <Link
                            href={`/admin/communities/${group.community_id}`}
                            className="line-clamp-2 font-body text-xs text-foreground-muted hover:text-accent hover:underline"
                          >
                            {group.community_name ?? "Community"}
                          </Link>
                        ) : (
                          <span className="font-body text-xs text-foreground-subtle">Public feed</span>
                        )}
                      </td>
                      <td className="max-w-[12rem] px-4 py-3">
                        <p className="line-clamp-2 font-body text-xs text-foreground-muted">
                          {(group.reporter_names ?? []).filter(Boolean).join(", ") || "—"}
                        </p>
                      </td>
                      <td className="max-w-[14rem] px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(group.reasons ?? []).map((reason) => (
                            <span
                              key={reason}
                              className="rounded-full border border-border px-1.5 py-0.5 font-body text-[10px] text-foreground-muted"
                            >
                              {reportReasonLabel(reason)}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <p className="font-mono text-[10px] text-foreground-muted">
                          {formatDate(group.last_reported_at)}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={group.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-end gap-1.5">
                          <Link
                            href={`/admin/reports/${group.content_type}/${group.content_id}`}
                            className="rounded-md border border-border px-2.5 py-1 font-body text-xs text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                          >
                            Open
                          </Link>
                          {group.pending_count > 0 ? (
                            <>
                              <button
                                onClick={() => setConfirmTarget(group)}
                                disabled={busy}
                                className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 px-2.5 py-1 font-body text-xs text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-40"
                              >
                                {busy ? <Spinner size={12} /> : <Trash2 strokeWidth={2.5} size={12} />}
                                Delete post
                              </button>
                              <button
                                onClick={() => void dismissGroup(group)}
                                disabled={busy}
                                className="rounded-md border border-border px-2.5 py-1 font-body text-xs text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-40"
                              >
                                Dismiss
                              </button>
                            </>
                          ) : group.can_restore && !group.content_exists ? (
                            <button
                              onClick={() => void restoreGroup(group)}
                              disabled={busy}
                              className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 px-2.5 py-1 font-body text-xs text-accent transition-colors hover:bg-accent/10 disabled:opacity-40"
                            >
                              {busy ? <Spinner size={12} /> : <RotateCcw strokeWidth={2.5} size={12} />}
                              Restore
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
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
            ? `This removes the ${REPORT_CONTENT_LABELS[confirmTarget.content_type]} reported by ${confirmTarget.report_count} member${confirmTarget.report_count === 1 ? "" : "s"} and notifies the author plus every reporter. You can undo this right after.`
            : ""
        }
        confirmLabel="Delete post"
        onClose={() => setConfirmTarget(null)}
        onConfirm={async () => {
          if (!confirmTarget) return;
          await removeGroup(confirmTarget);
          setConfirmTarget(null);
        }}
      />
    </div>
  );
}
