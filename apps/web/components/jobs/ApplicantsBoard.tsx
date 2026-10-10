"use client";

import { useState } from "react";
import {
  ArrowRight,
  Check,
  ExternalLink,
  FileText,
  Globe,
  Inbox,
  Sparkles,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { BackLink } from "@/components/ui/BackLink";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { Spinner } from "@/components/ui/Spinner";
import { CompanyLogo } from "@/components/companies/CompanyBadge";
import { DesignModeViewer } from "./DesignModeViewer";
import { JobStateBadge, KindBadge } from "./JobBadges";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { useApplicantDecision } from "@/lib/jobs/use-applicant-decision";
import type { ApplicationStatus, JobApplicantDetail, JobPost } from "@/lib/jobs/types";
import { applicationStatusLabel, workModeLabel } from "@/lib/jobs/types";
import { experienceYearsLabel } from "@/lib/jobs/format";

type TriageTab = "all" | ApplicationStatus;

const TRIAGE_TABS: { value: TriageTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "shortlisted", label: "Shortlisted" },
  { value: "rejected", label: "Rejected" },
];

/**
 * The poster's applicant list, as a triage board. Every row is an application
 * exactly as it was submitted — name, portfolio, LinkedIn, optional resume —
 * plus a link to the applicant's profile, and the decision cluster that moves
 * them between New, Shortlisted and Rejected.
 *
 * Every decision is the same write in every direction, so nothing here asks
 * for a confirmation: a rejection is a standing decision, not a deletion, and
 * each change offers its own undo in the toast. The tabs count that same
 * standing — they are not routes, and switching one never moves a card out of
 * view by anything but the decision itself.
 *
 * Between the posting and the list sits the design-mode card: it opens the
 * same applications as a full-screen, light-mode portfolio view
 * (`DesignModeViewer`) — the snapshot it opens with is the tab's visible
 * list, so browsing starts where the poster was looking.
 *
 * Reads and writes are gated to the poster by the database, not by this
 * component.
 */
