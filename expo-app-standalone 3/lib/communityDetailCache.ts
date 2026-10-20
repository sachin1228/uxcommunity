import { getCommunityDetail, type CommunityDetailRow } from '@/lib/communities';

/**
 * One shared read of GET /api/communities/:id — the chat header needs the
 * caller's role and grants, the info screen needs About/rules data, and the
 * settings screen needs the full editable row. They all read the same web
 * read model, so they share one in-flight request and one short freshness
 * window instead of hitting the route per screen.
 */
const STALE_MS = 5 * 60_000;

const cache = new Map<string, { fetchedAt: number; row: CommunityDetailRow | null }>();
const inflight = new Map<string, Promise<CommunityDetailRow | null>>();

/** A still-fresh row, or undefined when one must be fetched. */
export function peekCommunityDetail(communityId: string): CommunityDetailRow | null | undefined {
  const hit = cache.get(communityId);
  if (!hit) return undefined;
  return Date.now() - hit.fetchedAt < STALE_MS ? hit.row : undefined;
}

/** Supply a fresh row after a save (or another route that already knows it). */
export function putCommunityDetail(communityId: string, row: CommunityDetailRow | null): void {
  cache.set(communityId, { fetchedAt: Date.now(), row });
}

export function patchCommunityDetail(
  communityId: string,
  patch: Partial<CommunityDetailRow>
): void {
  const hit = cache.get(communityId);
  if (!hit?.row) return;
  cache.set(communityId, { fetchedAt: Date.now(), row: { ...hit.row, ...patch } });
}

/**
 * The detail row, from cache while fresh (or from the in-flight request), and
 * from the server otherwise. Callers that must reflect a change made on
 * another screen pass `force`.
 */
export async function loadCommunityDetail(
  communityId: string,
  options: { force?: boolean } = {}
): Promise<CommunityDetailRow | null> {
  if (!options.force) {
    const fresh = peekCommunityDetail(communityId);
    if (fresh !== undefined) return fresh;
    const pending = inflight.get(communityId);
    if (pending) return pending;
  }

  const request = getCommunityDetail(communityId)
    .then((row) => {
      putCommunityDetail(communityId, row);
      return row;
    })
    .finally(() => {
      inflight.delete(communityId);
    });
  inflight.set(communityId, request);
  return request;
}
