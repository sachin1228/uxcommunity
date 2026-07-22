"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { ApplicationStatusBadge } from "@/components/admin/applications/ApplicationStatusBadge";
import { ApplicationDetailModal } from "@/components/admin/applications/ApplicationDetailModal";
import {
  STATUS_TABS,
  type Application,
  type StatusFilter,
  type TagItem,
} from "@/components/admin/applications/types";

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
  const [counts, setCounts] = useState<Record<StatusFilter, number>>({
    all: 0, pending: 0, approved: 0, rejected: 0,
  });

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
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-muted pointer-events-none"
          />
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
          <p className="py-12 text-center font-body text-xs text-foreground-muted">
            No applications found.
          </p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                {["Name", "Email", "Status", "Tags", "Applied", ""].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2.5 text-left font-body text-[10px] font-medium text-foreground-muted uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {applications.map((app, idx) => (
                <tr
                  key={app.id}
                  className={`${
                    idx < applications.length - 1 ? "border-b border-white/[0.06]" : ""
                  } hover:bg-white/[0.03] transition-colors cursor-pointer`}
                  onClick={() => setSelectedApp(app)}
                >
                  <td className="px-4 py-2.5">
                    <p className="font-body text-xs font-medium text-foreground">{app.name}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="font-body text-xs text-foreground-muted">{app.email}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <ApplicationStatusBadge status={app.status} />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {(app.application_tags ?? []).slice(0, 3).map((at) => (
                        <span
                          key={at.tag_id}
                          className="rounded-full bg-surface-raised px-1.5 py-0.5 font-body text-[10px] text-foreground-muted"
                        >
                          {at.tags?.name}
                        </span>
                      ))}
                      {app.application_tags?.length > 3 && (
                        <span className="font-mono text-[10px] text-foreground-muted">
                          +{app.application_tags.length - 3}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="font-mono text-[10px] text-foreground-muted whitespace-nowrap">
                      {new Date(app.created_at).toLocaleDateString("en-GB", {
                        day: "numeric", month: "short", year: "numeric",
                      })}
                    </p>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="font-body text-xs text-accent hover:text-accent-hover">
                      View →
                    </span>
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
        <ApplicationDetailModal
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
