"use client";

import { RichTextEditor } from "@/components/ui/RichTextEditor";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { SelectField } from "@/components/ui/SelectField";
import { closingDateFromInstant } from "@/lib/jobs/format";
import { trimRichText } from "@/lib/jobs/rich-text";
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

/**
 * The wildcard choice in the two criteria pickers that accept one: "All
 * cities" / "All sectors" stores NULL — the dimension then matches every
 * member. Job title and experience level have no wildcard; they are always
 * exact matches.
 */
export const ALL_CITIES = "all";
export const ALL_SECTORS = "all";

export interface JobFormValues {
  title: string;
  /** A city id, ALL_CITIES for All cities, or "" while unchosen. */
  cityId: string;
  /** A sector id, ALL_SECTORS for All sectors, or "" while unchosen. */
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
    // NULL is the All wildcard; the picker shows it as a chosen option.
    cityId: job.city_id ?? ALL_CITIES,
    sectorId: job.sector_id ?? ALL_SECTORS,
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
      <JobIdentityFields values={values} onChange={onChange} master={master} />
      <JobCriteriaFields
        values={values}
        onChange={onChange}
        master={master}
        criteriaLocked={criteriaLocked}
      />
      <JobTermFields values={values} onChange={onChange} />
    </>
  );
}

/** What every group below takes from its host. */
interface JobFieldProps {
  values: JobFormValues;
  onChange: (patch: Partial<JobFormValues>) => void;
  master: JobMasterData;
}

/**
 * The role itself: what it is called, what it says, and how it is worked.
 *
 * The three groups this form is built from are separate exports so a host can
 * give each its own card — the post page does — while the edit modal draws them
 * as one run of fields. The fields themselves are shared either way, which is
 * what keeps the two surfaces from drifting apart.
 */
export function JobIdentityFields({ values, onChange, master }: JobFieldProps) {
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

      {/* The description is the one field that is not a form control: it is
          rich, so it holds its own formatting and takes no label association.
          It sits directly under the title — a poster names the role, then says
          what it is, before the criteria that decide who may apply. */}
      <div className="flex flex-col gap-1.5">
        <span className={jobFieldLabel}>
          About the role <span className="text-red-400">*</span>
        </span>
        <RichTextEditor
          id="job-description"
          ariaLabel="About the role"
          value={values.description}
          onChange={(description) => onChange({ description })}
          placeholder="What the team does, why this role exists, how you work…"
        />
      </div>

      {/* Arrangement — how the role is worked, right beside the description
          that says what it is. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={jobFieldLabel}>Work mode</span>
          <SelectField
            value={values.workMode}
            onChange={(workMode) => onChange({ workMode })}
            options={WORK_MODES}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={jobFieldLabel}>Employment type</span>
          <SelectField
            value={values.employmentType}
            onChange={(employmentType) => onChange({ employmentType })}
            options={EMPLOYMENT_TYPES}
          />
        </label>
      </div>
    </>
  );
}

/**
 * The four criteria the eligibility rule compares. City and sector accept
 * an All wildcard — the posting then matches every member on that
 * dimension; job title and experience level have no wildcard.
 */
export function JobCriteriaFields({
  values,
  onChange,
  master,
  criteriaLocked = false,
}: JobFieldProps & { criteriaLocked?: boolean }) {
  return (
    <>
      {/* Criteria — the four dimensions that gate applying */}
      <div className="flex flex-col gap-1.5">
        <span className={jobFieldLabel}>
          Who can apply <span className="text-red-400">*</span>
        </span>
        <p className="-mt-1 font-body text-[11px] text-foreground-subtle">
          {criteriaLocked
            ? "Locked — members have applied, and these criteria decide who could. Reopen them by posting a new role."
            : "Members must match the job title and experience level; the city and sector match too unless they are set to All."}
        </p>
        <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SearchableSelect
            options={[
              { value: ALL_CITIES, label: "All cities" },
              ...master.cities.map((c) => ({ value: c.id, label: c.name, imageUrl: c.imageUrl })),
            ]}
            value={values.cityId}
            onChange={(cityId) => onChange({ cityId })}
            placeholder="City"
            disabled={criteriaLocked}
          />
          <SearchableSelect
            options={[
              { value: ALL_SECTORS, label: "All sectors" },
              ...master.sectors.map((s) => ({ value: s.id, label: s.name, imageUrl: s.imageUrl })),
            ]}
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
    </>
  );
}

/** How the offer is paid, where to read more, and when it stops. */
export function JobTermFields({
  values,
  onChange,
}: {
  values: JobFormValues;
  onChange: (patch: Partial<JobFormValues>) => void;
}) {
  return (
    <>
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
    // The All choice travels as NULL — the database's wildcard.
    city_id: values.cityId === ALL_CITIES ? null : values.cityId,
    sector_id: values.sectorId === ALL_SECTORS ? null : values.sectorId,
    job_title: values.jobTitle,
    experience_level: values.experienceLevel,
    work_mode: values.workMode,
    employment_type: values.employmentType,
    salary: values.salary.trim(),
    // The canonical subset, trimmed of the blank edges an editor leaves behind.
    // The route sanitises again on the server; this only saves it the work.
    description: trimRichText(values.description),
    website: values.website.trim(),
    closes_at: values.closesAt.trim(),
  };
}
