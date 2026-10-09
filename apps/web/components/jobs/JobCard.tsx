"use client";

import { Briefcase, CheckCircle2, Users } from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { CompanyLogo } from "@/components/companies/CompanyBadge";
import { KindBadge, LockedNote, MetaChip } from "./JobBadges";
import { useGuardedRouter } from "@/lib/navigation-guard";
import type { JobPost } from "@/lib/jobs/types";
import { employmentTypeLabel, workModeLabel } from "@/lib/jobs/types";

interface JobCardProps {
  job: JobPost;
}

export function JobCard({ job }: JobCardProps) {
  const router = useGuardedRouter();
  const detailHref = `/dashboard/jobs/${job.id}`;

  const open = () => router.push(detailHref);

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
      <CompanyLogo name={job.company.name} logoUrl={job.company.logo_url} size={46} />

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-display text-sm font-semibold text-foreground">
              {job.title}
            </h3>
            <p className="mt-0.5 truncate font-body text-xs text-foreground-muted">
              {job.company.name}
            </p>
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

        {/* The four criteria are the targeting, so the card leads with them. */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <MetaChip>{job.city_name}</MetaChip>
          <MetaChip>{job.sector_name}</MetaChip>
          <MetaChip>{job.job_title_label}</MetaChip>
          <MetaChip>{job.experience_level_label}</MetaChip>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <MetaChip>{workModeLabel(job.work_mode)}</MetaChip>
          <MetaChip>{employmentTypeLabel(job.employment_type)}</MetaChip>
          {job.salary && <MetaChip>{job.salary}</MetaChip>}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 font-body text-[11px] text-foreground-subtle">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <AvatarImg
                url={job.poster.avatar_url}
                name={job.poster.name}
                size={20}
                className="rounded-full object-cover"
              />
              <span className="truncate font-medium text-foreground-muted">
                {job.is_mine ? "Posted by you" : `Posted by ${job.poster.name}`}
              </span>
            </span>
            <span aria-hidden="true">·</span>
            <span>{job.posted_label}</span>
          </div>

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
            <span className="inline-flex items-center gap-1.5 font-body text-[11px] font-medium text-accent">
              <Briefcase strokeWidth={2.5} size={11} />
              You match this role
            </span>
          ) : (
            <LockedNote>Locked for your profile</LockedNote>
          )}
        </div>
      </div>
    </div>
  );
}
