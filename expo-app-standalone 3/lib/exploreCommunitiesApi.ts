/**
 * The network half of Explore — the web app's `GET /api/communities/all` and
 * the withdraw endpoint the Requests rows drive. Joining itself stays with
 * `CommunityPreviewSheet`, the app's one join dialog.
 *
 * Kept apart from `exploreCommunities.ts` so the tab rules stay importable in
 * the plain-Node suite without React Native.
 */

import { apiFetch } from './api';
import type { ExploreCommunity } from './exploreCommunities';

/** Every community the member can browse, with their standing on each row. */
export async function getExploreCommunities(): Promise<ExploreCommunity[]> {
  const { data } = await apiFetch<{ communities?: ExploreCommunity[] }>('/api/communities/all');
  return data.communities ?? [];
}

/** Take back a pending request — the row leaves the Requests tab on success. */
export async function withdrawJoinRequest(communityId: string): Promise<void> {
  await apiFetch(`/api/communities/${communityId}/join`, { method: 'DELETE' });
}
