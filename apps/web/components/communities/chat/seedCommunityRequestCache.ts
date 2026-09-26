import type { CachedContentEvent, CachedMessage, CachedMeta } from "@/lib/communities/cache";
import type { SSRCommunitySections } from "@/lib/communities/server";
import { setCachedRequest, type CommunityBootstrap } from "@/lib/request-cache";

/**
 * Seed every first-page endpoint of a community from its SSR snapshot so tab
 * mounts are cache-only, while pagination and realtime still hit the API.
 */
export function seedCommunityRequestCache({
  communityId,
  currentUserId,
  sections,
  contentEvents,
  meta,
  messages,
}: {
  communityId: string;
  currentUserId: string;
  sections: SSRCommunitySections;
  contentEvents?: CachedContentEvent[];
  meta?: CachedMeta;
  messages?: CachedMessage[];
}): void {
  const base = `/api/communities/${communityId}`;
  const urls: Array<[string, unknown]> = [
    [`${base}/threads`, sections.threads],
    [`${base}/events`, sections.events],
    [`${base}/resources`, sections.resources],
    [`${base}/showcase`, sections.showcase],
    [`${base}/members?page=0`, sections.members],
    [`${base}/rules`, sections.rules],
    [`${base}/content-events`, { events: contentEvents }],
  ];
  for (const [url, value] of urls) {
    if (value !== undefined) setCachedRequest(url, value, currentUserId);
  }

  // When the SSR snapshot already carries the community read model and first
  // message page, mirror it into the bootstrap cache entry as well. Otherwise
  // every downstream bootstrap-backed read (chat data, info panel, tab views)
  // fires a fresh network GET /bootstrap even though the page already seeded
  // everything it needs.
  if (meta && messages) {
    const bootstrap: CommunityBootstrap = {
      community: {
        community: meta.community,
        members: meta.members,
      },
      messages: { messages },
      permissions: undefined,
      unreadCount: 0,
      failures: [],
    };
    setCachedRequest(`${base}/bootstrap`, bootstrap, currentUserId);
  }
}
