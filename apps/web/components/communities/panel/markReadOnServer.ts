import { sidebarStore, lastReadAtOnOpen } from "@/lib/communities/cache";

/**
 * Mark a community as read on the server.
 *
 * The PATCH endpoint returns `previousLastReadAt` — the last_read_at value
 * BEFORE it was overwritten. We store it in `lastReadAtOnOpen` so that
 * CommunityChat can position the unread divider by timestamp comparison even
 * when sidebarStore.data was null and the synchronous snapshot couldn't be taken.
 */
export async function markReadOnServer(communityId: string): Promise<void> {
  const newLastReadAt = new Date().toISOString();
  try {
    const res = await fetch(`/api/communities/${communityId}/read`, {
      method: "PATCH",
    });
    if (res.ok) {
      const data = await res.json();
      if (!lastReadAtOnOpen.has(communityId) && "previousLastReadAt" in data) {
        lastReadAtOnOpen.set(communityId, data.previousLastReadAt ?? null);
      }
      if (sidebarStore.data) {
        sidebarStore.data = {
          ...sidebarStore.data,
          communities: sidebarStore.data.communities.map((c) =>
            c.id === communityId ? { ...c, last_read_at: newLastReadAt } : c
          ),
        };
      }
    }
  } catch {}
}
