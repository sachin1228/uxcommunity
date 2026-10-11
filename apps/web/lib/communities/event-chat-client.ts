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

/**
 * Confirm joining an event's group chat when the room does not exist yet —
 * the event page offers its Join row for any event that has not ended, and
 * this is the door for an event whose group was never created. The server
 * finds-or-creates the room and puts the member in it; the sidebar cache is
 * dropped the same way a normal join does, so the new room appears there.
 * Returns the room's community id, ready to open.
 */
export async function createAndJoinEventChatFromClient(
  communityId: string,
  eventId: string,
  answers: EventJoinAnswers,
): Promise<string> {
  const response = await fetch(`/api/communities/${communityId}/events/${eventId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  });

  const data = (await response.json().catch(() => null)) as
    | { chat_community_id?: string; error?: string }
    | null;

  if (!response.ok || !data?.chat_community_id) {
    throw new Error(data?.error ?? "Failed to join the event chat.");
  }

  invalidateOnJoin(data.chat_community_id);
  return data.chat_community_id;
}
