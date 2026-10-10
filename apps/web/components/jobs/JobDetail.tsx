"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, CheckCircle2, Clock, ExternalLink, Globe, Lock, Users } from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { RichText } from "@/components/ui/RichText";
import { CompanyLogo, VerifiedMark } from "@/components/companies/CompanyBadge";
import { ApplyModal } from "./ApplyModal";
import { JobStateBadge, KindBadge, LockedNote, MetaChip } from "./JobBadges";
import { JobOwnerActions } from "./JobOwnerActions";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { experienceYearsLabel } from "@/lib/jobs/format";
import type { JobMasterData } from "@/lib/jobs/service";
import type { JobPost, JobViewer } from "@/lib/jobs/types";
import { criteriaMismatches, listPhrase, workModeLabel } from "@/lib/jobs/types";

/**
 * A posting as the viewer sees it. The Apply action follows `can_apply` — the
 * flag the database computed with the same rule its write enforces — and a
 * locked posting names the profile dimensions that do not match, so the rule
 * never has to be guessed.
 *
 * Rendered both inside the board's detail pane and, standalone, on the
 * posting's own page — the host surface owns layout, so this is content only.
 *
 * `master` is only needed for the owner's own view — the header's menu and
 * the edit form behind it — and is optional for that reason: the board's pane
 * only ever shows other members' roles, so it renders without it.
 *
 * A posting that is not taking applications — the owner closed it, or its
 * closing date passed — says so in place of the Apply action rather than
 * presenting a button that can only fail.
 */
