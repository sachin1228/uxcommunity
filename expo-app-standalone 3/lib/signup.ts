/**
 * Signup API helpers — the mobile client for the web app's signup endpoints.
 *
 * The flow is the same three steps the web form runs
 * (`apps/web/app/signup/page.tsx`):
 *
 *   1. POST /api/signup/direct       validate identity + record the attempt
 *   2. GET  /api/data/*              city / sector / experience / job title
 *   3. POST /api/signup/avatar       create the account and start the session
 *
 * Step 3 sets the `uxcommunity_session` cookie, which `apiFetch` /
 * `apiFormUpload` already capture and persist for React Native.
 */

import { apiFetch, apiFormUpload } from './api';
import type { PreparedImage } from './prepareImage';
import type { SignupIdentity, SignupPayload } from './signupFlow';

export interface SignupOption {
  /** Master-data id for cities/sectors; the slug for levels/job titles. */
  id: string;
  name: string;
  image_url: string | null;
}

export interface SignupOptions {
  cities: SignupOption[];
  sectors: SignupOption[];
  jobTitles: SignupOption[];
  experienceLevels: SignupOption[];
}

interface CitiesResponse {
  cities?: Array<{ id: string; name: string; image_url?: string | null }>;
}

interface SectorsResponse {
  sectors?: Array<{ id: string; name: string; image_url?: string | null }>;
}

interface ExperienceLevelsResponse {
  experience_levels?: Array<{ id: string; slug: string; label: string; image_url?: string | null }>;
}

interface JobTitlesResponse {
  job_titles?: Array<{ id: string; slug: string; label: string; image_url?: string | null }>;
}

interface CompleteSignupResponse {
  success?: boolean;
  userId?: string;
  avatar_url?: string | null;
  joined_communities?: number;
  error?: string;
}

export interface CompleteSignupResult {
  userId: string;
  avatarUrl: string | null;
  joinedCommunities: number;
}

const OPTIONS_ERROR = 'Could not load signup options. Please try again.';

/**
 * Loads the four step-2 dropdowns in parallel, exactly like the web form. The
 * signup payload stores slugs for experience level and job title, so those
 * option ids are the slugs (cities and sectors stay uuid ids).
 */
export async function loadSignupOptions(): Promise<SignupOptions> {
  let cities: { data: CitiesResponse };
  let sectors: { data: SectorsResponse };
  let levels: { data: ExperienceLevelsResponse };
  let titles: { data: JobTitlesResponse };

  try {
    [cities, sectors, levels, titles] = await Promise.all([
      apiFetch<CitiesResponse>('/api/data/cities'),
      apiFetch<SectorsResponse>('/api/data/sectors'),
      apiFetch<ExperienceLevelsResponse>('/api/data/experience-levels'),
      apiFetch<JobTitlesResponse>('/api/data/job-titles'),
    ]);
  } catch {
    throw new Error(OPTIONS_ERROR);
  }

  return {
    cities: (cities.data.cities ?? []).map((city) => ({
      id: city.id,
      name: city.name,
      image_url: city.image_url ?? null,
    })),
    sectors: (sectors.data.sectors ?? []).map((sector) => ({
      id: sector.id,
      name: sector.name,
      image_url: sector.image_url ?? null,
    })),
    experienceLevels: (levels.data.experience_levels ?? []).map((level) => ({
      id: level.slug,
      name: level.label,
      image_url: level.image_url ?? null,
    })),
    jobTitles: (titles.data.job_titles ?? []).map((title) => ({
      id: title.slug,
      name: title.label,
      image_url: title.image_url ?? null,
    })),
  };
}

/**
 * Step 1 — validation only. The server checks the email is free and records the
 * funnel entry; no account or session exists until the final step.
 */
export async function validateSignupIdentity(identity: SignupIdentity): Promise<void> {
  await apiFetch<{ success: boolean }>('/api/signup/direct', {
    method: 'POST',
    body: identity as unknown as Record<string, unknown>,
  });
}

/**
 * Step 3 — creates the account, auto-joins the profile communities, sends the
 * welcome email and starts the session. An optional picture rides the same
 * multipart request the web form uses (`payload` + `file`).
 */
export async function completeSignup(
  payload: SignupPayload,
  avatar: PreparedImage | null,
): Promise<CompleteSignupResult> {
  let response: { data: CompleteSignupResponse };

  if (avatar) {
    const formData = new FormData();
    formData.append('payload', JSON.stringify(payload));
    formData.append('file', {
      uri: avatar.uri,
      type: avatar.mimeType,
      name: avatar.name,
    } as unknown as Blob);
    response = await apiFormUpload<CompleteSignupResponse>('/api/signup/avatar', formData);
  } else {
    response = await apiFetch<CompleteSignupResponse>('/api/signup/avatar', {
      method: 'POST',
      body: payload as unknown as Record<string, unknown>,
    });
  }

  const data = response.data;
  if (!data?.success || !data.userId) {
    throw new Error(data?.error ?? 'Failed to complete signup. Please try again.');
  }

  return {
    userId: data.userId,
    avatarUrl: data.avatar_url ?? null,
    joinedCommunities: typeof data.joined_communities === 'number' ? data.joined_communities : 0,
  };
}
