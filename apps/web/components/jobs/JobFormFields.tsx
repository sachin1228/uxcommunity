"use client";

import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { closingDateFromInstant } from "@/lib/jobs/format";
import type { JobMasterData } from "@/lib/jobs/service";
import type { EmploymentType, JobPost, WorkMode } from "@/lib/jobs/types";
import { EMPLOYMENT_TYPES, WORK_MODES } from "@/lib/jobs/types";

/**
 * The role fields — everything about a posting except its type and company.
 *
 * One implementation serves both surfaces so posting and editing can never
 * drift: the same inputs, the same order, the same copy. The two callers differ
 * only in what they wrap around it — the post form adds the type cards and the
 * company block, the edit form adds nothing — and in whether the four
 * targeting fields are locked.
 */

export const jobFieldLabel = "font-body text-xs font-medium text-foreground";

export interface JobFormValues {
  title: string;
  cityId: string;
  sectorId: string;
  jobTitle: string;
  experienceLevel: string;
  workMode: WorkMode;
  employmentType: EmploymentType;
  salary: string;
  description: string;
  website: string;
  /** A plain date, "" for no deadline — exactly what a date input holds. */
  closesAt: string;
}

export const EMPTY_JOB_FORM: JobFormValues = {
  title: "",
  cityId: "",
  sectorId: "",
  jobTitle: "",
  experienceLevel: "",
  workMode: "hybrid",
  employmentType: "full_time",
  salary: "",
  description: "",
  website: "",
  closesAt: "",
};

/** A stored posting, as the edit form opens on it. */
export function jobFormValuesFrom(job: JobPost): JobFormValues {
  return {
    title: job.title,
    cityId: job.city_id,
    sectorId: job.sector_id,
    jobTitle: job.job_title,
    experienceLevel: job.experience_level,
    workMode: job.work_mode,
    employmentType: job.employment_type,
    salary: job.salary ?? "",
    description: job.description,
    website: job.website ?? "",
    closesAt: job.closes_at ? closingDateFromInstant(job.closes_at) : "",
  };
}

export function JobFormFields({
  values,
  onChange,
  master,
  criteriaLocked = false,
}: {
  values: JobFormValues;
  onChange: (patch: Partial<JobFormValues>) => void;
  master: JobMasterData;
  /**
   * True once an application exists: the four dimensions the eligibility rule
   * compares are frozen, so the fields are disabled and say why. The rule
   * itself lives in `update_job_post`; this only reflects it.
   */
  criteriaLocked?: boolean;
}) {
  return (
    <>
      {/* Role */}
      <div className="flex flex-col gap-1.5">
        <span className={jobFieldLabel}>
          Role title <span className="text-red-400">*</span>
        </span>
        <input
          type="text"
          value={values.title}
          onChange={(event) => onChange({ title: event.target.value })}
          placeholder="e.g. Senior Product Designer — Payments"
          maxLength={140}
          className="field"
        />
      </div>

      {/* Criteria — the four dimensions that gate applying */}
      <div className="flex flex-col gap-1.5">
        <span className={jobFieldLabel}>
          Who can apply <span className="text-red-400">*</span>
        </span>
        <p className="-mt-1 font-body text-[11px] text-foreground-subtle">
          {criteriaLocked
            ? "Locked — members have applied, and these four dimensions decide who could. Reopen them by posting a new role."
            : "Only members whose profile matches all four dimensions can apply."}
        </p>
        <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SearchableSelect
            options={master.cities.map((c) => ({ value: c.id, label: c.name, imageUrl: c.imageUrl }))}
            value={values.cityId}
            onChange={(cityId) => onChange({ cityId })}
            placeholder="City"
            disabled={criteriaLocked}
          />
          <SearchableSelect
            options={master.sectors.map((s) => ({ value: s.id, label: s.name, imageUrl: s.imageUrl }))}
            value={values.sectorId}
            onChange={(sectorId) => onChange({ sectorId })}
            placeholder="Industry sector"
            disabled={criteriaLocked}
          />
          <SearchableSelect
            options={master.jobTitles.map((j) => ({ value: j.slug, label: j.label, imageUrl: j.imageUrl }))}
            value={values.jobTitle}
            onChange={(jobTitle) => onChange({ jobTitle })}
            placeholder="Job title"
            disabled={criteriaLocked}
          />
          <SearchableSelect
            options={master.experienceLevels.map((l) => ({ value: l.slug, label: l.label, imageUrl: l.imageUrl }))}
            value={values.experienceLevel}
            onChange={(experienceLevel) => onChange({ experienceLevel })}
            placeholder="Experience level"
            disabled={criteriaLocked}
          />
        </div>
      </div>

      {/* Arrangement */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={jobFieldLabel}>Work mode</span>
          <select
            value={values.workMode}
            onChange={(event) => onChange({ workMode: event.target.value as WorkMode })}
            className="field"
          >
            {WORK_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={jobFieldLabel}>Employment type</span>
          <select
            value={values.employmentType}
            onChange={(event) => onChange({ employmentType: event.target.value as EmploymentType })}
            className="field"
          >
            {EMPLOYMENT_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={jobFieldLabel}>
          Salary <span className="text-foreground-subtle">(optional)</span>
        </span>
        <input
          type="text"
          value={values.salary}
          onChange={(event) => onChange({ salary: event.target.value })}
          placeholder="e.g. ₹18–24L / year — leave empty for “Not disclosed”"
          maxLength={80}
          className="field"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={jobFieldLabel}>
          About the role <span className="text-red-400">*</span>
        </span>
        <textarea
          value={values.description}
          onChange={(event) => onChange({ description: event.target.value })}
          rows={4}
          placeholder="What the team does, why this role exists, how you work…"
          className="field resize-none"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={jobFieldLabel}>
          Website <span className="text-foreground-subtle">(optional)</span>
        </span>
        <input
          type="url"
          value={values.website}
          onChange={(event) => onChange({ website: event.target.value })}
          placeholder="https://…"
          className="field"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={jobFieldLabel}>
          Closing date <span className="text-foreground-subtle">(optional)</span>
        </span>
        <input
          type="date"
          value={values.closesAt}
          onChange={(event) => onChange({ closesAt: event.target.value })}
          className="field"
        />
        <span className="font-body text-[11px] text-foreground-subtle">
          Applications stop at the end of this day. Leave it empty to keep the role open until you
          close it, or set a new date to reopen an expired one.
        </span>
      </label>
    </>
  );
}

/** The shape both routes send for the shared fields. */
export function jobFormPayload(values: JobFormValues) {
  return {
    title: values.title.trim(),
    city_id: values.cityId,
    sector_id: values.sectorId,
    job_title: values.jobTitle,
    experience_level: values.experienceLevel,
    work_mode: values.workMode,
    employment_type: values.employmentType,
    salary: values.salary.trim(),
    description: values.description.trim(),
    website: values.website.trim(),
    closes_at: values.closesAt.trim(),
  };
}