export function JobDetail({
  job,
  viewer,
  master,
}: {
  job: JobPost;
  viewer: JobViewer;
  master?: JobMasterData;
}) {
  const guard = useGuardedRouter();
  const router = useRouter();
  const [applyOpen, setApplyOpen] = useState(false);

  const mismatches = criteriaMismatches(job, viewer);

  return (
    <div className="flex flex-col gap-6">
      {/* Header card */}
      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <CompanyLogo name={job.company.name} logoUrl={job.company.logo_url} size={56} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <h1 className="min-w-0 font-display text-xl font-semibold leading-tight text-foreground">
                {job.title}
                <span className="ml-2 font-body text-sm font-normal text-foreground-muted">
                  {experienceYearsLabel(job.experience_level_label)}
                </span>
              </h1>
              <div className="flex shrink-0 items-center gap-2 pt-1">
                <JobStateBadge job={job} />
                <KindBadge kind={job.kind} />
                {job.is_mine && master && <JobOwnerActions job={job} master={master} />}
              </div>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-body text-sm text-foreground-muted">
              <span className="inline-flex items-center gap-1.5">
                {job.company.name}
                {job.company.domain_verified && <VerifiedMark label={false} size="xs" />}
              </span>
              <span aria-hidden="true" className="text-foreground-subtle">•</span>
              <span>
                {job.city_name} ({workModeLabel(job.work_mode)})
              </span>
              {job.salary && (
                <>
                  <span aria-hidden="true" className="text-foreground-subtle">•</span>
                  <span>{job.salary}</span>
                </>
              )}
            </p>
            {/* The edit stamp rides beside the post time so a reader can tell
                a posting was revised — `updated_label` is null when it never
                was, so this never claims a change that did not happen. */}
            <p className="mt-1.5 font-body text-xs text-foreground-subtle">
              Posted {job.posted_label}
              {job.updated_label ? ` · ${job.updated_label}` : ""}
              {job.deadline_label ? (
                <>
                  {" · "}
                  <span className={job.deadline_expired ? "text-amber-500" : undefined}>
                    {job.deadline_label}
                  </span>
                </>
              ) : null}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
          {job.is_mine ? (
            <button
              type="button"
              onClick={() => guard.push(`/dashboard/jobs/${job.id}/applicants`)}
              className="modal-btn modal-btn-primary"
            >
              <Users strokeWidth={2.5} size={14} />
              View {job.applicant_count} applicant{job.applicant_count === 1 ? "" : "s"}
            </button>
          ) : job.status === "closed" || job.deadline_expired ? (
            // Not taking applications replaces the Apply action entirely:
            // there is nothing to apply to, and a locked-eligibility note would
            // blame the wrong thing. An existing application is still named,
            // because it still exists — neither closing nor a passed deadline
            // is a withdrawal. "Closed" and "expired" stay separate words: one
            // is the owner's decision, the other is the calendar's.
            <div className="flex flex-col gap-1.5">
              <span className="inline-flex items-center gap-1.5 font-body text-sm font-medium text-foreground">
                {job.status === "closed" ? (
                  <Lock strokeWidth={2.5} size={14} className="shrink-0 text-foreground-muted" />
                ) : (
                  <Clock strokeWidth={2.5} size={14} className="shrink-0 text-amber-500" />
                )}
                {job.status === "closed" ? "This posting is closed" : "This posting has expired"}
              </span>
              <p className="font-body text-xs text-foreground-subtle">
                {job.status === "closed"
                  ? "It is no longer accepting applications."
                  : "Its closing date has passed, so it is no longer accepting applications."}
                {appliedSentence(job)}
              </p>
            </div>
          ) : job.applied ? (
            <div className="flex flex-col gap-1.5">
              <span className="inline-flex items-center gap-1.5 font-body text-sm font-medium text-foreground">
                <CheckCircle2 strokeWidth={2.5} size={15} className="text-emerald-500" />
                Application submitted
                {job.my_application?.applied_label ? ` · ${job.my_application.applied_label}` : ""}
              </span>
              {job.my_application && (
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 font-body text-xs text-foreground-muted">
                  <a
                    href={job.my_application.portfolio_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-accent hover:underline"
                  >
                    <Globe strokeWidth={2.5} size={11} />
                    Portfolio
                  </a>
                  <a
                    href={job.my_application.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-accent hover:underline"
                  >
                    <ExternalLink strokeWidth={2.5} size={11} />
                    LinkedIn
                  </a>
                  {job.my_application.resume_url && (
                    <a
                      href={job.my_application.resume_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-accent hover:underline"
                    >
                      <Briefcase strokeWidth={2.5} size={11} />
                      Resume
                    </a>
                  )}
                </span>
              )}
            </div>
          ) : job.can_apply ? (
            <>
              <button
                type="button"
                onClick={() => setApplyOpen(true)}
                className="modal-btn modal-btn-primary"
              >
                Apply now
              </button>
              <span className="font-body text-xs text-foreground-subtle">
                Your profile matches this role.
              </span>
            </>
          ) : (
            <div className="flex flex-col gap-1">
              <LockedNote>Apply is locked for your profile</LockedNote>
              <p className="font-body text-xs text-foreground-subtle">
                Only members whose city, sector, job title and experience level match the posting
                can apply.
                {mismatches.length > 0 ? ` Your profile differs in ${listPhrase(mismatches)}.` : ""}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Poster */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="font-display text-sm font-semibold text-foreground">
          {job.kind === "referral" ? "Referred by" : "Posted by"}
        </h2>
        <a
          href={`/dashboard/profile/${job.poster.id}`}
          className="group mt-3 flex items-center gap-2.5"
        >
          <AvatarImg
            url={job.poster.avatar_url}
            name={job.poster.name}
            size={36}
            className="rounded-full object-cover"
          />
          <span className="min-w-0">
            <span className="block truncate font-body text-sm font-medium text-foreground group-hover:underline">
              {job.is_mine ? "You" : job.poster.name}
            </span>
            <span className="block truncate font-body text-[11px] text-foreground-muted">
              {[
                job.poster.job_title_label,
                job.poster.company_name ? `@ ${job.poster.company_name}` : null,
              ]
                .filter(Boolean)
                .join(" ") || "Member"}
            </span>
          </span>
        </a>
      </div>

      <Section title="About the role">
        <RichText html={job.description} />
      </Section>

      {job.responsibilities.length > 0 && (
        <Section title="What you'll do">
          <ul className="flex flex-col gap-2">
            {job.responsibilities.map((item) => (
              <li
                key={item}
                className="flex gap-2.5 font-body text-sm leading-relaxed text-foreground-muted"
              >
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-foreground-subtle" />
                {item}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {job.requirements.length > 0 && (
        <Section title="What we're looking for">
          <ul className="flex flex-col gap-2">
            {job.requirements.map((item) => (
              <li
                key={item}
                className="flex gap-2.5 font-body text-sm leading-relaxed text-foreground-muted"
              >
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-foreground-subtle" />
                {item}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {job.skills.length > 0 && (
        <Section title="Skills">
          <div className="flex flex-wrap gap-1.5">
            {job.skills.map((skill) => (
              <MetaChip key={skill}>{skill}</MetaChip>
            ))}
          </div>
        </Section>
      )}

      <Section title={`About ${job.company.name}`}>
        <a
          href={`/dashboard/companies/${job.company.slug}`}
          className="inline-flex items-center gap-1.5 font-body text-sm font-medium text-accent hover:underline"
        >
          <CompanyLogo name={job.company.name} logoUrl={job.company.logo_url} size={16} />
          View {job.company.name} on uxcommunity
        </a>
        {job.website && (
          <a
            href={job.website}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex items-center gap-1.5 font-body text-xs font-medium text-accent hover:underline"
          >
            <Globe strokeWidth={2.5} size={12} />
            {job.website.replace(/^https?:\/\//, "")}
          </a>
        )}
      </Section>

      {!job.is_mine && !job.applied && job.can_apply && (
        <ApplyModal
          open={applyOpen}
          onClose={() => setApplyOpen(false)}
          job={job}
          viewer={viewer}
          onApplied={() => router.refresh()}
        />
      )}
    </div>
  );
}

/** One line telling an applicant their application still stands. */
function appliedSentence(job: JobPost): string {
  if (!job.applied) return "";
  const when = job.my_application?.applied_label;
  return ` Your application was submitted${when ? ` ${when}` : ""}.`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2.5 font-display text-base font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}
