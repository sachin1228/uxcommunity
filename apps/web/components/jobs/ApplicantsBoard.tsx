"use client";

import { ExternalLink, FileText, Globe, Inbox, UserRound, Users } from "lucide-react";
import { BackLink } from "@/components/ui/BackLink";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { CompanyLogo } from "@/components/companies/CompanyBadge";
import { JobStateBadge, KindBadge } from "./JobBadges";
import { useGuardedRouter } from "@/lib/navigation-guard";
import type { JobApplicant, JobPost } from "@/lib/jobs/types";
import { workModeLabel } from "@/lib/jobs/types";
import { experienceYearsLabel } from "@/lib/jobs/format";

/**
 * The poster's applicant list. Every row is an application exactly as it was
 * submitted — name, portfolio, LinkedIn, optional resume — plus a link to the
 * applicant's profile. Reads are gated to the poster by the database, not by
 * this component.
 */
export function ApplicantsBoard({
  job,
  applicants,
}: {
  job: JobPost;
  applicants: JobApplicant[];
}) {
  const router = useGuardedRouter();

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

      <div className="mt-4 flex flex-col gap-2.5">
        {applicants.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-14 text-center">
            <Inbox strokeWidth={2.5} size={28} className="text-foreground-muted opacity-40" />
            <p className="mt-3 font-display text-sm font-semibold text-foreground">
              No applications yet
            </p>
            <p className="mt-1 max-w-xs font-body text-xs text-foreground-muted">
              Members whose profile matches this role can apply — they’ll show up here.
            </p>
          </div>
        ) : (
          applicants.map((applicant) => (
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
                    onClick={() => router.push(`/dashboard/profile/${applicant.applicant_id}`)}
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
                  onClick={() => router.push(`/dashboard/profile/${applicant.applicant_id}`)}
                  className="ml-auto inline-flex items-center gap-1.5 font-medium text-foreground-muted transition-colors hover:text-foreground"
                >
                  <UserRound strokeWidth={2.5} size={12} />
                  Profile
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
