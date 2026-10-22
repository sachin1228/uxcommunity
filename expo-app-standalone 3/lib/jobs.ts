/**
 * Jobs — the mobile data layer mirroring the web jobs model
 * (`apps/web/lib/jobs`).
 *
 * Every rule lives on the server: the posting payloads come from the same
 * database functions the web board reads, every write goes through the same
 * route, and the eligibility lock is decided by `can_apply` (the predicate the
 * write enforces) rather than by anything here. This module shapes the
 * requests and maps the answers; the pure types, labels and date rules live in
 * ./jobFormat and are re-exported so screens have one import.
 */

import { apiFetch, apiFormUpload } from './api';
import type { ProfileIdentityPayload } from './profileIdentity';
import { getOwnProfile, type OwnProfile } from './profile';
import type {
  ApplicationStatus,
  EmploymentType,
  JobApplicantDetail,
  JobKind,
  JobPost,
  JobStatus,
  JobViewer,
  WorkMode,
} from './jobFormat';

export * from './jobFormat';

export interface JobMasterData {
  cities: { id: string; name: string; imageUrl: string | null }[];
  sectors: { id: string; name: string; imageUrl: string | null }[];
  jobTitles: { slug: string; label: string; imageUrl: string | null }[];
  experienceLevels: { slug: string; label: string; imageUrl: string | null }[];
}

// ─── Viewer & master data ───────────────────────────────────────────────────

/** The signed-in member as the jobs surfaces need them. */
export function jobViewerFromProfile(profile: OwnProfile, viewerId: string): JobViewer | null {
  if (!profile.user) return null;

  const company = profile.company;
  return {
    id: viewerId,
    name: profile.user.name ?? 'Member',
    email: profile.user.email ?? '',
    avatarUrl: profile.profile?.avatar_url ?? null,
    cityId: profile.profile?.cities?.id ?? null,
    sectorId: profile.profile?.design_sectors?.id ?? null,
    jobTitle: profile.profile?.job_title ?? null,
    experienceLevel: profile.profile?.experience_level ?? null,
    portfolioUrl: profile.profile?.portfolio_url ?? null,
    linkedinUrl: profile.profile?.linkedin_url ?? null,
    company: company
      ? { id: company.id, name: company.name, slug: company.slug, logoUrl: company.logoUrl }
      : null,
  };
}

export async function loadJobViewer(viewerId: string): Promise<JobViewer | null> {
  const profile = await getOwnProfile();
  return jobViewerFromProfile(profile, viewerId);
}

/** The four criteria option lists — the same master data signup offers. */
export function jobMasterFromIdentity(payload: ProfileIdentityPayload): JobMasterData {
  return {
    cities: payload.options.cities.map((option) => ({
      id: option.id,
      name: option.name,
      imageUrl: option.image_url,
    })),
    sectors: payload.options.sectors.map((option) => ({
      id: option.id,
      name: option.name,
      imageUrl: option.image_url,
    })),
    jobTitles: payload.options.titles.map((option) => ({
      slug: option.id,
      label: option.name,
      imageUrl: option.image_url,
    })),
    experienceLevels: payload.options.levels.map((option) => ({
      slug: option.id,
      label: option.name,
      imageUrl: option.image_url,
    })),
  };
}

export async function loadJobMasterData(): Promise<JobMasterData> {
  const { data } = await apiFetch<ProfileIdentityPayload>('/api/profile/identity');
  return jobMasterFromIdentity(data);
}

// ─── Feed, detail, applicants ───────────────────────────────────────────────

export const JOB_FEED_PAGE_SIZE = 50;

export interface JobFeedPage {
  jobs: JobPost[];
  has_more: boolean;
}

/**
 * Newest-first page of postings. Pass the last row of the previous page as
 * `before` to read the page after it (compound created_at, id cursor).
 */
