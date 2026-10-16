/**
 * Explore REST calls — the same endpoints the web Explore page uses:
 * `GET /api/communities/all` for the browse list,
 * `POST /api/communities/[id]/join` for joins and private join requests, and
 * `DELETE /api/communities/[id]/join` to withdraw a pending request.
 */

import { apiFetch } from './api';
import type { ExploreCommunity } from './explore';

export async function getExploreCommunities(): Promise<ExploreCommunity[]> {
  const { data } = await apiFetch<{ communities?: ExploreCommunity[] }>(
    '/api/communities/all',
  );
  return data?.communities ?? [];
}

export type JoinOutcome =
  | { kind: 'joined' }
  | { kind: 'requested' };

/**
 * Join (public) or request to join (private). The server decides which by the
 * community's own flags and answers accordingly; a profile-gated mismatch or
 * the seven-slot cap surface as user-facing errors.
 */
export async function joinCommunity(
  communityId: string,
  message?: string,
): Promise<JoinOutcome> {
  const body: Record<string, unknown> = {};
  const trimmed = message?.trim();
  if (trimmed) body.message = trimmed.slice(0, 500);

  const { data } = await apiFetch<{ success?: boolean; status?: string }>(
    `/api/communities/${communityId}/join`,
    { method: 'POST', body },
  );

  return data?.status === 'requested' ? { kind: 'requested' } : { kind: 'joined' };
}

/** Withdraw the caller's own pending join request (self-scoped, idempotent). */
export async function withdrawJoinRequest(communityId: string): Promise<void> {
  await apiFetch(`/api/communities/${communityId}/join`, { method: 'DELETE' });
}
