import type { CommunityRule } from '@/lib/communities';

/**
 * The rules endpoint's 60-second freshness, shared by the info panel and the
 * settings screen — the same contract as the web request cache. Saving the
 * rules in settings writes the fresh list here so reopening the info panel
 * shows the saved set instead of the pre-save copy.
 */
const STALE_MS = 60_000;

const cache = new Map<string, { fetchedAt: number; rules: CommunityRule[] }>();

export function peekCommunityRules(communityId: string): CommunityRule[] | undefined {
  const hit = cache.get(communityId);
  if (!hit) return undefined;
  return Date.now() - hit.fetchedAt < STALE_MS ? hit.rules : undefined;
}

export function putCommunityRules(communityId: string, rules: CommunityRule[]): void {
  cache.set(communityId, { fetchedAt: Date.now(), rules });
}

/** The local rows a just-saved rule list paints from (ids are placeholders). */
export function rulesFromTexts(texts: string[]): CommunityRule[] {
  return texts.map((rule_text, order_index) => ({
    id: `local-${order_index}`,
    rule_text,
    order_index,
  }));
}
