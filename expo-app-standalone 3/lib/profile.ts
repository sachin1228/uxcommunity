/**
 * The member's own profile — the data behind the Profile screen's hero.
 *
 * GET /api/profile returns the user row, the designer profile and two
 * server-composed extras: `roleLabel` ("Mid-Level Product Designer") and the
 * verified `company`, composed by the same helpers the web hero uses, so the
 * two surfaces can never disagree on how the role line reads.
 */

import { apiFetch, apiFormUpload } from './api';
import type { PreparedImage } from './prepareImage';
import type { PendingCompanyVerification } from './companies';
import type {
  IdentitySlot,
  IdentityUpdateResult,
  OfficialGroup,
  ProfileIdentityPayload,
} from './profileIdentity';

export interface ProfileUserRow {
  name: string;
  email: string;
  created_at: string;
}

export interface ProfileRow {
  avatar_url: string | null;
  avatar_source: string | null;
  experience_level: string | null;
  job_title: string | null;
  linkedin_url: string | null;
  portfolio_url: string | null;
  bio: string | null;
  cities: { id: string; name: string } | null;
  design_sectors: { id: string; name: string } | null;
}

export interface ProfileCompany {
  id: string;
  name: string;
  slug: string;
  /** Stored logo, else the favicon of the company's domain — decoration only. */
  logoUrl: string | null;
  isActive: boolean;
  domain: string | null;
  domainVerified: boolean;
  membershipVerified: boolean;
}

export interface OwnProfile {
  user: ProfileUserRow | null;
  profile: ProfileRow | null;
  roleLabel: string | null;
  company: ProfileCompany | null;
  /** A work-email challenge still waiting on a code, so the picker can reopen into it. */
  pendingCompany: PendingCompanyVerification | null;
}

export async function getOwnProfile(): Promise<OwnProfile> {
  const { data } = await apiFetch<{
    user?: ProfileUserRow | null;
    profile?: ProfileRow | null;
    roleLabel?: string | null;
    company?: ProfileCompany | null;
    pendingCompany?: PendingCompanyVerification | null;
  }>('/api/profile');

  return {
    user: data.user ?? null,
    profile: data.profile ?? null,
    roleLabel: data.roleLabel ?? null,
    company: data.company ?? null,
    pendingCompany: data.pendingCompany ?? null,
  };
}

// ---------------------------------------------------------------------------
// Another member's profile (read-only, the DM entry point)
// ---------------------------------------------------------------------------

export interface MemberProfileUser {
  id: string;
  name: string | null;
  created_at: string;
}

export interface MemberProfile {
  user: MemberProfileUser | null;
  profile: ProfileRow | null;
  roleLabel: string | null;
  company: ProfileCompany | null;
  /** The viewer blocked this member — identity shows, activity does not. */
  blockedByMe: boolean;
  /** This member blocked the viewer — nothing of the profile renders. */
  blockedViewer: boolean;
}

export async function getMemberProfile(userId: string): Promise<MemberProfile> {
  const { data } = await apiFetch<{
    user?: MemberProfileUser | null;
    profile?: ProfileRow | null;
    roleLabel?: string | null;
    company?: ProfileCompany | null;
    blockedByMe?: boolean;
    blockedViewer?: boolean;
  }>(`/api/profile/${encodeURIComponent(userId)}`);

  return {
    user: data.user ?? null,
    profile: data.profile ?? null,
    roleLabel: data.roleLabel ?? null,
    company: data.company ?? null,
    blockedByMe: Boolean(data.blockedByMe),
    blockedViewer: Boolean(data.blockedViewer),
  };
}

/** Save one of the hero's outside links. A trimmed "" clears it (stored as null). */
export async function saveProfileLink(
  field: 'linkedin_url' | 'portfolio_url',
  url: string,
): Promise<void> {
  await apiFetch('/api/profile', { method: 'PATCH', body: { [field]: url.trim() } });
}

/**
 * Upload a new display picture. The web route accepts JPEG/PNG/WebP up to
 * 5 MB and answers the stored URL; the picked image is re-encoded to WebP by
 * `prepareImageForUpload` before it rides the request.
 */
export async function uploadAvatar(image: PreparedImage): Promise<string> {
  const formData = new FormData();
  formData.append('file', {
    uri: image.uri,
    type: image.mimeType,
    name: image.name,
  } as unknown as Blob);

  const { data } = await apiFormUpload<{ avatar_url?: string; error?: string }>(
    '/api/profile/avatar',
    formData,
  );

  if (!data.avatar_url) {
    throw new Error(data.error ?? 'Failed to update profile picture.');
  }
  return data.avatar_url;
}

// ---------------------------------------------------------------------------
// Identity (the signup fields behind the identity editor)
// ---------------------------------------------------------------------------

/** Everything the identity editor needs: current values, locks, options, groups. */
export async function getProfileIdentity(): Promise<ProfileIdentityPayload> {
  const { data } = await apiFetch<ProfileIdentityPayload>('/api/profile/identity');
  return data;
}

/**
 * Saves the changed slots. Absent keys are dropped — the route keeps the RPC
 * parameter's DEFAULT NULL, which is "leave this slot as it is". Values are
 * always strings (a slot is changed by picking a value; clearing is not a
 * state the signup fields allow). Throws the apiFetch error (with `status`
 * and `data`) so the caller can map a 409 `profile_field_cooldown` to its
 * lock lines.
 */
export async function updateProfileIdentity(
  payload: Partial<
    Record<'name' | 'city_id' | 'sector_id' | 'experience_level' | 'job_title', string>
  >,
): Promise<IdentityUpdateResult> {
  const body: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) body[key] = value;
  }

  const { data } = await apiFetch<{
    changed_fields?: IdentitySlot[];
    left_communities?: OfficialGroup[];
    joined_communities?: OfficialGroup[];
  }>('/api/profile/identity', { method: 'PATCH', body });

  return {
    changed_fields: data.changed_fields ?? [],
    left_communities: data.left_communities ?? [],
    joined_communities: data.joined_communities ?? [],
  };
}
