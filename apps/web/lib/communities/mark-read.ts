import { sidebarStore, lastReadAtOnOpen } from "@/lib/communities/cache";

/**
 * Mark a community as read on the server.
 *
 * The PATCH endpoint returns `previousLastReadAt` — the last_read_at value
 * BEFORE it was overwritten. We store it in `lastReadAtOnOpen` so that
 * CommunityChat can position the unread divider by timestamp comparison even
 * when sidebarStore.data was null and the synchronous snapshot couldn't be taken.
 *
 * Returns true when the server confirmed the write (2xx), so the read manager
 * can retry failures instead of silently leaving the badge inconsistent.
 * On success the sidebar store AND the cached /api/communities request entry
 * are both updated — mirroring only the store left the request cache holding
 * pre-read unread counts, so any refetch within the stale window resurrected
 * the badge the optimistic zero had just cleared.
 */
export async function markReadOnServer(communityId: string): Promise<boolean> {
  const newLastReadAt = new Date().toISOString();
  try {
    const res = await fetch(`/api/communities/${communityId}/read`, {
      method: "PATCH",
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({}));
    if (!lastReadAtOnOpen.has(communityId) && "previousLastReadAt" in data) {
      lastReadAtOnOpen.set(communityId, data.previousLastReadAt ?? null);
    }
    if (sidebarStore.data) {
      sidebarStore.data = {
        ...sidebarStore.data,
        communities: sidebarStore.data.communities.map((c) =>
          c.id === communityId
            ? { ...c, last_read_at: newLastReadAt, message_count: 0, unread_content_count: 0 }
            : c
        ),
      };
    }
    // Mirror the zeroed badge into the request cache so sidebar refetches
    // within the stale window don't replay the pre-read unread counts.
    patchCachedSidebarEntry(communityId, newLastReadAt);
    return true;
  } catch {
    return false;
  }
}

/** Lazily imported to avoid a cycle: request-cache ← cache ← read-manager. */
async function patchCachedSidebarEntry(
  communityId: string,
  lastReadAt: string,
): Promise<void> {
  try {
    const { patchCachedRequest } = await import("@/lib/request-cache");
    patchCachedRequest<{ communities: Array<{ id: string; message_count: number; unread_content_count?: number; last_read_at?: string | null }> }>(
      "/api/communities",
      (current) => ({
        ...current,
        communities: (current.communities ?? []).map((c) =>
          c.id === communityId
            ? { ...c, message_count: 0, unread_content_count: 0, last_read_at: lastReadAt }
            : c
        ),
      }),
    );
  } catch {
    // Cache module unavailable — the sidebar store patch above still applied.
  }
}
