/**
 * Jobs — the platform-free half: payload types (mirrors of
 * `apps/web/lib/jobs/types.ts`), the four board tabs' membership rules, the
 * client-side search, and the apply-form validation.
 *
 * Nothing here imports React Native or the API client, so the rules run under
 * `tsx --test` on CI (see jobs.test.ts). The REST calls live in jobsApi.ts.
 * All `*_label` fields (posted_label, deadline_label, …) are computed by the
 * server and carried in the payload — never re-derived here from a live clock.
 */

// ---------------------------------------------------------------------------
// Types (field-for-field with the web payload)
// ---------------------------------------------------------------------------

export type JobKind = "hiring" | "referral";
export type WorkMode = "remote" | "hybrid" | "onsite";
export type EmploymentType = "full_time" | "part_time" | "contract" | "internship";
export type JobStatus = "open" | "closed";

export const JOB_KINDS: ReadonlyArray<{ value: JobKind; label: string }> = [
  { value: "hiring", label: "Hiring" },
  { value: "referral", label: "Referral" },
];

export const WORK_MODES: ReadonlyArray<{ value: WorkMode; label: string }> = [
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "onsite", label: "On-site" },
];

export const EMPLOYMENT_TYPES: ReadonlyArray<{ value: EmploymentType; label: string }> = [
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
  company_name: string | null;
}

export interface JobApplicationSummary {
  id: string;
  name: string;
  portfolio_url: string;
  linkedin_url: string;
  resume_url: string | null;
  created_at: string;
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
  city_id: string | null;
  city_name: string;
  sector_id: string | null;
  sector_name: string;
  job_title: string;
  job_title_label: string;
  experience_level: string;
  experience_level_label: string;
  created_at: string;
  status: JobStatus;
  updated_at: string | null;
  closes_at: string | null;
  company: JobCompany;
  poster: JobPoster;
  applicant_count: number;
  criteria_locked: boolean;
  applied: boolean;
  is_mine: boolean;
  can_apply: boolean;
  my_application: JobApplicationSummary | null;
  /** Server-rendered relative labels — never recomputed client-side. */
  posted_label: string;
  updated_label: string | null;
  deadline_label: string | null;
  deadline_expired: boolean;
}

/** One saved resume, exactly as `/api/settings/resumes` returns it. */
export interface SavedResume {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  isDefault: boolean;
  createdAt: string;
}

/** Page size of the jobs board — mirrors the server's JOB_FEED_PAGE_SIZE. */
export const JOB_FEED_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Board tabs — the web JobsBrowser predicates over the loaded pages
// ---------------------------------------------------------------------------

export type JobsTab = "hiring" | "referral" | "applied" | "my-posts";

export const JOBS_TABS: ReadonlyArray<{ key: JobsTab; label: string }> = [
  { key: "hiring", label: "Hiring" },
  { key: "referral", label: "Referral" },
  { key: "applied", label: "Applied" },
  { key: "my-posts", label: "My posts" },
];

/**
 * Splits the loaded pages into the four tabs, exactly as the web board does:
 *
 * - Browse tabs (Hiring / Referral) show only roles the viewer could apply to
 *   (`can_apply` — the same predicate the DB write enforces); a role the
 *   profile does not match never appears there.
 * - Own posts live only under My posts; applied-to roles leave the browse
 *   tabs and appear under Applied.
 */
export function splitJobsByTab(jobs: readonly JobPost[]): {
  hiring: JobPost[];
  referral: JobPost[];
  applied: JobPost[];
  myPosts: JobPost[];
} {
  const hiring: JobPost[] = [];
  const referral: JobPost[] = [];
  const applied: JobPost[] = [];
  const myPosts: JobPost[] = [];

  for (const job of jobs) {
    if (job.is_mine) {
      myPosts.push(job);
      continue;
    }
    if (job.applied) {
      applied.push(job);
      continue;
    }
    if (!job.can_apply) continue;
    if (job.kind === "hiring") hiring.push(job);
    else referral.push(job);
  }

  return { hiring, referral, applied, myPosts };
}

/**
 * Client-side search over a browse tab — matches title, company name and
 * skills case-insensitively, like the web board's search box. Applied /
 * My posts have no search there and none here; the caller only offers it on
 * the two browse tabs.
 */
export function searchJobs(jobs: readonly JobPost[], query: string): JobPost[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...jobs];
  return jobs.filter(
    (job) =>
      job.title.toLowerCase().includes(needle) ||
      job.company.name.toLowerCase().includes(needle) ||
      job.skills.some((skill) => skill.toLowerCase().includes(needle)),
  );
}

/** "Mid-level Designers (3-5 years)" → "(3-5 years)" — beside the role title. */
export function experienceYearsLabel(label: string): string {
  const match = label.match(/\(([^)]+)\)\s*$/);
  return match ? `(${match[1]})` : label;
}

/**
 * The signed-in member's side of the eligibility rule — thin mirror of the
 * web `JobViewer` for the lock copy. `can_apply` on the payload stays the
 * authority; these fields only name the gating dimensions.
 */
export interface JobViewerFacts {
  cityId: string | null;
  sectorId: string | null;
  jobTitle: string | null;
  experienceLevel: string | null;
}

