import { invalidateOnJoin } from "@/lib/communities/cache";
import type { EventJoinAnswers } from "@/lib/communities/event-join-questions";

/**
 * Confirm joining an event's group chat from the browser.
 *
 * Joining is a normal community join on the server (see the event-chat route
 * handling in /api/communities/[id]/join); the member's answers to the host's
 * compulsory questions ride along and are recorded there. The only other
 * client-side duty is to drop the sidebar cache so the new room shows up there
 * in the same frame instead of waiting for the next refetch.
 */
export async function joinEventChatFromClient(
  communityId: string,
  answers: EventJoinAnswers,
): Promise<void> {
  const response = await fetch(`/api/communities/${communityId}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? "Failed to join the event chat.");
  }

  invalidateOnJoin(communityId);
}
