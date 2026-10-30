"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Lock, ShieldCheck } from "lucide-react";
import { AUDIT_ACTION_LABELS } from "@/lib/moderation/action-catalog";

interface AuditEntry {
  id: string;
  moderator_id: string | null;
  moderator_label: string | null;
  moderator_sid: string | null;
  moderator_name: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  report_id: string | null;
  subject_user_id: string | null;
  previous_state: Record<string, unknown>;
  new_state: Record<string, unknown>;
  reason: string | null;
  created_at: string;
}

const TARGET_TYPES: Record<string, string> = {
  thread_comment: "Thread comment",
  showcase_comment: "Showcase comment",
  resource_comment: "Resource comment",
  event_comment: "Event comment",
  community_message: "Chat message",
  profile: "Profile",
  community: "Community",
  job: "Job listing",
};

const ACTION_OPTIONS = Object.keys(AUDIT_ACTION_LABELS);

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The moderation audit trail.
 *
 * Read-only by design: there is no edit or delete control here, because the
 * database rejects both. The previous/new state is rendered as compact JSON so
 * a reviewer can see exactly what a decision changed.
 */
export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [targetType, setTargetType] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (targetType) params.set("target_type", targetType);
      if (action) params.set("action", action);
      if (from) params.set("from", from);
      if (to) params.set("to", to);

      const res = await fetch(`/api/admin/moderation/audit?${params}`);
      const data = (await res.json().catch(() => null)) as
        | { entries?: AuditEntry[]; total?: number; error?: string }
        | null;
      if (!res.ok) {
        setError(data?.error ?? "Failed to load the audit log.");
        return;
      }
      setEntries(data?.entries ?? []);
      setTotal(data?.total ?? 0);
    } catch {
      setError("Failed to load the audit log.");
    } finally {
      setLoading(false);
    }
  }, [targetType, action, from, to, page]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
          <ShieldCheck size={18} strokeWidth={2.5} />
          Moderation audit log
        </h1>
        <p className="mt-1 font-body text-xs text-foreground-muted">
          Every moderator decision, in order. Records are append-only — they
          cannot be edited or deleted, including by an administrator.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-body text-[10px] uppercase tracking-wide text-foreground-subtle">
            Target type
          </span>
          <select
            value={targetType}
            onChange={(event) => {
              setTargetType(event.target.value);
              setPage(1);
            }}
            className="field h-9 text-xs"
          >
            <option value="">All targets</option>
            {Object.entries(TARGET_TYPES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-body text-[10px] uppercase tracking-wide text-foreground-subtle">
            Action
          </span>
          <select
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setPage(1);
            }}
            className="field h-9 text-xs"
          >
            <option value="">All actions</option>
            {ACTION_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {AUDIT_ACTION_LABELS[value]}
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
        ) : entries.length === 0 ? (
          <p className="py-16 text-center font-body text-xs text-foreground-muted">
            No moderation actions recorded.
          </p>
        ) : (
          <table className="w-full min-w-[900px] text-left">
            <thead className="border-b border-border bg-surface-raised">
              <tr className="font-body text-[10px] uppercase tracking-wide text-foreground-subtle">
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Moderator</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Target</th>
                <th className="px-3 py-2 font-medium">Report</th>
                <th className="px-3 py-2 font-medium">Reason / state</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const isExpanded = expanded === entry.id;
                return (
                  <tr
                    key={entry.id}
                    className="border-b border-border-subtle align-top last:border-0"
                  >
                    <td className="whitespace-nowrap px-3 py-3 font-body text-[11px] text-foreground-muted">
                      {formatDate(entry.created_at)}
                    </td>
                    <td className="px-3 py-3 font-body text-xs text-foreground">
                      {entry.moderator_label ?? entry.moderator_name ?? "Platform admin"}
                      <span className="mt-0.5 block font-mono text-[9px] text-foreground-subtle">
                        {entry.moderator_sid ? entry.moderator_sid.slice(0, 8) : "—"}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-body text-xs text-foreground">
                      {AUDIT_ACTION_LABELS[entry.action] ?? entry.action}
                    </td>
                    <td className="px-3 py-3 font-body text-[11px] text-foreground-muted">
                      {TARGET_TYPES[entry.target_type] ?? entry.target_type}
                      <span className="mt-0.5 block font-mono text-[9px] text-foreground-subtle">
                        {entry.target_id ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-[9px] text-foreground-subtle">
                      {entry.report_id ?? "—"}
                    </td>
                    <td className="max-w-[320px] px-3 py-3 font-body text-[11px] text-foreground-muted">
                      {entry.reason || "—"}
                      <button
                        type="button"
                        onClick={() => setExpanded(isExpanded ? null : entry.id)}
                        className="mt-1 block text-[10px] text-accent hover:underline"
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? "Hide state" : "Show previous / new state"}
                      </button>
                      {isExpanded && (
                        <pre className="mt-1.5 whitespace-pre-wrap break-all rounded-md bg-surface-raised p-2 font-mono text-[10px] leading-relaxed text-foreground-muted">
                          {JSON.stringify(
                            {
                              previous: entry.previous_state,
                              new: entry.new_state,
                              subject_user_id: entry.subject_user_id,
                            },
                            null,
                            2,
                          )}
                        </pre>
                      )}
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
            Page {page} of {pages} · {total} entr{total === 1 ? "y" : "ies"}
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
        <Lock size={11} strokeWidth={2.5} />
        Append-only: the database rejects updates and deletes on this table.
      </p>
    </div>
  );
}
