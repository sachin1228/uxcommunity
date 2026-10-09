"use client";

import { CheckCircle2, Users } from "lucide-react";
import { CompanyLogo } from "@/components/companies/CompanyBadge";
import { KindBadge, LockedNote } from "./JobBadges";
import { useGuardedRouter } from "@/lib/navigation-guard";
import type { JobPost } from "@/lib/jobs/types";
import { workModeLabel } from "@/lib/jobs/types";
import { experienceYearsLabel } from "@/lib/jobs/format";

interface JobCardProps {
  job: JobPost;
}

/**
 * The LinkedIn shape: the title leads, one line carries company · city (work
 * mode) · salary, and the time sits under it. The four targeting criteria
 * live on the detail page — the card keeps the scan cheap.
 */
export function JobCard({ job }: JobCardProps) {
  const guard = useGuardedRouter();
  const detailHref = `/dashboard/jobs/${job.id}`;

  const open = () => guard.push(detailHref);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
      className="group flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface p-3.5 transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      <CompanyLogo name={job.company.name} logoUrl={job.company.logo_url} size={40} />

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <h3 className="truncate font-display text-[15px] font-semibold leading-snug text-accent">
              {job.title}
            </h3>
            <span className="shrink-0 font-body text-xs text-foreground-muted">
              {experienceYearsLabel(job.experience_level_label)}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <KindBadge kind={job.kind} />
            {job.is_mine && (
              <span className="rounded-full border border-accent/40 px-2 py-0.5 font-body text-[10px] font-semibold text-accent">
                Your post
              </span>
            )}
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
          <span className="font-body text-xs text-foreground-subtle">{job.posted_label}</span>

          {job.is_mine ? (
            <span className="inline-flex items-center gap-1 font-body text-[11px] font-medium text-foreground-muted">
              <Users strokeWidth={2.5} size={11} />
              {job.applicant_count} applicant{job.applicant_count === 1 ? "" : "s"}
            </span>
          ) : job.applied ? (
            <span className="inline-flex items-center gap-1.5 font-body text-[11px] font-medium text-emerald-500">
              <CheckCircle2 strokeWidth={2.5} size={12} />
              Applied
            </span>
          ) : job.can_apply ? (
            <span className="font-body text-[11px] font-medium text-accent">You match this role</span>
          ) : (
            <LockedNote>Locked for your profile</LockedNote>
          )}
        </div>
      </div>
    </div>
  );
}
