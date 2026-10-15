/**
 * Jobs REST calls — the same endpoints the web board uses, through the
 * session-cookie client. The feed and the single-job read return the exact
 * `job_post_payload` rows (with server-rendered labels); the detail endpoint
 * is `GET /api/jobs/[id]`, added for the mobile app (the web page reads the
 * same RPC server-side).
 */

import { apiFetch, apiFormUpload } from './api';
import {
  applyFailureMessage,
  type JobPost,
  type SavedResume,
} from './jobs';

export interface JobFeedPage {
  jobs: JobPost[];
  hasMore: boolean;
}

/**
 * Newest-first page of the board. Pass the last loaded row's cursor to read
 * the page after it — `created_at|id`, read back exactly as the payload
 * carried it (the server validates and rejects a mangled cursor with 400).
 */
export async function getJobFeed(
  before?: { createdAt: string; id: string },
): Promise<JobFeedPage> {
  const query = before
    ? `?before=${encodeURIComponent(`${before.createdAt}|${before.id}`)}`
    : '';
  const { data } = await apiFetch<{ jobs?: JobPost[]; has_more?: boolean }>(
    `/api/jobs/feed${query}`,
  );
  return { jobs: data?.jobs ?? [], hasMore: Boolean(data?.has_more) };
}

/** One posting with the viewer's flags; throws with `.status = 404` when gone. */
export async function getJobDetail(jobId: string): Promise<JobPost> {
  const { data } = await apiFetch<{ job?: JobPost }>(`/api/jobs/${jobId}`);
  if (!data?.job) {
    const error = new Error('This job no longer exists.') as Error & { status: number };
    error.status = 404;
    throw error;
  }
  return data.job;
}

export interface ResumeFile {
  uri: string;
  name: string;
  mimeType: string;
}

export interface ApplyInput {
  name: string;
  portfolioUrl: string;
  linkedinUrl: string;
  /** A freshly picked file, or a saved resume id — the server requires one. */
  resumeFile?: ResumeFile | null;
  savedResumeId?: string | null;
}

/**
 * POST the application as multipart/form-data (the endpoint rejects JSON with
 * 415). Errors surface as an Error whose message is ready for display.
 */
export async function applyToJob(jobId: string, input: ApplyInput): Promise<string> {
  const form = new FormData();
  form.append('name', input.name.trim());
  form.append('portfolio_url', input.portfolioUrl.trim());
  form.append('linkedin_url', input.linkedinUrl.trim());

  if (input.savedResumeId) {
    form.append('saved_resume_id', input.savedResumeId);
  } else if (input.resumeFile) {
    // React Native's FormData takes a { uri, name, type } file descriptor for
    // a Blob position — the standard RN upload idiom.
    form.append('resume', {
      uri: input.resumeFile.uri,
      name: input.resumeFile.name,
      type: input.resumeFile.mimeType,
    } as unknown as Blob);
  }

  try {
    const { data } = await apiFormUpload<{ application_id?: string; error?: string; message?: string }>(
      `/api/jobs/${jobId}/apply`,
      form,
    );
    if (!data?.application_id) {
      throw new Error('The application could not be submitted. Please try again.');
    }
    return data.application_id;
  } catch (error) {
    const err = error as Error & { status?: number; data?: { error?: string; message?: string } };
    const friendly = applyFailureMessage(err.data?.error, err.message);
    const wrapped = new Error(friendly) as Error & { status?: number };
    wrapped.status = err.status;
    throw wrapped;
  }
}

/** The member's saved resumes (oldest first) for the apply-resume picker. */
export async function getSavedResumes(): Promise<SavedResume[]> {
  const { data } = await apiFetch<{ resumes?: SavedResume[] }>('/api/settings/resumes');
  return data?.resumes ?? [];
}

export interface ApplyPrefill {
  name: string;
  portfolioUrl: string;
  linkedinUrl: string;
  /** Viewer facts for the "locked for your profile" copy (can_apply stays the authority). */
  cityId: string | null;
  sectorId: string | null;
  jobTitle: string | null;
  experienceLevel: string | null;
}

/**
 * Apply-form prefill and viewer facts from the member's own profile, like the
 * web modal. Degrades to a name-only prefill when the profile read fails.
 */
export async function getApplyPrefill(fallbackName: string): Promise<ApplyPrefill> {
  try {
    const { data } = await apiFetch<{
      user?: { name?: string | null } | null;
      profile?: {
        portfolio_url?: string | null;
        linkedin_url?: string | null;
        job_title?: string | null;
        experience_level?: string | null;
        cities?: { id?: string | null } | null;
        design_sectors?: { id?: string | null } | null;
      } | null;
    }>('/api/profile');
    return {
      name: data?.user?.name ?? fallbackName,
      portfolioUrl: data?.profile?.portfolio_url ?? '',
      linkedinUrl: data?.profile?.linkedin_url ?? '',
      cityId: data?.profile?.cities?.id ?? null,
      sectorId: data?.profile?.design_sectors?.id ?? null,
      jobTitle: data?.profile?.job_title ?? null,
      experienceLevel: data?.profile?.experience_level ?? null,
    };
  } catch {
    return {
      name: fallbackName,
      portfolioUrl: '',
      linkedinUrl: '',
      cityId: null,
      sectorId: null,
      jobTitle: null,
      experienceLevel: null,
    };
  }
}
