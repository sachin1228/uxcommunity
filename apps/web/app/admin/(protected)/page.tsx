"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Search, ChevronLeft, ChevronRight, ExternalLink,
  Check, X, FileText, Tag, ChevronDown, Link, Copy, CheckCheck
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { Modal } from "@/components/ui/Modal";

/* ── Types ────────────────────────────────────────────────────────────── */

interface AppTag { tag_id: string; tags: { id: string; name: string } }
interface Application {
  id: string; name: string; email: string;
  linkedin_url: string; portfolio_url: string;
  status: "pending" | "approved" | "rejected";
  review_notes: string | null; applicant_email: string;
  created_at: string; application_tags: AppTag[];
}
interface HistoryItem {
  id: string; status: string; linkedin_url: string;
  portfolio_url: string; review_notes: string | null; created_at: string;
}
interface TagItem { id: string; name: string }

type StatusFilter = "all" | "pending" | "approved" | "rejected";

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "all",      label: "All"      },
  { value: "pending",  label: "Pending"  },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

const STATUS_COLORS = {
  pending:  "bg-yellow-500/10 text-yellow-400",
  approved: "bg-green-500/10 text-green-400",
  rejected: "bg-red-500/10  text-red-400",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status as keyof typeof STATUS_COLORS] ?? "bg-surface-raised text-foreground-muted";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 font-mono text-[10px] font-medium capitalize ${cls}`}>
      {status}
    </span>
  );
}

/* ── Detail Modal ─────────────────────────────────────────────────────── */

function DetailModal({
  app, onClose, onRefresh
}: { app: Application; onClose: () => void; onRefresh: () => void }) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [allTags, setAllTags] = useState<TagItem[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>(
    app.application_tags.map((t) => t.tag_id)
  );
  const [notes, setNotes] = useState(app.review_notes ?? "");
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState<"approve" | "reject" | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionWarning, setActionWarning] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const inviteLink = inviteToken ? `${appUrl}/signup?token=${inviteToken}` : null;

  function copyLink() {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  useEffect(() => {
    fetch(`/api/admin/applications/${app.id}`)
      .then((r) => r.json())
      .then((d) => {
        setHistory(d.history ?? []);
        setNotes(d.application?.review_notes ?? "");
        setSelectedTags(
          (d.application?.application_tags ?? []).map((t: AppTag) => t.tag_id)
        );
        if (d.inviteToken) setInviteToken(d.inviteToken);
      })
      .catch(() => {});

    fetch("/api/admin/tags")
      .then((r) => r.json())
      .then((d) => setAllTags(d.tags ?? []))
      .catch(() => {});
  }, [app.id]);

  async function handleSave() {
    setSaving(true);
    await fetch(`/api/admin/applications/${app.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ review_notes: notes, tag_ids: selectedTags }),
    });
    setSaving(false);
    onRefresh();
  }

  async function handleAction(action: "approve" | "reject") {
    setActionLoading(action);
    setActionMsg(null);
    setActionWarning(false);
    const res = await fetch(`/api/admin/applications/${app.id}/${action}`, { method: "POST" });
    const data = await res.json();
    setActionLoading(null);
    if (res.ok) {
      if (data.token) setInviteToken(data.token);
      if (data.warning) {
        setActionMsg(data.warning);
        setActionWarning(true);
      } else {
        setActionMsg(`Application ${action}d successfully.`);
      }
      onRefresh();
    } else {
      setActionMsg(data.error ?? "Action failed.");
    }
  }

  function toggleTag(id: string) {
    setSelectedTags((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }

  const inputClass =
    "rounded-md border border-border bg-surface px-3 py-2 font-body text-xs text-foreground outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20 w-full";

  return (
    <Modal open onClose={onClose} maxWidth="max-w-2xl" hideCloseButton>
      <div className="flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 mb-0.5">
              <h2 className="font-display text-lg font-semibold text-foreground">{app.name}</h2>
              <StatusBadge status={app.status} />
            </div>
            <p className="font-body text-xs text-foreground-muted">{app.email}</p>
            <p className="font-mono text-[10px] text-foreground-muted mt-0.5">
              Applied {new Date(app.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
          <button onClick={onClose} className="text-foreground-muted hover:text-foreground transition-colors mt-0.5">
            <X size={16} />
          </button>
        </div>

        {/* Links */}
        <div className="flex gap-2">
          <a href={app.linkedin_url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors">
            <ExternalLink size={12} /> LinkedIn
          </a>
          <a href={app.portfolio_url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors">
            <ExternalLink size={12} /> Portfolio
          </a>
        </div>

        {/* Action message */}
        {actionMsg && (
          <div className={`rounded-md border px-3 py-2.5 ${actionWarning ? "border-yellow-500/30 bg-yellow-500/5" : "border-border bg-surface"}`}>
            <p className="font-body text-xs text-foreground-muted">{actionMsg}</p>
          </div>
        )}

        {/* Invite link */}
        {inviteLink && (
          <div className="rounded-md border border-border bg-surface p-3">
            <p className="font-body text-xs font-medium text-foreground mb-2 flex items-center gap-1.5">
              <Link size={12} /> Invitation Link
            </p>
            <div className="flex items-center gap-2">
              <p className="font-mono text-xs text-foreground-muted bg-surface-raised rounded px-2.5 py-1.5 flex-1 truncate select-all">
                {inviteLink}
              </p>
              <button
                onClick={copyLink}
                className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors shrink-0"
              >
                {copied ? <CheckCheck size={12} className="text-green-400" /> : <Copy size={12} />}
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="font-body text-[10px] text-foreground-muted mt-1.5">
              Share this link with the applicant to let them create their account.
            </p>
          </div>
        )}

        {/* Approve / Reject */}
        {app.status === "pending" && (
          <div className="flex gap-2">
            <button
              onClick={() => handleAction("approve")}
              disabled={!!actionLoading}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-green-600 py-2 font-body text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-60"
            >
              {actionLoading === "approve" ? <Spinner className="h-3 w-3" /> : <Check size={13} />}
              Approve &amp; Send Invite
            </button>
            <button
              onClick={() => handleAction("reject")}
              disabled={!!actionLoading}
              className="flex flex-1 items-center justify-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 py-2 font-body text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-60"
            >
              {actionLoading === "reject" ? <Spinner className="h-3 w-3" /> : <X size={13} />}
              Reject
            </button>
          </div>
        )}

        {/* Tags */}
        <div>
          <p className="font-body text-xs font-medium text-foreground mb-2 flex items-center gap-1.5">
            <Tag size={12} /> Internal Tags
          </p>
          <div className="flex flex-wrap gap-1.5">
            {allTags.map((tag) => {
              const active = selectedTags.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag.id)}
                  className={`rounded-full px-2.5 py-0.5 font-body text-xs transition-colors ${
                    active
                      ? "bg-accent text-accent-foreground"
                      : "border border-border bg-surface text-foreground-muted hover:border-accent/40 hover:text-foreground"
                  }`}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Review Notes */}
        <div>
          <p className="font-body text-xs font-medium text-foreground mb-2 flex items-center gap-1.5">
            <FileText size={12} /> Internal Review Notes
          </p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Private notes — not visible to the applicant…"
            className={`${inputClass} resize-none`}
          />
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center justify-center gap-2 rounded-md bg-surface-raised py-2 font-body text-xs font-medium text-foreground transition-colors hover:bg-surface-raised disabled:opacity-60"
        >
          {saving && <Spinner className="h-3 w-3" />}
          {saving ? "Saving…" : "Save Notes & Tags"}
        </button>

        {/* History */}
        {history.length > 0 && (
          <div>
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="flex items-center gap-1 font-body text-xs text-foreground-muted hover:text-foreground transition-colors mb-2"
            >
              <ChevronDown size={13} className={`transition-transform ${showHistory ? "rotate-180" : ""}`} />
              {history.length} previous application{history.length > 1 ? "s" : ""}
            </button>
            {showHistory && (
              <div className="flex flex-col gap-2">
                {history.map((h) => (
                  <div key={h.id} className="rounded-lg border border-border bg-surface p-2.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <StatusBadge status={h.status} />
                      <span className="font-mono text-[10px] text-foreground-muted">
                        {new Date(h.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    </div>
                    <div className="flex gap-2 mb-1.5">
                      <a href={h.linkedin_url} target="_blank" rel="noopener noreferrer" className="font-body text-xs text-accent hover:text-accent-hover">LinkedIn ↗</a>
                      <span className="text-foreground-muted">·</span>
                      <a href={h.portfolio_url} target="_blank" rel="noopener noreferrer" className="font-body text-xs text-accent hover:text-accent-hover">Portfolio ↗</a>
                    </div>
                    {h.review_notes && (
                      <p className="font-body text-xs text-foreground-muted italic">{h.review_notes}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ── Main Page ────────────────────────────────────────────────────────── */

export default function AdminApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [allTags, setAllTags] = useState<TagItem[]>([]);
  const [tagFilter, setTagFilter] = useState("");

  // Per-tab counts — fetched independently so every tab always shows its number
  const [counts, setCounts] = useState<Record<StatusFilter, number>>({ all: 0, pending: 0, approved: 0, rejected: 0 });

  const PAGE_SIZE = 25;

  const fetchCounts = useCallback(async () => {
    try {
      const [all, pending, approved, rejected] = await Promise.all([
        fetch("/api/admin/applications?page=1&status=all&search=").then((r) => r.json()),
        fetch("/api/admin/applications?page=1&status=pending&search=").then((r) => r.json()),
        fetch("/api/admin/applications?page=1&status=approved&search=").then((r) => r.json()),
        fetch("/api/admin/applications?page=1&status=rejected&search=").then((r) => r.json()),
      ]);
      setCounts({
        all:      all.total      ?? 0,
        pending:  pending.total  ?? 0,
        approved: approved.total ?? 0,
        rejected: rejected.total ?? 0,
      });
    } catch {
      // ignore
    }
  }, []);

  const fetchApplications = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        status: statusFilter,
        search,
        ...(tagFilter ? { tag: tagFilter } : {}),
      });
      const res = await fetch(`/api/admin/applications?${params}`);
      const data = await res.json();
      setApplications(data.applications ?? []);
      setTotal(data.total ?? 0);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, search, tagFilter]);

  useEffect(() => { fetchCounts(); }, [fetchCounts]);
  useEffect(() => { fetchApplications(); }, [fetchApplications]);

  useEffect(() => {
    fetch("/api/admin/tags")
      .then((r) => r.json())
      .then((d) => setAllTags(d.tags ?? []))
      .catch(() => {});
  }, []);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [statusFilter, search, tagFilter]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display text-xl font-semibold text-foreground">Applications</h1>
        <span className="font-mono text-xs text-foreground-muted">{total} total</span>
      </div>

      {/* Status tabs */}
      <div className="flex gap-0.5 mb-3 border-b border-border">
        {STATUS_TABS.map(({ value, label }) => {
          const count = counts[value];
          const isActive = statusFilter === value;
          return (
            <button
              key={value}
              onClick={() => { setStatusFilter(value); setSearch(""); }}
              className={`px-3.5 py-2 font-body text-xs font-medium transition-colors border-b-2 -mb-px ${
                isActive
                  ? "border-accent text-accent"
                  : "border-transparent text-foreground-muted hover:text-foreground"
              }`}
            >
              {label}
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 font-mono text-[10px] ${
                isActive ? "bg-accent/15 text-accent" : "bg-surface-raised text-foreground-muted"
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search + tag filter */}
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-muted pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            className="w-full rounded-md border border-border bg-surface pl-8 pr-3 py-1.5 font-body text-xs text-foreground outline-none transition-colors placeholder:text-foreground-muted focus:border-accent focus:ring-1 focus:ring-accent/20"
          />
        </div>
        <select
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="rounded-md border border-border bg-surface px-2.5 py-1.5 font-body text-xs text-foreground outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20"
        >
          <option value="">All tags</option>
          {allTags.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-white/10 bg-surface overflow-hidden mb-3">
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-4 w-4 text-foreground-muted" />
          </div>
        ) : applications.length === 0 ? (
          <p className="py-12 text-center font-body text-xs text-foreground-muted">No applications found.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                {["Name", "Email", "Status", "Tags", "Applied", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left font-body text-[10px] font-medium text-foreground-muted uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {applications.map((app, idx) => (
                <tr
                  key={app.id}
                  className={`${idx < applications.length - 1 ? "border-b border-white/[0.06]" : ""} hover:bg-white/[0.03] transition-colors cursor-pointer`}
                  onClick={() => setSelectedApp(app)}
                >
                  <td className="px-4 py-2.5">
                    <p className="font-body text-xs font-medium text-foreground">{app.name}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="font-body text-xs text-foreground-muted">{app.email}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={app.status} />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {(app.application_tags ?? []).slice(0, 3).map((at) => (
                        <span key={at.tag_id} className="rounded-full bg-surface-raised px-1.5 py-0.5 font-body text-[10px] text-foreground-muted">
                          {at.tags?.name}
                        </span>
                      ))}
                      {app.application_tags?.length > 3 && (
                        <span className="font-mono text-[10px] text-foreground-muted">+{app.application_tags.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="font-mono text-[10px] text-foreground-muted whitespace-nowrap">
                      {new Date(app.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="font-body text-xs text-accent hover:text-accent-hover">View →</span>
                  </td>
                </tr>
              ))}
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
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors disabled:opacity-40"
            >
              <ChevronLeft size={13} /> Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors disabled:opacity-40"
            >
              Next <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {selectedApp && (
        <DetailModal
          app={selectedApp}
          onClose={() => setSelectedApp(null)}
          onRefresh={() => {
            fetchApplications();
            fetchCounts();
            setSelectedApp(null);
          }}
        />
      )}
    </div>
  );
}
