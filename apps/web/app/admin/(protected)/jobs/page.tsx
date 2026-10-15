"use client";

// The jobs moderation queue: one row per posting — the poster, the company,
// the targeting criteria, the applicant count and the lifecycle badge — so an
// admin can spot and remove fake or spam postings. Filters (status, search)
// ride the query string to /api/admin/jobs.
//
// Rows expand in place to the full description and facts; Delete is the one
// action and it names its consequences first (the applications cascade).

import { Fragment, useCallback, useEffect, useState } from "react";
import {
  Briefcase,
  ChevronDown,
  ChevronRight,
  Search,
  Trash2,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { ModalPortal } from "@/components/ui/Modal";
import { ModalError } from "@/components/ui/ModalError";
import { KindBadge, ClosedBadge, ExpiredBadge } from "@/components/jobs/JobBadges";
import {
  employmentTypeLabel,
  workModeLabel,
  type EmploymentType,
  type JobKind,
  type WorkMode,
} from "@/lib/jobs/types";

type JobState = "open" | "closed" | "expired";
type StatusFilter = JobState | "all";

interface AdminJobRow {
  id: string;
  title: string;
  kind: JobKind;
  status: "open" | "closed";
  state: JobState;
  created_at: string;
  updated_at: string | null;
  closes_at: string | null;
  description: string;
  salary: string | null;
  website: string | null;
  work_mode: WorkMode;
  employment_type: EmploymentType;
  city_name: string | null;
  sector_name: string | null;
  job_title_label: string;
  experience_level_label: string;
  applicant_count: number;
  poster: { id: string; name: string | null; email: string | null } | null;
  company: { id: string; name: string; slug: string; logo_url: string | null } | null;
}

const STATUS_TABS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "expired", label: "Expired" },
];

const PAGE_SIZE = 25;

/** The open state has no shared badge (member surfaces show nothing) — here it
 *  earns one so every row's lifecycle is readable at a glance. */
function OpenBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-body text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
      Open
    </span>
  );
}

