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
 */

import type { DmConversation } from './dm';
import { getDmConversations } from './dmApi';

export const DM_CONVERSATIONS_STALE_MS = 30_000;

export interface DmConversationsCache {
  /** The member this shared page belongs to (undefined = unscoped tests). */
  setActiveUser(userId: string | null): void;
  peek(): DmConversation[] | null;
  peekOne(conversationId: string): DmConversation | null;
  put(conversation: DmConversation): void;
  seedFromDisk(rows: DmConversation[]): void;
  clear(): void;
  load(options?: { fresh?: boolean }): Promise<DmConversation[]>;
}

export interface DmConversationsCacheDeps {
  load: () => Promise<DmConversation[]>;
  now?: () => number;
}

export function createDmConversationsCache({
  load,
  now = Date.now,
}: DmConversationsCacheDeps): DmConversationsCache {
  let snapshot: DmConversation[] | null = null;
  let fetchedAt = 0;
  let inFlight: Promise<DmConversation[]> | null = null;
  let activeUserId: string | null | undefined;
  let epoch = 0;
  /** When a screen last wrote a row (accept/block/send), so a page that began
   *  before that write cannot overwrite it. */
  const localMutationAt = new Map<string, number>();

  return {
    setActiveUser(userId) {
      if (activeUserId === userId) return;
      activeUserId = userId;
      epoch += 1;
      snapshot = null;
      fetchedAt = 0;
      inFlight = null;
      localMutationAt.clear();
    },

    peek: () => (activeUserId === null ? null : snapshot),

    peekOne: (conversationId) =>
      activeUserId === null
        ? null
        : snapshot?.find((row) => row.id === conversationId) ?? null,

    put(conversation) {
      if (activeUserId === null || !snapshot) return;
      localMutationAt.set(conversation.id, now());
      const index = snapshot.findIndex((row) => row.id === conversation.id);
      snapshot =
        index === -1
          ? [conversation, ...snapshot]
          : snapshot.map((row) => (row.id === conversation.id ? conversation : row));
      fetchedAt = now();
    },

    seedFromDisk(rows) {
      if (activeUserId === null || snapshot) return;
      snapshot = rows;
      // Display-only: the next load still asks the server.
      fetchedAt = 0;
    },

    clear() {
      epoch += 1;
      snapshot = null;
      fetchedAt = 0;
      inFlight = null;
      localMutationAt.clear();
    },

    load(options = {}) {
      if (activeUserId === null) return Promise.resolve([]);
      if (
        !options.fresh &&
        snapshot &&
        now() - fetchedAt < DM_CONVERSATIONS_STALE_MS
      ) {
        return Promise.resolve(snapshot);
      }
      if (inFlight) return inFlight;

      const startedAt = now();
      const startedEpoch = epoch;
      const request = load()
        .then((rows) => {
          // A list fetched for the previous member must not repopulate the
          // new member's shared page.
          if (startedEpoch !== epoch) return rows;
          // Rows this device changed while the page was in flight are newer
          // than the server snapshot (accepting a request, blocking a member).
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
          fetchedAt = now();
          return merged;
        })
        .finally(() => {
          if (inFlight === request) inFlight = null;
        });

      inFlight = request;
      return request;
    },
  };
}

const dmConversations = createDmConversationsCache({ load: getDmConversations });
// Until auth adopts an identity no screen may read or write the page.
dmConversations.setActiveUser(null);

export function setDmConversationsActiveUser(userId: string | null): void {
  dmConversations.setActiveUser(userId);
}

export function peekDmConversations(): DmConversation[] | null {
  return dmConversations.peek();
}

export function peekDmConversation(conversationId: string): DmConversation | null {
  return dmConversations.peekOne(conversationId);
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
  return dmConversations.load(options);
}
