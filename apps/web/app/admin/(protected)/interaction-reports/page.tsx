"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ExternalLink,
  Flag,
  Loader2,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import {
  ALL_REPORT_REASONS,
  reportReasonLabel,
  type InteractionReportType,
} from "@/lib/communities/report-reasons";
import {
  actionNeedsSubject,
  allowedModerationActions,
  AUDIT_ACTION_LABELS,
  MODERATION_ACTION_LABELS,
  type ModerationActionId,
} from "@/lib/moderation/action-catalog";
import { ModerationActionDialog } from "@/components/admin/moderation/ModerationActionDialog";

interface InteractionReport {
  id: string;
  /** Null after the reporter's account was deleted; the report is retained. */
  reporter_id: string | null;
  reporter_name: string | null;
  reporter_deleted_at: string | null;
  target_type: InteractionReportType;
  target_id: string;
  target_author_id: string | null;
  target_author_name: string | null;
  target_excerpt: string | null;
  context_title: string | null;
  community_id: string | null;
  community_name: string | null;
  reason: string;
  details: string | null;
  status: "pending" | "removed" | "actioned" | "dismissed";
  created_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
  target_snapshot: Record<string, unknown> | null;
}

interface AuditEntry {
  id: string;
  action: string;
  moderator_name: string | null;
  reason: string | null;
  created_at: string;
  previous_state: Record<string, unknown>;
  new_state: Record<string, unknown>;
}

const TYPE_LABELS: Record<InteractionReportType, string> = {
  thread_comment: "Thread comment",
  showcase_comment: "Showcase comment",
  resource_comment: "Resource comment",
  event_comment: "Event comment",
  community_message: "Chat message",
  profile: "Profile",
  community: "Community",
  job: "Job listing",
};

const STATUS_LABELS: Record<InteractionReport["status"], string> = {
  pending: "Pending",
  removed: "Removed",
  actioned: "Actioned",
  dismissed: "Dismissed",
};

