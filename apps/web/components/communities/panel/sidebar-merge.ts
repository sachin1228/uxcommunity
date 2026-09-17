import type { CachedSidebarCommunity } from "@/lib/communities/cache";
import { compareByRecentActivity } from "./sidebar-order";

/**
 * When a cached/refetched sidebar list replays into React state it must never
 * demote a community whose newer activity was already applied locally by the
 * realtime stream. The request-cache entry for /api/communities can lag the
 * live store (its snapshot predates the newest message), and any code path
 * that re-stamps its fetchedAt — e.g. patchCachedRequest from a mark-read —
 * makes that stale snapshot look fresh for the whole 60s stale window. A
 * subsequent load() then replays it, and communities whose sort key had moved
 * forward (a brand-new last_message) sink back down the list.
 *
 * The merge keeps the union of both lists. Per community the entry with the
 * NEWER activity key (same comparator the sidebar renders with) wins its
 * descriptive fields (preview, reaction, timestamps); the counters that only
 * the server computes authoritatively (unread count, unread mention count,
 * last_read_at, member count, archived flag) always come from the server list.
 *
 * Returns entries sorted in the canonical sidebar order.
 */
export function mergeStaleServerList(
  local: CachedSidebarCommunity[],
  server: CachedSidebarCommunity[],
): CachedSidebarCommunity[] {
  if (!local.length) return server;
  if (!server.length) return local;

  const localById = new Map(local.map((c) => [c.id, c]));
  const merged: CachedSidebarCommunity[] = server.map((incoming) => {
    const previous = localById.get(incoming.id);
    if (!previous) return incoming;
    localById.delete(incoming.id);

    // Descriptive winner = whichever side saw more recent activity.
    const incomingNewer = compareByRecentActivity(incoming, previous) <= 0;
    const winner = incomingNewer ? incoming : previous;
    return {
      ...winner,
      // Server-authoritative counters regardless of which preview won.
      message_count: incoming.message_count,
      mention_count: incoming.mention_count,
      unread_content_count: incoming.unread_content_count,
      last_read_at: incoming.last_read_at,
      member_count: incoming.member_count,
      is_archived: incoming.is_archived,
      // Keep a locally-known reaction preview when the server row predates it
      // (reactions are also patched client-side from realtime).
      lastReaction: previous.lastReaction && (!incoming.lastReaction || (previous.lastReaction.createdAt ?? "") >= (incoming.lastReaction.createdAt ?? ""))
        ? previous.lastReaction
        : incoming.lastReaction,
      // Same for content previews ("john created a thread"): realtime may
      // have landed one on the local row that the server snapshot predates.
      // A same-item row persisted before the author-name fix (no firstName)
      // would render "Someone" forever — heal it from the server row.
      last_content: (() => {
        const prev = previous.last_content;
        const incomingContent = incoming.last_content ?? null;
        if (prev && (!incomingContent || prev.created_at >= incomingContent.created_at)) {
          return prev.id === incomingContent?.id && !prev.firstName && incomingContent.firstName
            ? incomingContent
            : prev;
        }
        return incomingContent;
      })(),
    };
  });

  // Communities present locally but not in the server response (joined since
  // the server snapshot, or the fetch raced a join) must not vanish.
  for (const orphan of localById.values()) merged.push(orphan);

  return merged.sort(compareByRecentActivity);
}
