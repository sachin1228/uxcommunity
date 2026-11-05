/**
 * The platform-free half of the shared DM conversation page: request
 * coalescing, the freshness window and the merge rules. Kept free of the API
 * client (and therefore React Native) so the rules run under `tsx --test`;
 * the singleton wired to `getDmConversations` lives in dmConversationsCache.
 */

import type { DmConversation } from './dm';

export const DM_CONVERSATIONS_STALE_MS = 30_000;

export interface DmConversationsCache {
  /** The member this shared page belongs to (undefined = unscoped tests). */
  setActiveUser(userId: string | null): void;
  peek(): DmConversation[] | null;
  peekOne(conversationId: string): DmConversation | null;
  /** The thread with a member, for opening it before the create call answers. */
  peekOneForPeer(peerId: string): DmConversation | null;
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
  let requestSeq = 0;
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

    peekOneForPeer: (peerId) =>
      activeUserId === null
        ? null
        : snapshot?.find((row) => row.peer.id === peerId) ?? null,

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
      // A deliberate fresh read supersedes an in-flight page: it was started
      // before whatever made this caller ask again (a read marker, a
      // foreground), so its counts can be older than the caller needs. Every
      // waiter is handed the newer page instead.
      if (inFlight && !options.fresh) return inFlight;

      const startedAt = now();
      const startedEpoch = epoch;
      const seq = ++requestSeq;
      const request = load()
        .then((rows) => {
          // A list fetched for the previous member must not repopulate the
          // new member's shared page.
          if (startedEpoch !== epoch) return rows;
          // A fresh read started after this one: this page is superseded.
          // Let its callers adopt the newest request (or the snapshot it
          // already produced) rather than applying a stale answer.
          if (seq !== requestSeq) return inFlight ?? snapshot ?? rows;
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