const STATUS_TABS = [
  { value: "pending", label: "Pending" },
  { value: "removed", label: "Removed" },
  { value: "actioned", label: "Actioned" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
] as const;

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function snapshotText(snapshot: Record<string, unknown> | null, key: string): string | null {
  const value = snapshot?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function targetName(report: InteractionReport): string {
  return (
    report.context_title ||
    snapshotText(report.target_snapshot, "name") ||
    snapshotText(report.target_snapshot, "title") ||
    report.target_id.slice(0, 8)
  );
}

export default function ModerationQueuePage() {
  const [reports, setReports] = useState<InteractionReport[]>([]);
  const [status, setStatus] = useState<(typeof STATUS_TABS)[number]["value"]>("pending");
  const [typeFilter, setTypeFilter] = useState("");
  const [reasonFilter, setReasonFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [auditByReport, setAuditByReport] = useState<Record<string, AuditEntry[]>>({});

  const [dialog, setDialog] = useState<{
    report: InteractionReport;
    action: ModerationActionId;
  } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status, page: String(page) });
      if (typeFilter) params.set("target_type", typeFilter);
      if (reasonFilter) params.set("reason", reasonFilter);
      if (from) params.set("from", from);
      if (to) params.set("to", to);

      const res = await fetch(`/api/admin/interaction-reports?${params}`);
      const data = (await res.json().catch(() => null)) as
        | { reports?: InteractionReport[]; total?: number; error?: string }
        | null;
      if (!res.ok) {
        setError(data?.error ?? "Failed to load reports.");
        return;
      }
      setReports(data?.reports ?? []);
      setTotal(data?.total ?? 0);
    } catch {
      setError("Failed to load reports.");
    } finally {
      setLoading(false);
    }
  }, [status, typeFilter, reasonFilter, from, to, page]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);


  async function toggleExpanded(report: InteractionReport) {
    const next = expanded === report.id ? null : report.id;
    setExpanded(next);
    if (!next || auditByReport[report.id]) return;

    try {
      const params = new URLSearchParams({
        target_type: report.target_type,
        target_id: report.target_id,
      });
      const res = await fetch(`/api/admin/moderation/audit?${params}`);
      const data = (await res.json().catch(() => null)) as
        | { entries?: AuditEntry[] }
        | null;
      setAuditByReport((current) => ({ ...current, [report.id]: data?.entries ?? [] }));
    } catch {
      setAuditByReport((current) => ({ ...current, [report.id]: [] }));
    }
  }

  async function confirmAction(input: { note: string; suspendDays: number | null }) {
    if (!dialog || actionBusy) return;
    setActionBusy(true);
    setDialogError(null);
    try {
      const res = await fetch(`/api/admin/interaction-reports/${dialog.report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: dialog.action,
          note: input.note || undefined,
          suspend_days: input.suspendDays ?? undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setDialogError(data?.error ?? "Failed to resolve the report.");
        return;
      }
      setDialog(null);
      setExpanded(null);
      setAuditByReport({});
      await load();
    } catch {
      setDialogError("Failed to resolve the report.");
    } finally {
      setActionBusy(false);
    }
  }

  const pages = Math.max(1, Math.ceil(total / 25));
  const activeFilters = useMemo(
    () => Boolean(typeFilter || reasonFilter || from || to),
    [typeFilter, reasonFilter, from, to],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">
            Moderation queue
          </h1>
          <p className="mt-1 font-body text-xs text-foreground-muted">
            Comments, chat messages, profiles, communities and job listings in one
            queue. Post reports live under Reports.
          </p>
        </div>
        <Link
          href="/admin/audit-log"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
        >
          <ShieldCheck size={13} strokeWidth={2.5} />
          Audit log
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => {
              setStatus(tab.value);
              setPage(1);
            }}
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

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-body text-[10px] uppercase tracking-wide text-foreground-subtle">
            Type
          </span>
          <select
            value={typeFilter}
            onChange={(event) => {
              setTypeFilter(event.target.value);
              setPage(1);
            }}
            className="field h-9 text-xs"
          >
            <option value="">All types</option>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-body text-[10px] uppercase tracking-wide text-foreground-subtle">
            Reason
          </span>
          <select
            value={reasonFilter}
            onChange={(event) => {
              setReasonFilter(event.target.value);
              setPage(1);
            }}
            className="field h-9 text-xs"
          >
            <option value="">All reasons</option>
            {ALL_REPORT_REASONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-body text-[10px] uppercase tracking-wide text-foreground-subtle">
            From
          </span>
          <input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setPage(1);
            }}
            className="field h-9 text-xs"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-body text-[10px] uppercase tracking-wide text-foreground-subtle">
            To
          </span>
          <input
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setPage(1);
            }}
            className="field h-9 text-xs"
          />
        </label>

        {activeFilters && (
          <button
            type="button"
            onClick={() => {
              setTypeFilter("");
              setReasonFilter("");
              setFrom("");
              setTo("");
              setPage(1);
            }}
            className="h-9 rounded-md border border-border px-3 font-body text-xs text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            Clear filters
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-body text-xs text-red-400">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
          </div>
        ) : reports.length === 0 ? (
          <p className="py-16 text-center font-body text-xs text-foreground-muted">
            {status === "pending" ? "No pending reports." : "Nothing here."}
          </p>
        ) : (
          <table className="w-full min-w-[960px] text-left">
            <thead className="border-b border-border bg-surface-raised">
              <tr className="font-body text-[10px] uppercase tracking-wide text-foreground-subtle">
                <th className="px-3 py-2 font-medium">Report</th>
                <th className="px-3 py-2 font-medium">Reported target</th>
                <th className="px-3 py-2 font-medium">Reason</th>
                <th className="px-3 py-2 font-medium">Reporter</th>
                <th className="px-3 py-2 font-medium">Submitted</th>
                {status === "all" && <th className="px-3 py-2 font-medium">Status</th>}
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => {
                const isExpanded = expanded === report.id;
                const reportAudit = auditByReport[report.id] ?? [];
                const actions = allowedModerationActions(report.target_type);
                const primary = actions[0];
                const canAct = report.status === "pending";

                return (
                  <tr
                    key={report.id}
                    className="border-b border-border-subtle align-top last:border-0"
                  >
                    <td className="px-3 py-3 font-body text-xs text-foreground">
                      <span className="block font-medium">{TYPE_LABELS[report.target_type]}</span>
                      <span className="mt-0.5 block text-[11px] text-foreground-muted">
                        {report.community_name || report.context_title || "—"}
                      </span>
                    </td>

                    <td className="max-w-[320px] px-3 py-3">
                      <button
                        type="button"
                        onClick={() => void toggleExpanded(report)}
                        className="block w-full text-left font-body text-xs text-foreground"
                        aria-expanded={isExpanded}
                      >
                        <span className="block font-medium">{targetName(report)}</span>
                        <span
                          className={`mt-0.5 block text-[11px] text-foreground-muted ${
                            isExpanded ? "whitespace-pre-wrap" : "line-clamp-2"
                          }`}
                        >
                          {report.target_excerpt || "No text content"}
                        </span>
                      </button>
                      <span className="mt-1 block text-[11px] text-foreground-muted">
                        by {report.target_author_name || "unknown"}
                      </span>

                      {isExpanded && (
                        <div className="mt-2 flex flex-col gap-2 rounded-md bg-surface-raised px-2.5 py-2">
                          {report.target_snapshot &&
                            Object.keys(report.target_snapshot).length > 0 && (
                              <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
                                {snapshotText(report.target_snapshot, "company_name") && (
                                  <>
                                    <dt className="text-foreground-subtle">Company</dt>
                                    <dd className="text-foreground-muted">
                                      {snapshotText(report.target_snapshot, "company_name")}
                                    </dd>
                                  </>
                                )}
                                {snapshotText(report.target_snapshot, "owner_name") && (
                                  <>
                                    <dt className="text-foreground-subtle">Owner</dt>
                                    <dd className="text-foreground-muted">
                                      {snapshotText(report.target_snapshot, "owner_name")}
                                    </dd>
                                  </>
                                )}
                                {snapshotText(report.target_snapshot, "description") && (
                                  <>
                                    <dt className="text-foreground-subtle">Snapshot</dt>
                                    <dd className="line-clamp-3 text-foreground-muted">
                                      {snapshotText(report.target_snapshot, "description")}
                                    </dd>
                                  </>
                                )}
                              </dl>
                            )}

                          {report.details && (
                            <p className="text-[11px] text-foreground-muted">
                              Reporter note: {report.details}
                            </p>
                          )}

                          {report.resolution_note && (
                            <p className="text-[11px] text-foreground-muted">
                              Resolution note: {report.resolution_note}
                            </p>
                          )}

                          <div>
                            <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-foreground-subtle">
                              <ShieldCheck size={10} strokeWidth={2.5} />
                              Previous moderation actions
                            </p>
                            {reportAudit.length === 0 ? (
                              <p className="mt-1 text-[11px] text-foreground-subtle">
                                No prior actions against this target.
                              </p>
                            ) : (
                              <ul className="mt-1 flex flex-col gap-1">
                                {reportAudit.slice(0, 5).map((entry) => (
                                  <li key={entry.id} className="text-[11px] text-foreground-muted">
                                    <span className="text-foreground">
                                      {AUDIT_ACTION_LABELS[entry.action] ?? entry.action}
                                    </span>{" "}
                                    · {formatDate(entry.created_at)} ·{" "}
                                    {entry.moderator_name ?? "Platform admin"}
                                    {entry.reason ? ` · ${entry.reason}` : ""}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      )}
                    </td>

                    <td className="px-3 py-3 font-body text-xs text-foreground-muted">
                      {reportReasonLabel(report.reason)}
                    </td>
                    <td className="px-3 py-3 font-body text-xs text-foreground-muted">
                      {report.reporter_id ? report.reporter_name || "Member" : "Deleted user"}
                      <span className="mt-0.5 block text-[10px] text-foreground-subtle">
                        {report.reporter_id
                          ? "Identity hidden from the target"
                          : "Reporter account deleted"}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-body text-[11px] text-foreground-muted">
                      {formatDate(report.created_at)}
                    </td>
                    {status === "all" && (
                      <td className="px-3 py-3 font-body text-[11px] text-foreground-muted">
                        {STATUS_LABELS[report.status]}
                      </td>
                    )}

                    <td className="px-3 py-3">
                      <div className="flex max-w-[220px] flex-wrap gap-1.5">
                        {report.target_type === "profile" && report.target_author_id && (
                          <Link
                            href={`/admin/users/${report.target_author_id}`}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-body text-[11px] text-foreground hover:bg-surface-raised"
                          >
                            <ExternalLink size={11} strokeWidth={2.5} />
                            Open member
                          </Link>
                        )}

                        {actions.map((action) => {
                          const needsSubject = actionNeedsSubject(action);
                          const disabled =
                            actionBusy ||
                            !canAct ||
                            (needsSubject && !report.target_author_id);
                          const emphasis =
                            action === primary
                              ? action === "remove" ||
                                action === "hide_community" ||
                                action === "deactivate_job"
                                ? "border-red-500/30 text-red-400 hover:bg-red-500/10"
                                : "border-border text-foreground hover:bg-surface-raised"
                              : action === "ban_user"
                                ? "border-red-500/30 text-red-400 hover:bg-red-500/10"
                                : "border-border text-foreground-muted hover:bg-surface-raised";
                          return (
                            <button
                              key={action}
                              type="button"
                              disabled={disabled}
                              onClick={() => {
                                setDialogError(null);
                                setDialog({ report, action });
                              }}
                              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 font-body text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${emphasis}`}
                            >
                              {needsSubject ? (
                                <UserRound size={11} strokeWidth={2.5} />
                              ) : action === "dismiss" ? (
                                <Flag size={11} strokeWidth={2.5} />
                              ) : (
                                <ShieldCheck size={11} strokeWidth={2.5} />
                              )}
                              {MODERATION_ACTION_LABELS[action]}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between font-body text-xs text-foreground-muted">
          <span>
            Page {page} of {pages} · {total} report{total === 1 ? "" : "s"}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="rounded-md border border-border px-2.5 py-1.5 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => setPage((current) => current + 1)}
              className="rounded-md border border-border px-2.5 py-1.5 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <p className="flex items-center gap-1.5 font-body text-[11px] text-foreground-subtle">
        <Flag size={11} strokeWidth={2.5} />
        Every action is recorded in the audit log. Reporters stay anonymous to the
        reported account.
      </p>

      <ModerationActionDialog
        key={`${dialog?.report.id ?? "none"}:${dialog?.action ?? "none"}`}
        open={Boolean(dialog)}
        action={dialog?.action ?? null}
        targetLabel={dialog ? targetName(dialog.report) : ""}
        busy={actionBusy}
        error={dialogError}
        onClose={() => {
          setDialog(null);
          setDialogError(null);
        }}
        onConfirm={(input) => void confirmAction(input)}
      />
    </div>
  );
}