export async function fetchJobFeed(
  before?: { createdAt: string; id: string },
): Promise<JobFeedPage> {
  const query = before
    ? `?before=${encodeURIComponent(`${before.createdAt}|${before.id}`)}`
    : '';
  const { data } = await apiFetch<{ jobs?: JobPost[]; has_more?: boolean }>(
    `/api/jobs/feed${query}`,
    { method: 'GET' },
  );
  return { jobs: data.jobs ?? [], has_more: Boolean(data.has_more) };
}

export async function fetchJob(jobId: string): Promise<JobPost> {
  const { data } = await apiFetch<{ job?: JobPost }>(`/api/jobs/${jobId}`, { method: 'GET' });
  if (!data.job) throw new Error('This job could not be loaded.');
  return data.job;
}

export async function fetchJobApplicants(
  jobId: string,
): Promise<{ job: JobPost; applicants: JobApplicantDetail[] }> {
  const { data } = await apiFetch<{ job?: JobPost; applicants?: JobApplicantDetail[] }>(
    `/api/jobs/${jobId}/applicants`,
    { method: 'GET' },
  );
  if (!data.job) throw new Error('This job could not be loaded.');
  return { job: data.job, applicants: data.applicants ?? [] };
}

// ─── Writes ─────────────────────────────────────────────────────────────────

export interface JobFormPayload {
  title: string;
  city_id: string | null;
  sector_id: string | null;
  job_title: string;
  experience_level: string;
  work_mode: WorkMode;
  employment_type: EmploymentType;
  salary: string;
  description: string;
  website: string;
  /** 'YYYY-MM-DD', or '' for no deadline. */
  closes_at: string;
}

/** The route's failure code, with the server's own sentence when it has one. */
export function jobErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { data?: unknown } | null)?.data;
  if (data && typeof data === 'object' && typeof (data as { message?: unknown }).message === 'string') {
    return (data as { message: string }).message;
  }
  return fallback;
}

export async function createJob(
  kind: JobKind,
  companyId: string,
  payload: JobFormPayload,
): Promise<string> {
  const { data } = await apiFetch<{ job_id?: string }>('/api/jobs', {
    method: 'POST',
    body: { kind, company_id: companyId, ...payload } as unknown as Record<string, unknown>,
  });
  if (!data.job_id) throw new Error('The job could not be posted. Please try again.');
  return data.job_id;
}

export async function updateJob(
  jobId: string,
  payload: JobFormPayload,
): Promise<{ job_id: string; edited_at: string | null }> {
  const { data } = await apiFetch<{ job_id?: string; edited_at?: string | null }>(
    `/api/jobs/${jobId}/edit`,
    { method: 'POST', body: payload as unknown as Record<string, unknown> },
  );
  if (!data.job_id) throw new Error('The changes could not be saved. Please try again.');
  return { job_id: data.job_id, edited_at: data.edited_at ?? null };
}

export async function setJobStatus(
  jobId: string,
  status: JobStatus,
): Promise<{ job_id: string; status: JobStatus }> {
  const { data } = await apiFetch<{ job_id?: string; status?: JobStatus }>(
    `/api/jobs/${jobId}/status`,
    { method: 'POST', body: { status } },
  );
  if (!data.job_id || !data.status) {
    throw new Error('The job could not be updated.');
  }
  return { job_id: data.job_id, status: data.status };
}

export async function deleteJob(jobId: string): Promise<void> {
  await apiFetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
}

/** A picked document, in the shape React Native's FormData uploads. */
export interface ResumeUpload {
  uri: string;
  name: string;
  mimeType: string | null;
  size: number | null;
}

function appendResumeFile(form: FormData, file: ResumeUpload): void {
  form.append('resume', {
    uri: file.uri,
    type: file.mimeType ?? 'application/octet-stream',
    name: file.name,
  } as unknown as Blob);
}

export interface ApplyParams {
  name: string;
  portfolioUrl: string;
  linkedinUrl: string;
  /** A saved resume's id — the server copies its stored URL; nothing uploads. */
  savedResumeId?: string | null;
  /** A one-off upload (the first upload is adopted into the job profile). */
  resume?: ResumeUpload | null;
}

