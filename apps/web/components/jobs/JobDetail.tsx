"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, ExternalLink, FileText, Globe, Lock, Users } from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { Modal } from "@/components/ui/Modal";
import { RichText } from "@/components/ui/RichText";
import { CompanyLogo, VerifiedMark } from "@/components/companies/CompanyBadge";
import { ApplyModal } from "./ApplyModal";
import { JobStateBadge, KindBadge, LockedNote, MetaChip } from "./JobBadges";
import { JobOwnerActions } from "./JobOwnerActions";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { experienceYearsLabel } from "@/lib/jobs/format";
import type { JobMasterData } from "@/lib/jobs/service";
import type { JobApplicationSummary, JobPost, JobViewer } from "@/lib/jobs/types";
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
 *
 * An applied-to posting also carries an Application status card between the
 * posting and its poster: the submission's state and time, with the form it
 * carried reopened in full behind View application.
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
  const [applicationOpen, setApplicationOpen] = useState(false);

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

        {/* Actions — once the member has applied to an open posting there is
            nothing left to act on: the status card above carries the
            application in full. */}
        {!(job.applied && job.status === "open" && !job.deadline_expired) && (
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
              // there is nothing to apply to, and a locked-eligibility note
              // would blame the wrong thing. An existing application is still
              // named, because it still exists — neither closing nor a passed
              // deadline is a withdrawal. "Closed" and "expired" stay separate
              // words: one is the owner's decision, the other the calendar's.
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
                  Only members whose city, sector, job title and experience level match the
                  posting can apply.
                  {mismatches.length > 0 ? ` Your profile differs in ${listPhrase(mismatches)}.` : ""}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Application status — the member's own application as its own card
          between the posting and its poster (LinkedIn's shape): the state,
          when it went, and the full submitted form behind View application. */}
      {job.applied && job.my_application && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h2 className="font-display text-sm font-semibold text-foreground">Application status</h2>
          <div className="mt-3 flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
            />
            <div className="min-w-0">
              <p className="font-body text-sm font-medium text-foreground">Application submitted</p>
              <p className="mt-0.5 font-body text-xs text-foreground-subtle">
                {job.my_application.applied_label}
              </p>
              <button
                type="button"
                onClick={() => setApplicationOpen(true)}
                className="mt-1.5 font-body text-xs font-medium text-accent hover:underline"
              >
                View application
              </button>
            </div>
          </div>
        </div>
      )}

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

      {job.applied && job.my_application && (
        <ApplicationModal
          open={applicationOpen}
          onClose={() => setApplicationOpen(false)}
          job={job}
          viewer={viewer}
          application={job.my_application}
        />
      )}
    </div>
  );
}

/**
 * The application exactly as it was submitted, reopened from the status
 * card: every field the form carried, with the links live so the member can
 * check what the poster will read.
 */
function ApplicationModal({
  open,
  onClose,
  job,
  viewer,
  application,
}: {
  open: boolean;
  onClose: () => void;
  job: JobPost;
  viewer: JobViewer;
  application: JobApplicationSummary;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Your application" maxWidth="max-w-md">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-background p-3">
          <AvatarImg
            url={viewer.avatarUrl}
            name={viewer.name}
            size={40}
            className="rounded-full object-cover"
          />
          <div className="min-w-0">
            <p className="truncate font-body text-sm font-semibold text-foreground">{job.title}</p>
            <p className="truncate font-body text-xs text-foreground-muted">
              {job.company.name}
              <span className="mx-1.5 text-foreground-subtle">·</span>
              {job.city_name}
            </p>
          </div>
        </div>

        <dl className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <dt className="font-body text-xs font-medium text-foreground-muted">Full name</dt>
            <dd className="font-body text-sm text-foreground">{application.name}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="font-body text-xs font-medium text-foreground-muted">Portfolio</dt>
            <dd className="min-w-0">
              <a
                href={application.portfolio_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full items-center gap-1.5 font-body text-sm font-medium text-accent hover:underline"
              >
                <Globe strokeWidth={2.5} size={12} className="shrink-0" />
                <span className="truncate">
                  {application.portfolio_url.replace(/^https?:\/\//, "")}
                </span>
              </a>
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="font-body text-xs font-medium text-foreground-muted">LinkedIn</dt>
            <dd className="min-w-0">
              <a
                href={application.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full items-center gap-1.5 font-body text-sm font-medium text-accent hover:underline"
              >
                <ExternalLink strokeWidth={2.5} size={12} className="shrink-0" />
                <span className="truncate">
                  {application.linkedin_url.replace(/^https?:\/\//, "")}
                </span>
              </a>
            </dd>
          </div>
          {application.resume_url && (
            <div className="flex flex-col gap-0.5">
              <dt className="font-body text-xs font-medium text-foreground-muted">Resume</dt>
              <dd>
                <a
                  href={application.resume_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-body text-sm font-medium text-accent hover:underline"
                >
                  <FileText strokeWidth={2.5} size={12} />
                  View resume
                </a>
              </dd>
            </div>
          )}
        </dl>

        <div className="flex justify-end pt-1">
          <button type="button" onClick={onClose} className="modal-btn modal-btn-secondary">
            Close
          </button>
        </div>
      </div>
    </Modal>
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
