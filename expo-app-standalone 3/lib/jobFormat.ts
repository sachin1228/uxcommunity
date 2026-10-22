/**
 * Jobs — pure types, labels and date rules.
 *
 * Kept free of API/native imports so both the screens and `node --test` can
 * read them. The web mirror is `apps/web/lib/jobs/types.ts` + `format.ts`;
 * every rule here must match that implementation, since both clients read the
 * same posting payloads.
 */

export type JobKind = 'hiring' | 'referral';
export type WorkMode = 'remote' | 'hybrid' | 'onsite';
export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'internship';
export type JobStatus = 'open' | 'closed';
export type ApplicationStatus = 'new' | 'shortlisted' | 'rejected';

export const JOB_KINDS: { value: JobKind; label: string }[] = [
  { value: 'hiring', label: 'Hiring' },
  { value: 'referral', label: 'Referral' },
];

export const WORK_MODES: { value: WorkMode; label: string }[] = [
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'On-site' },
];

export const EMPLOYMENT_TYPES: { value: EmploymentType; label: string }[] = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
  { value: 'internship', label: 'Internship' },
];

export const jobKindLabel = (value: JobKind): string =>
  JOB_KINDS.find((kind) => kind.value === value)?.label ?? value;

export const workModeLabel = (value: WorkMode): string =>
  WORK_MODES.find((mode) => mode.value === value)?.label ?? value;

export const employmentTypeLabel = (value: EmploymentType): string =>
  EMPLOYMENT_TYPES.find((type) => type.value === value)?.label ?? value;

export const applicationStatusLabel = (value: ApplicationStatus): string =>
  value === 'shortlisted' ? 'Shortlisted' : value === 'rejected' ? 'Rejected' : 'New';

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
  posted_label: string;
  updated_label: string | null;
  deadline_label: string | null;
  deadline_expired: boolean;
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
  status: ApplicationStatus;
  applied_label: string;
}

export interface JobApplicantDetail extends JobApplicant {
  role_label: string | null;
  city_name: string | null;
}

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
  company: { id: string; name: string; slug: string; logoUrl: string | null } | null;
}

/** The All-city / All-sector wildcard choice a form holds; the API sends NULL. */
export const ALL_CITIES = 'all';
export const ALL_SECTORS = 'all';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Relative stamp, UTC like the web (`timeAgoLabel`). */
export function timeAgoLabel(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';

  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;

  return `${MONTHS[then.getUTCMonth()]} ${then.getUTCDate()}`;
}

/** "Updated 3d ago" when an edit actually changed something, else null. */
export function editedLabel(createdAt: string, updatedAt: string | null): string | null {
  if (!updatedAt) return null;
  const created = Date.parse(createdAt);
  const updated = Date.parse(updatedAt);
  if (!Number.isFinite(created) || !Number.isFinite(updated)) return null;
  if (updated <= created) return null;
  return `Updated ${timeAgoLabel(updatedAt)}`;
}

/** The closing date's instant: the end of that UTC day; null when blank. */
export function closingInstantFromDate(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const at = Date.parse(`${date}T23:59:59.999Z`);
  if (!Number.isFinite(at)) return null;
  // A rolled-over impossible day (2026-02-31) is not a date the poster typed.
  const instant = new Date(at);
  if (instant.toISOString().slice(0, 10) !== date) return null;
  return instant.toISOString();
}

export function closingDateFromInstant(iso: string): string {
  return iso.slice(0, 10);
}

export type JobDeadline =
  | { kind: 'none' }
  | { kind: 'open'; label: string }
  | { kind: 'expired'; label: string };

export function jobDeadline(
  job: { status: JobStatus; closes_at: string | null },
  now: Date = new Date(),
): JobDeadline {
  if (!job.closes_at) return { kind: 'none' };
  if (job.status === 'closed') return { kind: 'none' };

  const at = Date.parse(job.closes_at);
  if (!Number.isFinite(at)) return { kind: 'none' };

  const day = new Date(at);
  const stamp = `${MONTHS[day.getUTCMonth()]} ${day.getUTCDate()}`;
  return at <= now.getTime()
    ? { kind: 'expired', label: `Expired ${stamp}` }
    : { kind: 'open', label: `Closes ${stamp}` };
}

export function deadlineFields(
  job: { status: JobStatus; closes_at: string | null },
  now: Date = new Date(),
): { deadline_label: string | null; deadline_expired: boolean } {
  const deadline = jobDeadline(job, now);
  return {
    deadline_label: deadline.kind === 'none' ? null : deadline.label,
    deadline_expired: deadline.kind === 'expired',
  };
}

/** "(3-5 years)" inside an experience label, for the card's title row. */
export function experienceYearsLabel(label: string): string {
  const match = label.match(/\(([^)]+)\)\s*$/);
  return match ? `(${match[1]})` : label;
}

/** The dimensions the viewer's profile does not match (All can never mismatch). */
export function criteriaMismatches(job: JobPost, viewer: JobViewer): string[] {
  const mismatches: string[] = [];
  if (job.city_id !== null && viewer.cityId !== job.city_id) mismatches.push('city');
  if (job.sector_id !== null && viewer.sectorId !== job.sector_id) mismatches.push('sector');
  if (viewer.jobTitle !== job.job_title) mismatches.push('job title');
  if (viewer.experienceLevel !== job.experience_level) mismatches.push('experience level');
  return mismatches;
}

/** "city and job title" / "city, sector and job title". */
export function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The dimensions that actually gate a posting (All city/sector do not). */
export function gateDimensions(job: JobPost): string[] {
  return [
    job.city_id ? 'city' : null,
    job.sector_id ? 'sector' : null,
    'job title',
    'experience level',
  ].filter((dimension): dimension is string => Boolean(dimension));
}
