/**
 * One shared copy of the member's DM list.
 *
 * The thread screen needs exactly one conversation's metadata on every open
 * while the list screen needs the whole page; both used to hit
 * `/api/dm/conversations` (the list twice, on mount). This module shares the
 * in-flight request and keeps the last page for a short window, so a thread
 * opened from the list renders its composer from data the list already holds.
 *
 * The window is deliberately short and every deliberate refresh passes
 * `fresh` — it removes duplicate reads, never a real revalidation. A mutation
 * made while a page is in flight (accepting a request, blocking a member) is
 * newer than that page and survives the merge.
 *
 * The cache itself is platform-free (dmConversationsCacheCore) so its rules
 * are testable; this module owns only the singleton wired to the API.
 */

import type { DmConversation } from './dm';
import { getDmConversations } from './dmApi';
import { createDmConversationsCache } from './dmConversationsCacheCore';
import { applyDmReadFloor } from './dmReadFloor';

export {
  createDmConversationsCache,
  DM_CONVERSATIONS_STALE_MS,
  type DmConversationsCache,
  type DmConversationsCacheDeps,
} from './dmConversationsCacheCore';

const dmConversations = createDmConversationsCache({ load: getDmConversations });
// Until auth adopts an identity no screen may read or write the page.
dmConversations.setActiveUser(null);

export function setDmConversationsActiveUser(userId: string | null): void {
  dmConversations.setActiveUser(userId);
}

export function peekDmConversations(): DmConversation[] | null {
  const rows = dmConversations.peek();
  return rows ? rows.map(applyDmReadFloor) : null;
}

export function peekDmConversation(conversationId: string): DmConversation | null {
  const row = dmConversations.peekOne(conversationId);
  return row ? applyDmReadFloor(row) : null;
}

/**
 * The conversation with a member when this device already knows it. A profile
 * can push the thread with this id and skip the create-or-get round trip.
 */
export function peekDmConversationForPeer(peerId: string): DmConversation | null {
  const row = dmConversations.peekOneForPeer(peerId);
  return row ? applyDmReadFloor(row) : null;
}

/** Keep the shared copy in step with a screen's live conversation state. */
export function putDmConversation(conversation: DmConversation): void {
  dmConversations.put(conversation);
}

/**
 * A launch-time snapshot for the first frame only; the next load still asks
 * the server (a request's pending/rejected state changes without an event).
 */
export function seedDmConversationsFromDisk(rows: DmConversation[]): void {
  dmConversations.seedFromDisk(rows);
}

export function clearDmConversationsCache(): void {
  dmConversations.clear();
}

export function loadDmConversations(
  options: { fresh?: boolean } = {},
): Promise<DmConversation[]> {
  return dmConversations.load(options).then((rows) => rows.map(applyDmReadFloor));
}
