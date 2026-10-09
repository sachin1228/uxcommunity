"use client";

import { ExternalLink, FileText, Globe, Inbox, UserRound } from "lucide-react";
import { BackLink } from "@/components/ui/BackLink";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { CompanyLogo } from "@/components/companies/CompanyBadge";
import { MetaChip } from "./JobBadges";
import { useGuardedRouter } from "@/lib/navigation-guard";
import type { JobApplicant, JobPost } from "@/lib/jobs/types";

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

      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-border bg-surface p-5">
        <CompanyLogo name={job.company.name} logoUrl={job.company.logo_url} size={40} />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-lg font-semibold leading-tight text-foreground">
            {applicants.length} applicant{applicants.length === 1 ? "" : "s"}
          </h1>
          <p className="mt-0.5 truncate font-body text-sm text-foreground-muted">
            {job.title}
            <span className="mx-1.5 text-foreground-subtle">·</span>
            {job.company.name}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <MetaChip>{job.city_name}</MetaChip>
            <MetaChip>{job.job_title_label}</MetaChip>
            <MetaChip>{job.experience_level_label}</MetaChip>
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