export function ApplicantsBoard({
  job,
  applicants,
}: {
  job: JobPost;
  applicants: JobApplicantDetail[];
}) {
  const guard = useGuardedRouter();
  const { decide, pendingId, error } = useApplicantDecision(job.id);
  const [tab, setTab] = useState<TriageTab>("all");
  // The viewer's applicant list, captured when it opens: a decision made
  // inside it must never yank the current applicant out from under the
  // poster, so the viewer does not re-read the filtered list on refresh.
  const [designList, setDesignList] = useState<JobApplicantDetail[] | null>(null);

  const countFor = (value: TriageTab): number =>
    value === "all" ? applicants.length : applicants.filter((a) => a.status === value).length;
  const visible = tab === "all" ? applicants : applicants.filter((a) => a.status === tab);

  function openDesignMode() {
    setDesignList(visible.length > 0 ? visible : applicants);
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 lg:px-6">
      <BackLink
        href={`/dashboard/jobs/${job.id}`}
        label={job.title}
        className="inline-flex items-center gap-1.5 font-body text-sm text-foreground-muted transition-colors hover:text-foreground"
      />

      {/* The posting card mirrors the JobCard shape — title + years, kind on
          the right, company line, posted time and count — so the same job
          reads identically on the board and on its applicants page. */}
      <div className="mt-4 flex items-start gap-3 rounded-xl border border-border bg-surface p-3.5">
        <CompanyLogo name={job.company.name} logoUrl={job.company.logo_url} size={40} />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <h1 className="truncate font-display text-[15px] font-semibold leading-snug text-accent">
                {job.title}
              </h1>
              <span className="shrink-0 font-body text-xs text-foreground-muted">
                {experienceYearsLabel(job.experience_level_label)}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <JobStateBadge job={job} />
              <KindBadge kind={job.kind} />
            </div>
          </div>

          <p className="mt-0.5 truncate font-body text-[13px] text-foreground-muted">
            {job.company.name}
            <span className="mx-1.5 text-foreground-subtle">•</span>
            {job.city_name} ({workModeLabel(job.work_mode)})
            {job.salary && (
              <>
                <span className="mx-1.5 text-foreground-subtle">•</span>
                {job.salary}
              </>
            )}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="font-body text-xs text-foreground-subtle">
              {job.posted_label}
              {job.updated_label ? ` · ${job.updated_label}` : ""}
              {job.deadline_label ? (
                <>
                  {" · "}
                  <span className={job.deadline_expired ? "text-amber-500" : undefined}>
                    {job.deadline_label}
                  </span>
                </>
              ) : null}
            </span>
            <span className="inline-flex items-center gap-1 font-body text-[11px] font-medium text-foreground-muted">
              <Users strokeWidth={2.5} size={11} />
              {applicants.length} applicant{applicants.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      </div>

      {/* Design mode — the applications as a light-mode portfolio page. The
          card sits between the posting and the list; the whole card is the
          affordance, with the button shape marking where it goes. */}
      {applicants.length > 0 && (
        <button
          type="button"
          onClick={openDesignMode}
          className="mt-4 flex w-full cursor-pointer items-center gap-3.5 rounded-xl border border-border bg-surface p-3.5 text-left transition-colors hover:border-accent/20 hover:bg-surface-raised"
        >
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"
          >
            <Sparkles strokeWidth={2.25} size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-body text-sm font-semibold text-foreground">
              View application in design mode
            </span>
            <span className="mt-0.5 block font-body text-xs leading-relaxed text-foreground-muted">
              Read {applicants.length === 1 ? "the application" : "the applications"} as a
              light-mode portfolio page — sidebar, links and decisions, one applicant at a time.
            </span>
          </span>
          <span
            aria-hidden="true"
            className="modal-btn modal-btn-primary pointer-events-none shrink-0"
          >
            Open
            <ArrowRight strokeWidth={2.5} size={14} />
          </span>
        </button>
      )}

      {/* Triage tabs — the board's own tab style (count chip, accent
          underline); a decision moves a card between tabs, never out of the
          list. */}
      {applicants.length > 0 && (
        <div className="mt-4 flex items-center gap-0.5 border-b border-border">
          {TRIAGE_TABS.map((item) => {
            const active = tab === item.value;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setTab(item.value)}
                className={`-mb-px border-b-2 px-3.5 py-2 font-body text-xs font-medium transition-colors ${
                  active
                    ? "border-accent text-accent"
                    : "border-transparent text-foreground-muted hover:text-foreground"
                }`}
              >
                {item.label}
                <span
                  className={`ml-1.5 rounded-full px-1.5 py-0.5 font-mono text-[10px] ${
                    active ? "bg-accent/15 text-accent" : "bg-surface-raised text-foreground-muted"
                  }`}
                >
                  {countFor(item.value)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2.5">
        {visible.length === 0 ? (
          tab === "all" ? (
            <EmptyList
              title="No applications yet"
              body="Members whose profile matches this role can apply — they’ll show up here."
            />
          ) : tab === "new" ? (
            <EmptyList
              title="No new applicants"
              body="You’ve reviewed everyone — shortlisted and rejected applicants live in their tabs."
            />
          ) : tab === "shortlisted" ? (
            <EmptyList
              title="No shortlisted applicants yet"
              body="Shortlist the ones you want to follow up with."
            />
          ) : (
            <EmptyList
              title="No rejected applicants"
              body="Applicants you pass on will collect here."
            />
          )
        ) : (
          visible.map((applicant) => (
            <div
              key={applicant.id}
              className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3.5"
            >
              <div className="flex items-center gap-3">
                <AvatarImg
                  url={applicant.avatar_url}
                  name={applicant.name}
                  size={40}
                  className="rounded-full object-cover"
                />
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => guard.push(`/dashboard/profile/${applicant.applicant_id}`)}
                    className="block max-w-full truncate text-left font-body text-sm font-semibold text-foreground hover:text-accent"
                  >
                    {applicant.name}
                  </button>
                  <p className="mt-0.5 font-body text-[11px] text-foreground-subtle">
                    Applied {applicant.applied_label}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3 font-body text-xs">
                <a
                  href={applicant.portfolio_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline"
                >
                  <Globe strokeWidth={2.5} size={12} />
                  Portfolio
                </a>
                <a
                  href={applicant.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline"
                >
                  <ExternalLink strokeWidth={2.5} size={12} />
                  LinkedIn
                </a>
                {applicant.resume_url && (
                  <a
                    href={applicant.resume_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline"
                  >
                    <FileText strokeWidth={2.5} size={12} />
                    Resume
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => guard.push(`/dashboard/profile/${applicant.applicant_id}`)}
                  className="inline-flex items-center gap-1.5 font-medium text-foreground-muted transition-colors hover:text-foreground"
                >
                  <UserRound strokeWidth={2.5} size={12} />
                  Profile
                </button>

                <span className="ml-auto flex items-center gap-2">
                  {pendingId === applicant.id ? (
                    <Spinner size={14} />
                  ) : (
                    <TriageCluster
                      status={applicant.status}
                      onChange={(status) => void decide(applicant, status)}
                    />
                  )}
                </span>

                {error?.id === applicant.id && (
                  <span role="status" className="font-body text-xs text-red-400">
                    {error.message}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {designList && (
        <DesignModeViewer
          job={job}
          applicants={designList}
          onClose={() => setDesignList(null)}
        />
      )}
    </div>
  );
}

/**
 * The decision cluster: the standing, as a segmented pair. The active
 * decision is filled and clicking it moves the applicant back to New (the
 * title says so); the other decision stays one click away for a change of
 * mind. A new applicant gets the two decisions as plain actions.
 */
function TriageCluster({
  status,
  onChange,
}: {
  status: ApplicationStatus;
  onChange: (status: ApplicationStatus) => void;
}) {
  if (status !== "new") {
    const other: ApplicationStatus = status === "shortlisted" ? "rejected" : "shortlisted";
    const decidedClass =
      status === "shortlisted"
        ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25"
        : "border-red-500/40 bg-red-500/15 text-red-400 hover:bg-red-500/25";
    const otherClass =
      other === "shortlisted"
        ? "border-emerald-500/30 text-emerald-500/80 hover:bg-emerald-500/10 hover:text-emerald-500"
        : "border-red-500/30 text-red-400/80 hover:bg-red-500/10 hover:text-red-400";

    return (
      <>
        <button
          type="button"
          aria-pressed="true"
          title="Move back to New"
          onClick={() => onChange("new")}
          className={`inline-flex h-7 items-center gap-1 rounded-md border px-2.5 font-body text-[11px] font-medium transition-colors ${decidedClass}`}
        >
          {status === "shortlisted" ? (
            <Check strokeWidth={2.5} size={12} />
          ) : (
            <X strokeWidth={2.5} size={12} />
          )}
          {applicationStatusLabel(status)}
        </button>
        <button
          type="button"
          onClick={() => onChange(other)}
          className={`inline-flex h-7 items-center gap-1 rounded-md border bg-transparent px-2.5 font-body text-[11px] font-medium transition-colors ${otherClass}`}
        >
          {other === "shortlisted" ? (
            <Check strokeWidth={2.5} size={12} />
          ) : (
            <X strokeWidth={2.5} size={12} />
          )}
          {applicationStatusLabel(other)}
        </button>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => onChange("shortlisted")}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-emerald-500/40 px-2.5 font-body text-[11px] font-medium text-emerald-500 transition-colors hover:bg-emerald-500/10"
      >
        <Check strokeWidth={2.5} size={12} />
        Shortlist
      </button>
      <button
        type="button"
        onClick={() => onChange("rejected")}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-red-500/40 px-2.5 font-body text-[11px] font-medium text-red-400 transition-colors hover:bg-red-500/10"
      >
        <X strokeWidth={2.5} size={12} />
        Reject
      </button>
    </>
  );
}

function EmptyList({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-14 text-center">
      <Inbox strokeWidth={2.5} size={28} className="text-foreground-muted opacity-40" />
      <p className="mt-3 font-display text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-xs font-body text-xs text-foreground-muted">{body}</p>
    </div>
  );
}
