import { invalidateOnJoin } from "@/lib/communities/cache";

/**
 * Confirm joining an event's group chat from the browser.
 *
 * Joining is a normal community join on the server (see the event-chat route
 * handling in /api/communities/[id]/join); the only client-side duty is to drop
 * the sidebar cache so the new room shows up there in the same frame instead of
 * waiting for the next refetch.
 */
export async function joinEventChatFromClient(communityId: string): Promise<void> {
  const response = await fetch(`/api/communities/${communityId}/join`, {
    method: "POST",
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? "Failed to join the event chat.");
  }

  invalidateOnJoin(communityId);
}
