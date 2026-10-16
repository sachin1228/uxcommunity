/**
 * Shared community member roster — one fetch serves the composer's
 * @-mention picker and the community info screen's members list.
 *
 * The roster arrives paged (30 rows a request), so an uncached reader costs
 * several Worker invocations per call; both readers now share one module-level
 * cache per community. Cached on success only — a failure is never latched, so
 * the next caller retries — and kept for the session, matching the picker's
 * original behaviour.
 */

import { getCommunityMembers } from '@/lib/communities';
import type { MentionCandidate } from '@/lib/chat';

interface RosterEntry {
  members: MentionCandidate[];
  fetchedAt: number;
}

const rosterCache = new Map<string, RosterEntry>();
const inflightRoster = new Map<string, Promise<MentionCandidate[]>>();

/** Loads (and caches) a community's member roster so both readers share it. */
export async function loadCommunityRoster(communityId: string): Promise<MentionCandidate[]> {
  const cached = rosterCache.get(communityId);
  if (cached) return cached.members;

  const inflight = inflightRoster.get(communityId);
  if (inflight) return inflight;

  const promise = getCommunityMembers(communityId)
    .then((members) => {
      rosterCache.set(communityId, { members, fetchedAt: Date.now() });
      return members;
    })
    .catch(() => [] as MentionCandidate[])
    .finally(() => {
      inflightRoster.delete(communityId);
    });

  inflightRoster.set(communityId, promise);
  return promise;
}