function StateBadge({ state }: { state: JobState }) {
  if (state === "closed") return <ClosedBadge />;
  if (state === "expired") return <ExpiredBadge />;
  return <OpenBadge />;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminJobsPage() {
  const [jobs, setJobs] = useState<AdminJobRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [counts, setCounts] = useState<Record<StatusFilter, number>>({
    all: 0,
    open: 0,
    closed: 0,
    expired: 0,
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmJob, setConfirmJob] = useState<AdminJobRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
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

  const fetchJobs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), status: statusFilter });
      if (search) params.set("search", search);
      const res = await fetch(`/api/admin/jobs?${params}`);
      const data = await res.json();
      setJobs(data.jobs ?? []);
      setTotal(data.total ?? 0);
      const next = data.counts ?? { open: 0, closed: 0, expired: 0 };
      setCounts({
        open: next.open ?? 0,
        closed: next.closed ?? 0,
        expired: next.expired ?? 0,
        all: (next.open ?? 0) + (next.closed ?? 0) + (next.expired ?? 0),
      });
    } catch {
      // ignore — the table keeps its last good page
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchJobs();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchJobs]);

  async function handleDelete() {
    if (!confirmJob) return;
    setDeleteLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/jobs/${confirmJob.id}`, { method: "DELETE" });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setActionError(payload?.error ?? "Failed to delete the job.");
        return;
      }
      setConfirmJob(null);
      await fetchJobs();
    } catch {
      setActionError("Failed to delete the job.");
    } finally {
      setDeleteLoading(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">Jobs</h1>
          <p className="mt-0.5 font-body text-xs text-foreground-muted">
            {counts.open} open role{counts.open === 1 ? "" : "s"} posted by members
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
            placeholder="Search title, company or poster…"
            className="w-full rounded-md border border-border bg-surface py-1.5 pr-2.5 pl-8 font-body text-xs text-foreground placeholder:text-foreground-subtle focus:border-accent focus:outline-none"
          />
        </div>
        {search && (
          <button
            onClick={() => {
              setLoading(true);
              setSearchInput("");
              setSearch("");
              setPage(1);
            }}
            className="rounded-md px-2 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            Clear search
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
        ) : jobs.length === 0 ? (
          <div className="py-12 text-center">
            <Briefcase strokeWidth={2.5} size={20} className="mx-auto mb-2 text-foreground-muted opacity-50" />
            <p className="font-body text-xs text-foreground-muted">
              {statusFilter === "all" && !search ? "No jobs posted yet." : "Nothing here."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem]">
              <thead>
                <tr className="border-b border-border">
                  {["Job", "Posted by", "Criteria", "Applicants", "Posted", "Status", ""].map((heading) => (
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
                {jobs.map((job, index) => {
                  const expanded = expandedId === job.id;
                  return (
                    <Fragment key={job.id}>
                      <tr
                        className={`${index < jobs.length - 1 || expanded ? "border-b border-border-subtle" : ""} align-top transition-colors hover:bg-surface-raised`}
                      >
                        <td className="max-w-[18rem] px-4 py-3">
                          <p className="font-body text-xs font-medium text-foreground">
                            {job.title}
                          </p>
                          <p className="mt-0.5 flex items-center gap-2 font-body text-[11px] text-foreground-muted">
                            <KindBadge kind={job.kind} />
                            <span className="truncate">{job.company?.name ?? "Unknown company"}</span>
                          </p>
                        </td>
                        <td className="max-w-[14rem] px-4 py-3">
                          <p className="font-body text-xs text-foreground-muted">
                            {job.poster?.name ?? "Unknown member"}
                          </p>
                          <p className="truncate font-body text-[11px] text-foreground-subtle">
                            {job.poster?.email ?? ""}
                          </p>
                        </td>
                        <td className="max-w-[16rem] px-4 py-3">
                          <p className="font-body text-xs text-foreground-muted">
                            {job.job_title_label} · {job.experience_level_label}
                          </p>
                          <p className="font-body text-[11px] text-foreground-subtle">
                            {job.city_name ?? "Unknown city"} · {job.sector_name ?? "Unknown sector"}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-[10px] text-foreground-muted">
                            {job.applicant_count}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <p className="font-mono text-[10px] text-foreground-muted">
                            {formatDateTime(job.created_at)}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <StateBadge state={job.state} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col items-end gap-1.5">
                            <button
                              onClick={() => setExpandedId(expanded ? null : job.id)}
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 font-body text-xs text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                            >
                              {expanded ? (
                                <ChevronDown strokeWidth={2.5} size={12} />
                              ) : (
                                <ChevronRight strokeWidth={2.5} size={12} />
                              )}
                              {expanded ? "Close" : "Open"}
                            </button>
                            <button
                              onClick={() => {
                                setActionError(null);
                                setConfirmJob(job);
                              }}
                              className="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 px-2.5 py-1 font-body text-xs text-red-400 transition-colors hover:bg-red-500/10"
                            >
                              <Trash2 strokeWidth={2.5} size={12} />
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className={index < jobs.length - 1 ? "border-b border-border-subtle" : ""}>
                          <td colSpan={7} className="bg-background/40 px-4 py-3">
                            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                              <div>
                                <p className="font-body text-[10px] font-medium uppercase tracking-wider text-foreground-muted">
                                  Role description
                                </p>
                                <p className="mt-1.5 whitespace-pre-wrap font-body text-xs leading-5 text-foreground">
                                  {job.description}
                                </p>
                              </div>
                              <div>
                                <p className="font-body text-[10px] font-medium uppercase tracking-wider text-foreground-muted">
                                  Posting facts
                                </p>
                                <dl className="mt-1.5 space-y-1">
                                  {[
                                    ["Company", job.company?.name ?? "Unknown"],
                                    ["Work mode", workModeLabel(job.work_mode)],
                                    ["Employment", employmentTypeLabel(job.employment_type)],
                                    ["Salary", job.salary ?? "Not disclosed"],
                                    ["Closes", job.closes_at ? formatDateTime(job.closes_at) : "No deadline"],
                                    ["Last edited", job.updated_at ? formatDateTime(job.updated_at) : "Never"],
                                  ].map(([label, value]) => (
                                    <div key={label} className="flex items-baseline gap-2">
                                      <dt className="w-24 shrink-0 font-body text-[11px] text-foreground-subtle">
                                        {label}
                                      </dt>
                                      <dd className="font-body text-xs text-foreground">{value}</dd>
                                    </div>
                                  ))}
                                  {job.website && (
                                    <div className="flex items-baseline gap-2">
                                      <dt className="w-24 shrink-0 font-body text-[11px] text-foreground-subtle">
                                        Website
                                      </dt>
                                      <dd className="min-w-0">
                                        <a
                                          href={job.website}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="block truncate font-body text-xs text-accent hover:underline"
                                        >
                                          {job.website}
                                        </a>
                                      </dd>
                                    </div>
                                  )}
                                </dl>
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

      {/* Delete confirm modal */}
      {confirmJob && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
            <div className="modal-panel w-full max-w-sm p-6">
              <h2 className="font-display text-base font-semibold text-foreground mb-1">
                Delete &ldquo;{confirmJob.title}&rdquo;?
              </h2>
              <p className="font-body text-xs text-foreground-muted mb-5">
                This will permanently remove the posting
                {confirmJob.applicant_count > 0 && (
                  <>
                    {" "}and its{" "}
                    <span className="text-foreground font-medium">
                      {confirmJob.applicant_count} application
                      {confirmJob.applicant_count === 1 ? "" : "s"}
                    </span>
                  </>
                )}
                . Use this for fake or spam postings. Cannot be undone.
              </p>
              {actionError && <ModalError className="mb-4">{actionError}</ModalError>}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setConfirmJob(null);
                    setActionError(null);
                  }}
                  className="modal-btn modal-btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleDelete()}
                  disabled={deleteLoading}
                  className="modal-btn modal-btn-danger flex-1"
                >
                  {deleteLoading ? <Spinner className="h-3 w-3" /> : <Trash2 strokeWidth={2.5} size={12} />}
                  Yes, delete
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}
