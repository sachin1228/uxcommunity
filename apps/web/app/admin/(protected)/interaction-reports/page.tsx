"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Flag, Loader2, Trash2, X } from "lucide-react";
import { reportReasonLabel } from "@/lib/communities/report-reasons";

interface InteractionReport {
  id: string;
  reporter_id: string;
  reporter_name: string | null;
  target_type:
    | "thread_comment"
    | "showcase_comment"
    | "resource_comment"
    | "event_comment"
    | "community_message"
    | "profile";
  target_id: string;
  target_author_id: string | null;
  target_author_name: string | null;
  target_excerpt: string | null;
  context_title: string | null;
  community_id: string | null;
  community_name: string | null;
  reason: string;
  details: string | null;
  status: "pending" | "removed" | "dismissed";
  created_at: string;
}

const TYPE_LABELS: Record<InteractionReport["target_type"], string> = {
  thread_comment: "Thread comment",
  showcase_comment: "Showcase comment",
  resource_comment: "Resource comment",
  event_comment: "Event comment",
  community_message: "Chat message",
  profile: "Profile",
};

const STATUS_TABS = [
  { value: "pending", label: "Pending" },
  { value: "removed", label: "Removed" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
] as const;

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function InteractionReportsPage() {
  const [reports, setReports] = useState<InteractionReport[]>([]);
  const [status, setStatus] = useState<(typeof STATUS_TABS)[number]["value"]>("pending");
  const [typeFilter, setTypeFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status });
      if (typeFilter) params.set("target_type", typeFilter);
      const res = await fetch(`/api/admin/interaction-reports?${params}`);
      const data = (await res.json().catch(() => null)) as
        | { reports?: InteractionReport[]; error?: string }
        | null;
      if (!res.ok) {
        setError(data?.error ?? "Failed to load reports.");
        return;
      }
      setReports(data?.reports ?? []);
    } catch {
      setError("Failed to load reports.");
    } finally {
      setLoading(false);
    }
  }, [status, typeFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function resolve(report: InteractionReport, action: "dismiss" | "remove") {
    if (busyId) return;
    setBusyId(report.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/interaction-reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "Failed to resolve the report.");
        return;
      }
      setReports((current) => current.filter((row) => row.id !== report.id));
    } catch {
      setError("Failed to resolve the report.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">
            Comments &amp; chat reports
          </h1>
          <p className="mt-1 font-body text-xs text-foreground-muted">
            Reports about comments, community chat messages and profiles. Post
            reports live under Reports.
          </p>
        </div>
        <select
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
          className="field h-9 text-xs"
          aria-label="Filter by type"
        >
          <option value="">All types</option>
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
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

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
          </div>
        ) : reports.length === 0 ? (
          <p className="py-16 text-center font-body text-xs text-foreground-muted">
            {status === "pending" ? "No pending reports." : "Nothing here."}
          </p>
        ) : (
          <table className="w-full text-left">
            <thead className="border-b border-border bg-surface-raised">
              <tr className="font-body text-[10px] uppercase tracking-wide text-foreground-subtle">
                <th className="px-3 py-2 font-medium">Target</th>
                <th className="px-3 py-2 font-medium">Reported content</th>
                <th className="px-3 py-2 font-medium">Reason</th>
                <th className="px-3 py-2 font-medium">Reporter</th>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => {
                const isExpanded = expanded === report.id;
                return (
                  <tr
                    key={report.id}
                    className="border-b border-border-subtle align-top last:border-0"
                  >
                    <td className="px-3 py-3 font-body text-xs text-foreground">
                      <span className="block font-medium">{TYPE_LABELS[report.target_type]}</span>
                      <span className="mt-0.5 block text-[11px] text-foreground-muted">
                        {report.context_title || report.community_name || "—"}
                      </span>
                    </td>
                    <td className="max-w-[320px] px-3 py-3">
                      <button
                        type="button"
                        onClick={() => setExpanded(isExpanded ? null : report.id)}
                        className="block w-full text-left font-body text-xs text-foreground"
                        aria-expanded={isExpanded}
                      >
                        <span className={isExpanded ? "whitespace-pre-wrap" : "line-clamp-2"}>
                          {report.target_excerpt || "No text content"}
                        </span>
                      </button>
                      <span className="mt-1 block text-[11px] text-foreground-muted">
                        by {report.target_author_name || "unknown"}
                      </span>
                      {isExpanded && report.details && (
                        <p className="mt-2 rounded-md bg-surface-raised px-2.5 py-2 text-[11px] text-foreground-muted">
                          Reporter note: {report.details}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3 font-body text-xs text-foreground-muted">
                      {reportReasonLabel(report.reason)}
                    </td>
                    <td className="px-3 py-3 font-body text-xs text-foreground-muted">
                      {report.reporter_name || "Member"}
                    </td>
                    <td className="px-3 py-3 font-body text-[11px] text-foreground-muted">
                      {formatDate(report.created_at)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-1.5">
                        {report.target_type === "profile" ? (
                          report.target_author_id && (
                            <Link
                              href={`/admin/users/${report.target_author_id}`}
                              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-body text-[11px] text-foreground hover:bg-surface-raised"
                            >
                              <ExternalLink size={11} strokeWidth={2.5} />
                              Open member
                            </Link>
                          )
                        ) : (
                          <button
                            type="button"
                            onClick={() => void resolve(report, "remove")}
                            disabled={busyId === report.id}
                            className="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 px-2.5 py-1.5 font-body text-[11px] text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                          >
                            {busyId === report.id ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : (
                              <Trash2 size={11} strokeWidth={2.5} />
                            )}
                            Delete content
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void resolve(report, "dismiss")}
                          disabled={busyId === report.id}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-body text-[11px] text-foreground-muted hover:bg-surface-raised disabled:opacity-50"
                        >
                          <X size={11} strokeWidth={2.5} />
                          Dismiss
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="flex items-center gap-1.5 font-body text-[11px] text-foreground-subtle">
        <Flag size={11} strokeWidth={2.5} />
        Profile reports are handled from the member page (block or delete the account).
      </p>
    </div>
  );
}
