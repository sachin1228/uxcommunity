import { sidebarStore } from "@/lib/communities/cache";

/**
 * Mark a community as read on the server.
 *
 * Optimistically clears the sidebar badge and advances last_read_at locally;
 * the PATCH persists the new last_read_at server-side so future sidebar
 * fetches compute accurate unread counts.
 *
 * Deliberately does NOT hand the previous last_read_at back to the chat via
 * `lastReadAtOnOpen`: the chat receives the authoritative boundary from SSR
 * (`initialLastReadAt`) on every open, and re-writing the OLD value into the
 * shared map after the PATCH would resurrect the stale unread boundary (and
 * divider) the next time the user opens the community.
 */
export async function markReadOnServer(communityId: string): Promise<void> {
  const newLastReadAt = new Date().toISOString();
  try {
    const res = await fetch(`/api/communities/${communityId}/read`, {
      method: "PATCH",
    });
    if (res.ok) {
      if (sidebarStore.data) {
        sidebarStore.data = {
          ...sidebarStore.data,
          communities: sidebarStore.data.communities.map((c) =>
            c.id === communityId
              ? { ...c, last_read_at: newLastReadAt, message_count: 0 }
              : c
          ),
        };
      }
    }
  } catch {}
}
