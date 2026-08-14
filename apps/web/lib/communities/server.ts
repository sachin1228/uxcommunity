import "server-only";

import type { CachedMessage, CachedMeta } from "./cache";
import {
  loadCommunityBootstrapReadModel,
  loadCommunityMessagePage,
} from "./read-models";

export interface SSRCommunitySections {
  threads?: unknown;
  events?: unknown;
  resources?: unknown;
  showcase?: unknown;
  members?: unknown;
  rules?: unknown;
  stats?: unknown;
}

export interface SSRCommunityData {
  meta: CachedMeta;
  messages: CachedMessage[];
  lastReadAt: string | null;
  sections: SSRCommunitySections;
}

/**
 * The server render uses the same critical-only read path as bootstrap.
 * Secondary sections intentionally remain absent and fetch from their lazy APIs
 * only when their tab or panel mounts.
 */
export async function fetchCommunitySSRData(
  communityId: string,
  userId: string,
): Promise<SSRCommunityData | null> {
  const communityResult = await loadCommunityBootstrapReadModel(communityId, userId);
  if (!communityResult.ok) return null;

  const messageResult = await loadCommunityMessagePage(communityId, userId, {}, {
    membership: communityResult.data.membership,
  });
  if (!messageResult.ok) return null;

  const { membership, community } = communityResult.data;
  return {
    meta: {
      community: community as CachedMeta["community"],
      members: [],
      fetchedAt: Date.now(),
    },
    messages: messageResult.data.messages as CachedMessage[],
    lastReadAt: membership.last_read_at,
    sections: {},
  };
}
