import { apiFetch } from './api';
import {
  joinOutcomeFromStatus,
  type CommunityJoinOutcome,
  type CommunityPreviewData,
} from './communityPreviewData';

/**
 * The network half of the feed's "posted in …" community preview — the web
 * app's `GET /api/communities/[id]/preview` and its join endpoint.
 *
 * Kept apart from `communityPreviewData.ts` so the read model and join-outcome
 * helper stay importable in the plain-Node suite without React Native.
 */

/** Read the preview. `null` when the community no longer exists. */
export async function getCommunityPreview(
  communityId: string,
): Promise<CommunityPreviewData | null> {
  try {
    const { data } = await apiFetch<{ preview?: CommunityPreviewData | null }>(
      `/api/communities/${communityId}/preview`,
    );
    return data.preview ?? null;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { status?: unknown }).status === 404
    ) {
      return null;
    }
    throw error;
  }
}

/** Join (public) or request to join (private) — the API decides which. */
export async function joinCommunity(
  communityId: string,
): Promise<CommunityJoinOutcome> {
  const { data } = await apiFetch<{ status?: string }>(
    `/api/communities/${communityId}/join`,
    { method: 'POST' },
  );
  return joinOutcomeFromStatus(data.status);
}