export async function applyToJob(jobId: string, params: ApplyParams): Promise<string> {
  const form = new FormData();
  form.append('name', params.name);
  form.append('portfolio_url', params.portfolioUrl);
  form.append('linkedin_url', params.linkedinUrl);
  if (params.savedResumeId) form.append('saved_resume_id', params.savedResumeId);
  else if (params.resume) appendResumeFile(form, params.resume);

  const { data } = await apiFormUpload<{ application_id?: string }>(
    `/api/jobs/${jobId}/apply`,
    form,
  );
  if (!data.application_id) {
    throw new Error('Your application could not be sent. Please try again.');
  }
  return data.application_id;
}

export async function setApplicationStatus(
  jobId: string,
  applicationId: string,
  status: ApplicationStatus,
): Promise<ApplicationStatus> {
  const { data } = await apiFetch<{ status?: ApplicationStatus }>(
    `/api/jobs/${jobId}/applications/${applicationId}/status`,
    { method: 'POST', body: { status } },
  );
  if (!data.status) throw new Error('The applicant could not be updated.');
  return data.status;
}

// ─── Saved resumes & job profile ────────────────────────────────────────────

export const MAX_SAVED_RESUMES = 3;
export const RESUME_MAX_BYTES = 5 * 1024 * 1024;
export const RESUME_EXTENSIONS = ['.pdf', '.doc', '.docx', '.rtf'];

export interface SavedResume {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  isDefault: boolean;
  createdAt: string;
}

const RESUME_TYPE_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/rtf': 'RTF',
};

export function resumeTypeLabel(mimeType: string): string {
  return RESUME_TYPE_LABELS[mimeType] ?? mimeType.split('/')[1]?.toUpperCase() ?? 'FILE';
}

/** "240 KB" / "1.2 MB". */
export function formatResumeSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "PDF · 240 KB · 10 Oct" — the meta line under a resume's name. */
export function resumeMeta(resume: Pick<SavedResume, 'mimeType' | 'sizeBytes' | 'createdAt'>): string {
  const date = new Date(resume.createdAt);
  const stamp = Number.isNaN(date.getTime())
    ? ''
    : `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
  return [resumeTypeLabel(resume.mimeType), formatResumeSize(resume.sizeBytes), stamp]
    .filter(Boolean)
    .join(' · ');
}

export async function loadSavedResumes(): Promise<SavedResume[]> {
  const { data } = await apiFetch<{ resumes?: SavedResume[] }>('/api/settings/resumes', {
    method: 'GET',
  });
  return data.resumes ?? [];
}

export async function uploadSavedResume(file: ResumeUpload): Promise<SavedResume[]> {
  const form = new FormData();
  appendResumeFile(form, file);
  const { data } = await apiFormUpload<{ resumes?: SavedResume[] }>(
    '/api/settings/resumes',
    form,
  );
  if (!data.resumes) throw new Error('The resume could not be saved. Please try again.');
  return data.resumes;
}

export async function setDefaultResume(id: string): Promise<SavedResume[]> {
  const { data } = await apiFetch<{ resumes?: SavedResume[] }>('/api/settings/resumes', {
    method: 'PATCH',
    body: { id },
  });
  if (!data.resumes) throw new Error('That change could not be saved. Please try again.');
  return data.resumes;
}

export async function deleteSavedResume(id: string): Promise<SavedResume[]> {
  const { data } = await apiFetch<{ resumes?: SavedResume[] }>(
    `/api/settings/resumes?id=${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
  if (!data.resumes) throw new Error('The resume could not be deleted. Please try again.');
  return data.resumes;
}

/** Save the portfolio link a job application prefills ('' clears it). */
export async function updatePortfolioUrl(url: string): Promise<void> {
  await apiFetch('/api/profile', { method: 'PATCH', body: { portfolio_url: url.trim() } });
}
