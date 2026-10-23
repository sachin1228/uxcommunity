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
 * `fresh` — it removes duplicate reads, never a real revalidation.
 */

import type { DmConversation } from './dm';
import { getDmConversations } from './dmApi';

export const DM_CONVERSATIONS_STALE_MS = 30_000;

let snapshot: DmConversation[] | null = null;
let fetchedAt = 0;
let inFlight: Promise<DmConversation[]> | null = null;
/** When a screen last wrote a row (accept/block/send), so a page that began
 *  before that write cannot overwrite it. */
const localMutationAt = new Map<string, number>();

export function peekDmConversations(): DmConversation[] | null {
  return snapshot;
}

export function peekDmConversation(conversationId: string): DmConversation | null {
  return snapshot?.find((row) => row.id === conversationId) ?? null;
}

/**
 * A launch-time snapshot for the first frame only; the next load still asks
 * the server (a request's pending/rejected state changes without an event).
 */
export function seedDmConversationsFromDisk(rows: DmConversation[]): void {
  if (snapshot) return;
  snapshot = rows;
  fetchedAt = 0;
}

/** Keep the shared copy in step with a screen's live conversation state. */
export function putDmConversation(conversation: DmConversation): void {
  if (!snapshot) return;
  localMutationAt.set(conversation.id, Date.now());
  const index = snapshot.findIndex((row) => row.id === conversation.id);
  snapshot =
    index === -1
      ? [conversation, ...snapshot]
      : snapshot.map((row) => (row.id === conversation.id ? conversation : row));
  fetchedAt = Date.now();
}

export function clearDmConversationsCache(): void {
  snapshot = null;
  fetchedAt = 0;
  inFlight = null;
  localMutationAt.clear();
}

export async function loadDmConversations(
  options: { fresh?: boolean } = {},
): Promise<DmConversation[]> {
  if (
    !options.fresh &&
    snapshot &&
    Date.now() - fetchedAt < DM_CONVERSATIONS_STALE_MS
  ) {
    return snapshot;
  }
  if (inFlight) return inFlight;

  const startedAt = Date.now();
  const request = getDmConversations()
    .then((rows) => {
      // Rows this device changed while the page was in flight are newer than
      // the server snapshot (accepting a request, blocking a member).
      const previous = snapshot;
      const merged = rows.map((row) => {
        const mutatedAt = localMutationAt.get(row.id) ?? 0;
        if (mutatedAt < startedAt) return row;
        return previous?.find((local) => local.id === row.id) ?? row;
      });
      // A brand-new thread the server list does not carry yet, but this
      // screen opened while the page was in flight.
      const seen = new Set(merged.map((row) => row.id));
      for (const local of previous ?? []) {
        if (seen.has(local.id)) continue;
        if ((localMutationAt.get(local.id) ?? 0) >= startedAt) merged.push(local);
      }
      snapshot = merged;
      fetchedAt = Date.now();
      return merged;
    })
    .finally(() => {
      inFlight = null;
    });

  inFlight = request;
  return request;
}
