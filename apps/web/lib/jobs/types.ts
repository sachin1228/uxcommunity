/**
 * Jobs — shared types for the posting payloads returned by the database
 * functions in supabase/migrations/20261009120000_jobs.sql.
 *
 * The payload keys mirror the jsonb the SQL builds (snake_case), the same
 * convention the feed functions use elsewhere: the shapes exist once, in the
 * database, and the components read them directly.
 */

export type JobKind = "hiring" | "referral";
export type WorkMode = "remote" | "hybrid" | "onsite";
export type EmploymentType = "full_time" | "part_time" | "contract" | "internship";

export const JOB_KINDS: { value: JobKind; label: string }[] = [
  { value: "hiring", label: "Hiring" },
  { value: "referral", label: "Referral" },
];

export const WORK_MODES: { value: WorkMode; label: string }[] = [
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "onsite", label: "On-site" },
];

export const EMPLOYMENT_TYPES: { value: EmploymentType; label: string }[] = [
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "contract", label: "Contract" },
  { value: "internship", label: "Internship" },
];

export const jobKindLabel = (value: JobKind): string =>
  JOB_KINDS.find((kind) => kind.value === value)?.label ?? value;

export const workModeLabel = (value: WorkMode): string =>
  WORK_MODES.find((mode) => mode.value === value)?.label ?? value;

export const employmentTypeLabel = (value: EmploymentType): string =>
  EMPLOYMENT_TYPES.find((type) => type.value === value)?.label ?? value;

export interface JobCompany {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  domain: string | null;
  domain_verified: boolean;
}

export interface JobPoster {
  id: string;
  name: string;
  avatar_url: string | null;
  job_title: string | null;
  job_title_label: string | null;
  experience_level: string | null;
  experience_level_label: string | null;
  /** The company on the poster's profile; null when they display none. */
  company_name: string | null;
}

export interface JobApplicationSummary {
  id: string;
  name: string;
  portfolio_url: string;
  linkedin_url: string;
  resume_url: string | null;
  created_at: string;
  /** Added server-side by the detail page (`timeAgoLabel`). */
  applied_label?: string;
}

/** One posting as `job_post_payload` renders it for one viewer. */
export interface JobPost {
  id: string;
  kind: JobKind;
  title: string;
  description: string;
  responsibilities: string[];
  requirements: string[];
  skills: string[];
  salary: string | null;
  website: string | null;
  work_mode: WorkMode;
  employment_type: EmploymentType;
  city_id: string;
  city_name: string;
  sector_id: string;
  sector_name: string;
  job_title: string;
  job_title_label: string;
  experience_level: string;
  experience_level_label: string;
  created_at: string;
  company: JobCompany;
  poster: JobPoster;
  applicant_count: number;
  applied: boolean;
  is_mine: boolean;
  /** Authority for the Apply lock — computed by the same rule the write enforces. */
  can_apply: boolean;
  my_application: JobApplicationSummary | null;
  /** Server-rendered relative label (`timeAgoLabel`), so SSR and hydration match. */
  posted_label: string;
}

export interface JobApplicant {
  id: string;
  applicant_id: string;
  name: string;
  portfolio_url: string;
  linkedin_url: string;
  resume_url: string | null;
  created_at: string;
  avatar_url: string | null;
  /** Server-rendered relative label (`timeAgoLabel`). */
  applied_label: string;
}

/**
 * The signed-in member's side of the eligibility rule. `cityId` / `sectorId` /
 * `jobTitle` / `experienceLevel` are what the apply gate compares against a
 * posting; components use them only to name the dimensions that do not match
 * (`can_apply` remains the authority).
 */
export interface JobViewer {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  cityId: string | null;
  sectorId: string | null;
  jobTitle: string | null;
  experienceLevel: string | null;
  portfolioUrl: string | null;
  linkedinUrl: string | null;
  /** The company verified on the profile, if any — the referral path's company. */
  company: { id: string; name: string; slug: string; logoUrl: string | null } | null;
}

/** Human-readable names of the criteria the viewer's profile does not match. */
export function criteriaMismatches(job: JobPost, viewer: JobViewer): string[] {
  const mismatches: string[] = [];
  if (viewer.cityId !== job.city_id) mismatches.push("city");
  if (viewer.sectorId !== job.sector_id) mismatches.push("sector");
  if (viewer.jobTitle !== job.job_title) mismatches.push("job title");
  if (viewer.experienceLevel !== job.experience_level) mismatches.push("experience level");
  return mismatches;
}

/** "city and job title" / "city, sector and job title" — for lock copy. */
export function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
