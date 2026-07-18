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

const STATUS_COLORS = {
  pending:  "bg-yellow-500/10 text-yellow-400",
  approved: "bg-green-500/10 text-green-400",
  rejected: "bg-red-500/10  text-red-400",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status as keyof typeof STATUS_COLORS] ?? "bg-overlay-elevated text-overlay-muted";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 font-mono text-[11px] font-medium capitalize ${cls}`}>
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
    "rounded-md border border-overlay-elevated bg-overlay px-3.5 py-2.5 font-body text-sm text-overlay-foreground outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20 w-full";

  return (
    <Modal open onClose={onClose} maxWidth="max-w-2xl" hideCloseButton>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="font-display text-xl font-semibold text-overlay-foreground">{app.name}</h2>
              <StatusBadge status={app.status} />
            </div>
            <p className="font-body text-sm text-overlay-muted">{app.email}</p>
            <p className="font-mono text-xs text-overlay-muted mt-0.5">
              Applied {new Date(app.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
          <button onClick={onClose} className="text-overlay-muted hover:text-overlay-foreground transition-colors mt-1">
            <X size={18} />
          </button>
        </div>

        {/* Links */}
        <div className="flex gap-3">
          <a href={app.linkedin_url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-overlay-elevated bg-overlay px-3 py-2 font-body text-xs text-overlay-muted hover:text-overlay-foreground hover:bg-overlay-elevated transition-colors">
            <ExternalLink size={13} /> LinkedIn
          </a>
          <a href={app.portfolio_url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-overlay-elevated bg-overlay px-3 py-2 font-body text-xs text-overlay-muted hover:text-overlay-foreground hover:bg-overlay-elevated transition-colors">
            <ExternalLink size={13} /> Portfolio
          </a>
        </div>

        {/* Action message */}
        {actionMsg && (
          <div className={`rounded-md border px-4 py-3 ${actionWarning ? "border-yellow-500/30 bg-yellow-500/5" : "border-overlay-elevated bg-overlay"}`}>
            <p className="font-body text-sm text-overlay-muted">{actionMsg}</p>
          </div>
        )}

        {/* Invite link — shown for approved apps */}
        {inviteLink && (
          <div className="rounded-md border border-overlay-elevated bg-overlay p-4">
            <p className="font-body text-xs font-medium text-overlay-foreground mb-2 flex items-center gap-1.5">
              <Link size={13} /> Invitation Link
            </p>
            <div className="flex items-center gap-2">
              <p className="font-mono text-xs text-overlay-muted bg-overlay-elevated rounded px-3 py-2 flex-1 truncate select-all">
                {inviteLink}
              </p>
              <button
                onClick={copyLink}
                className="flex items-center gap-1.5 rounded-md border border-overlay-elevated px-3 py-2 font-body text-xs text-overlay-muted hover:text-overlay-foreground hover:bg-overlay-elevated transition-colors shrink-0"
              >
                {copied ? <CheckCheck size={13} className="text-green-400" /> : <Copy size={13} />}
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="font-body text-[11px] text-overlay-muted mt-2">
              Share this link with the applicant to let them create their account.
            </p>
          </div>
        )}

        {/* Approve / Reject */}
        {app.status === "pending" && (
          <div className="flex gap-3">
            <button
              onClick={() => handleAction("approve")}
              disabled={!!actionLoading}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-green-600 py-2.5 font-body text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-60"
            >
              {actionLoading === "approve" ? <Spinner className="h-4 w-4" /> : <Check size={15} />}
              Approve &amp; Send Invite
            </button>
            <button
              onClick={() => handleAction("reject")}
              disabled={!!actionLoading}
              className="flex flex-1 items-center justify-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 py-2.5 font-body text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-60"
            >
              {actionLoading === "reject" ? <Spinner className="h-4 w-4" /> : <X size={15} />}
              Reject
            </button>
          </div>
        )}

        {/* Tags */}
        <div>
          <p className="font-body text-xs font-medium text-overlay-foreground mb-2 flex items-center gap-1.5">
            <Tag size={13} /> Internal Tags
          </p>
          <div className="flex flex-wrap gap-2">
            {allTags.map((tag) => {
              const active = selectedTags.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag.id)}
                  className={`rounded-full px-3 py-1 font-body text-xs transition-colors ${
                    active
                      ? "bg-accent text-accent-foreground"
                      : "border border-overlay-elevated bg-overlay text-overlay-muted hover:border-accent/40 hover:text-overlay-foreground"
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
          <p className="font-body text-xs font-medium text-overlay-foreground mb-2 flex items-center gap-1.5">
            <FileText size={13} /> Internal Review Notes
          </p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Private notes — not visible to the applicant…"
            className={`${inputClass} resize-none`}
          />
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center justify-center gap-2 rounded-md bg-overlay-elevated py-2.5 font-body text-sm font-medium text-overlay-foreground transition-colors hover:bg-overlay-elevated/80 disabled:opacity-60"
        >
          {saving && <Spinner className="h-4 w-4" />}
          {saving ? "Saving…" : "Save Notes & Tags"}
        </button>

        {/* History */}
        {history.length > 0 && (
          <div>
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="flex items-center gap-1 font-body text-xs text-overlay-muted hover:text-overlay-foreground transition-colors mb-3"
            >
              <ChevronDown size={14} className={`transition-transform ${showHistory ? "rotate-180" : ""}`} />
              {history.length} previous application{history.length > 1 ? "s" : ""}
            </button>
            {showHistory && (
              <div className="flex flex-col gap-2">
                {history.map((h) => (
                  <div key={h.id} className="rounded-lg border border-overlay-elevated bg-overlay p-3">
                    <div className="flex items-center justify-between mb-2">
                      <StatusBadge status={h.status} />
                      <span className="font-mono text-[11px] text-overlay-muted">
                        {new Date(h.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    </div>
                    <div className="flex gap-2 mb-2">
                      <a href={h.linkedin_url} target="_blank" rel="noopener noreferrer" className="font-body text-xs text-accent hover:text-accent-hover">LinkedIn ↗</a>
                      <span className="text-overlay-muted">·</span>
                      <a href={h.portfolio_url} target="_blank" rel="noopener noreferrer" className="font-body text-xs text-accent hover:text-accent-hover">Portfolio ↗</a>
                    </div>
                    {h.review_notes && (
                      <p className="font-body text-xs text-overlay-muted italic">{h.review_notes}</p>
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
  const [statusFilter, setStatusFilter] = useState("pending");
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [allTags, setAllTags] = useState<TagItem[]>([]);
  const [tagFilter, setTagFilter] = useState("");

  const PAGE_SIZE = 25;

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

  const inputClass =
    "rounded-md border border-overlay-elevated bg-overlay px-3 py-2 font-body text-sm text-overlay-foreground outline-none transition-colors placeholder:text-overlay-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl font-semibold text-overlay-foreground">Applications</h1>
        <span className="font-mono text-sm text-overlay-muted">{total} total</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-overlay-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            className={`${inputClass} pl-9 w-full`}
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={inputClass}
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>

        <select
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className={inputClass}
        >
          <option value="">All tags</option>
          {allTags.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-white/10 bg-overlay-raised overflow-hidden mb-4">
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner className="h-5 w-5 text-overlay-muted" />
          </div>
        ) : applications.length === 0 ? (
          <p className="py-16 text-center font-body text-sm text-overlay-muted">No applications found.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                {["Name", "Email", "Status", "Tags", "Applied", ""].map((h) => (
                  <th key={h} className="px-5 py-3 text-left font-body text-xs font-medium text-overlay-muted uppercase tracking-wider">
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
                  <td className="px-5 py-3.5">
                    <p className="font-body text-sm font-medium text-overlay-foreground">{app.name}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="font-body text-sm text-overlay-muted">{app.email}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge status={app.status} />
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex flex-wrap gap-1">
                      {(app.application_tags ?? []).slice(0, 3).map((at) => (
                        <span key={at.tag_id} className="rounded-full bg-overlay-elevated px-2 py-0.5 font-body text-[11px] text-overlay-muted">
                          {at.tags?.name}
                        </span>
                      ))}
                      {app.application_tags?.length > 3 && (
                        <span className="font-mono text-[11px] text-overlay-muted">+{app.application_tags.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="font-mono text-[11px] text-overlay-muted whitespace-nowrap">
                      {new Date(app.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                  </td>
                  <td className="px-5 py-3.5 text-right">
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
          <p className="font-body text-sm text-overlay-muted">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 rounded-md border border-overlay-elevated px-3 py-1.5 font-body text-sm text-overlay-muted hover:text-overlay-foreground hover:bg-overlay-elevated transition-colors disabled:opacity-40"
            >
              <ChevronLeft size={14} /> Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 rounded-md border border-overlay-elevated px-3 py-1.5 font-body text-sm text-overlay-muted hover:text-overlay-foreground hover:bg-overlay-elevated transition-colors disabled:opacity-40"
            >
              Next <ChevronRight size={14} />
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
            setSelectedApp(null);
          }}
        />
      )}
    </div>
  );
}
