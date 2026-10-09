"use client";

import { CheckCircle2, Users } from "lucide-react";
import { CompanyLogo } from "@/components/companies/CompanyBadge";
import { JobStateBadge, KindBadge, LockedNote } from "./JobBadges";
import { JobOwnerActions } from "./JobOwnerActions";
import type { JobMasterData } from "@/lib/jobs/service";
import type { JobPost } from "@/lib/jobs/types";
import { workModeLabel } from "@/lib/jobs/types";
import { experienceYearsLabel } from "@/lib/jobs/format";

interface JobCardProps {
  job: JobPost;
  selected?: boolean;
  onSelect: () => void;
  /**
   * Only needed by the owner's menu (its edit form picks from the criteria
   * master data). A caller without it still renders the card, minus the menu.
   */
  master?: JobMasterData;
  /**
   * Whether this card's actions should be shown at all. The browse list shows
   * other members' roles, so their cards never carry any.
   */
  showOwnerActions?: boolean;
}

/**
 * The LinkedIn shape: the title leads, one line carries company · city (work
 * mode) · salary, and the time sits under it. Selecting is local to the board
 * — the pane beside the list renders the card's own payload, so a click is a
 * client-side switch, not a route change. The four targeting criteria live on
 * the detail pane — the card keeps the scan cheap.
 *
 * A closed posting is marked here rather than hidden: it stays in "My posts"
 * for its owner (the feed returns it to nobody else), where the badge is what
 * explains why it no longer appears to anyone browsing.
 *
 * On the owner's own list the card also carries the posting's controls, so a
 * role can be closed or deleted from the scan. That cluster is its own click
 * and key target — it contains its events, because the card around it is one
 * big button and selecting a posting must not fire when the menu is used.
 */
export function JobCard({
  job,
  selected = false,
  onSelect,
  master,
  showOwnerActions = false,
}: JobCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`group flex cursor-pointer items-start gap-3 rounded-xl border bg-surface p-3.5 transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
        selected ? "border-accent/60" : "border-border"
      }`}
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
            <JobStateBadge job={job} />
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

          {showOwnerActions && job.is_mine ? (
            <span className="inline-flex items-center gap-2">
              <span className="inline-flex items-center gap-1 font-body text-[11px] font-medium text-foreground-muted">
                <Users strokeWidth={2.5} size={11} />
                {job.applicant_count} applicant{job.applicant_count === 1 ? "" : "s"}
              </span>
              {/* The same controls the posting's own page carries, so a role can
                  be closed or removed without opening it. */}
              <JobOwnerActions
                job={job}
                master={master}
                variant="compact"
                redirectOnDelete={false}
              />
            </span>
          ) : job.is_mine ? (
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