/** Human-readable names of the criteria the viewer's profile does not match. */
export function criteriaMismatches(job: JobPost, viewer: JobViewerFacts): string[] {
  const mismatches: string[] = [];
  // An All dimension (NULL) is open to everyone and can never mismatch.
  if (job.city_id !== null && viewer.cityId !== job.city_id) mismatches.push('city');
  if (job.sector_id !== null && viewer.sectorId !== job.sector_id) mismatches.push('sector');
  if (viewer.jobTitle !== job.job_title) mismatches.push('job title');
  if (viewer.experienceLevel !== job.experience_level) mismatches.push('experience level');
  return mismatches;
}

/** "city and job title" / "city, sector and job title" — for lock copy. */
export function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const RICH_TEXT_BREAKS =
  /<\/(p|div|h[1-6]|li|ul|ol|blockquote|tr|table)>|<br\s*\/?>|<\/(td|th)>/gi;

/** Basic entities the sanitiser can leave behind. */
const RICH_TEXT_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

/**
 * The job description is stored as sanitised rich-text HTML (the web renders
 * it with its own RichText component). React Native has no HTML renderer, so
 * the detail screen shows the same content as plain text: block boundaries
 * become newlines, list items become "- " lines, entities decode.
 */
export function richTextToPlain(html: string): string {
  let text = html.replace(RICH_TEXT_BREAKS, '\n');
  text = text.replace(/<li[^>]*>/gi, '- ');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/&#(\d+);/g, (_, code: string) =>
    String.fromCharCode(Number(code)),
  );
  text = text.replace(/&[a-z]+;|&#\d+;/gi, (entity) => RICH_TEXT_ENTITIES[entity.toLowerCase()] ?? entity);
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n');
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The feed visibility rule the server applies, mirrored so `loadMore` can
 * stop asking: the feed only returns open roles plus the viewer's own.
 * Kept for documentation/tests — the client never filters rows by this.
 */
export function jobIsVisible(job: Pick<JobPost, "status" | "closes_at" | "is_mine">): boolean {
  if (job.is_mine) return true;
  if (job.status !== "open") return false;
  if (!job.closes_at) return true;
  return Date.parse(job.closes_at) > Date.now();
}

// ---------------------------------------------------------------------------
// Apply-form validation (mirrors apps/web/lib/jobs/validation.ts)
// ---------------------------------------------------------------------------

const HTTP_URL_RE = /^https?:\/\//;

function isValidHttpUrl(value: string): boolean {
  if (!HTTP_URL_RE.test(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export interface ApplyFormInput {
  name: string;
  portfolioUrl: string;
  linkedinUrl: string;
}

/** Field → error message, empty when the input passes the server's rules. */
export function validateApplyForm(input: ApplyFormInput): Partial<Record<keyof ApplyFormInput, string>> {
  const errors: Partial<Record<keyof ApplyFormInput, string>> = {};

  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) {
    errors.name = "Enter your full name (2-120 characters).";
  }

  const portfolio = input.portfolioUrl.trim();
  if (!isValidHttpUrl(portfolio)) {
    errors.portfolioUrl = "Enter a full URL starting with http:// or https://.";
  }

  const linkedin = input.linkedinUrl.trim();
  if (!isValidHttpUrl(linkedin) || !linkedin.includes("linkedin.com")) {
    errors.linkedinUrl = "Enter your LinkedIn profile URL (linkedin.com).";
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Apply failure copy (mirrors the web route's MESSAGE_FOR_FAILURE)
// ---------------------------------------------------------------------------

export const APPLY_FAILURE_MESSAGES: Record<string, string> = {
  job_not_found: "This job no longer exists.",
  own_job: "You posted this job.",
  job_closed: "This posting is closed — it is no longer accepting applications.",
  job_expired: "This posting's closing date has passed — it is no longer accepting applications.",
  not_eligible:
    "This job is only open to members whose city, sector, job title and experience level match the posting.",
  already_applied: "You have already applied to this job.",
  not_installed: "Jobs are not available right now.",
  resume_required: "Attach a resume to apply.",
  invalid_resume_url: "That saved resume is no longer available. Attach a new one.",
  invalid_name: "Enter your full name (2-120 characters).",
  invalid_portfolio_url: "Enter a full portfolio URL starting with http:// or https://.",
  invalid_linkedin_url: "Enter your LinkedIn profile URL (linkedin.com).",
  resume_too_large: "Resumes must be 5 MB or smaller.",
  resume_bad_type: "Attach a PDF, DOC, DOCX or RTF resume.",
  resume_missing: "Attach a resume to apply.",
};

/** The friendliest copy for an apply failure, given the server's error code. */
export function applyFailureMessage(code: unknown, fallback: string): string {
  if (typeof code === "string" && APPLY_FAILURE_MESSAGES[code]) {
    return APPLY_FAILURE_MESSAGES[code];
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Resume-file rules (mirrors apps/web/lib/jobs/resume-file.ts)
// ---------------------------------------------------------------------------

export const RESUME_MAX_BYTES = 5 * 1024 * 1024;

export const RESUME_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/rtf",
] as const;

/** The client-side pre-check before uploading; the server re-verifies magic bytes. */
export function resumeFileIssue(mimeType: string | null | undefined, sizeBytes: number | null): string | null {
  if (sizeBytes !== null && sizeBytes > RESUME_MAX_BYTES) return "resume_too_large";
  if (mimeType && !(RESUME_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return "resume_bad_type";
  }
  return null;
}
