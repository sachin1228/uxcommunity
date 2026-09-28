/**
 * Socket bookkeeping for the community Durable Object.
 *
 * WHY THIS EXISTS
 *   The community DO's socket state — which user owns each socket, which
 *   sockets each user has, and the display metadata cached at `join` — is one
 *   concern with one lifecycle: it is written on upgrade/join, rebuilt from the
 *   WebSocket attachments after hibernation, and torn down on close, error or a
 *   failed send. It used to live as three fields sprinkled through the DO next
 *   to presence, membership and publish policy, which made "what is attached to
 *   this room right now?" hard to answer and impossible to test without a
 *   Worker.
 *
 *   This registry owns exactly that and nothing else. It deliberately does NOT
 *   own the topic index (`subscriptions.ts`), the fan-out, the token buckets or
 *   the metrics — a removal has to touch all of those, so `Room.removeSocket`
 *   stays the orchestrator and asks the registry only the two questions it can
 *   answer: "which user was this socket?" and "was that the user's last socket
 *   here?".
 *
 * SCOPE
 *   SOCKET-scoped: ws → userId, and the socket sets per user.
 *   USER-scoped: userId → display metadata cached at join, so client-publish
 *   frames never have to deserialize an attachment.
 *
 * Hibernation
 *   `adopt` reads a socket's attachment and registers it, which is what both the
 *   constructor's `blockConcurrencyWhile` rebuild and the post-wake fallback in
 *   `webSocketMessage` use. The attachment's field names and null-vs-undefined
 *   handling are part of the persisted format and are reproduced here verbatim.
 *
 * The `WebSocket` methods it uses (`deserializeAttachment`) are the Cloudflare
 * hibernation API, so this module is runtime-gated even though it is
 * dependency-free.
 */

import type { PresenceMeta } from "./subscriptions";

/**
 * Metadata persisted on each accepted socket in the hibernation attachment.
 *
 * FROZEN FORMAT: this is written with `serializeAttachment` and read back by a
 * later (possibly fresh) instance, so the field names and shapes cannot change
 * without losing subscriptions across a hibernation.
 */
export interface WebSocketAttachment {
  userId: string;
  topics: string[];
  name: string | null;
  avatar: string | null;
}

/** A socket registered from its hibernation attachment. */
export interface AdoptedSocket {
  userId: string;
  /** Topics the attachment says this socket had subscribed to. */
  topics: string[];
  /** Display metadata to cache for the owning user. */
  meta: PresenceMeta;
}

export class SocketRegistry {
  /** Socket → userId. */
  private wsToUser = new Map<WebSocket, string>();
  /** userId → Set<WebSocket> — all sockets for that user (multi-device + presence). */
  private userSockets = new Map<string, Set<WebSocket>>();
  /** Display metadata cached at join() — client-publish frames never touch attachments. */
  private userMeta = new Map<string, PresenceMeta>();

  /** Register an accepted socket in the socket- and user-scoped maps. */
  track(ws: WebSocket, userId: string): void {
    this.wsToUser.set(ws, userId);

    let sockets = this.userSockets.get(userId);
    if (!sockets) {
      sockets = new Set();
      this.userSockets.set(userId, sockets);
    }
    sockets.add(ws);
  }

  /** The user a socket is registered under, or undefined when it is untracked. */
  userId(ws: WebSocket): string | undefined {
    return this.wsToUser.get(ws);
  }

  /** Metadata cached for a user at `join` (null fields when they sent none). */
  getUserMeta(userId: string): PresenceMeta | undefined {
    return this.userMeta.get(userId);
  }

  /** Cache a user's display metadata, written once per join and read per flush. */
  setUserMeta(userId: string, meta: PresenceMeta): void {
    this.userMeta.set(userId, meta);
  }

  /**
   * Forget a socket.
   *
   * Returns the userId it was registered under (undefined when it was never
   * tracked) and whether that was the user's last socket in this room — in which
   * case the user's cached metadata is dropped with it, and the caller is
   * expected to release the user-scoped resources it owns (the shared publish
   * budget). Idempotent: a close handler racing an eviction, or a duplicate
   * runtime callback, cannot double-count.
   */
  untrack(ws: WebSocket): { userId: string | undefined; lastSocketForUser: boolean } {
    const userId = this.wsToUser.get(ws);
    this.wsToUser.delete(ws);
    if (userId === undefined) return { userId: undefined, lastSocketForUser: false };

    const sockets = this.userSockets.get(userId);
    if (!sockets) return { userId, lastSocketForUser: false };

    sockets.delete(ws);
    if (sockets.size > 0) return { userId, lastSocketForUser: false };

    this.userSockets.delete(userId);
    this.userMeta.delete(userId);
    return { userId, lastSocketForUser: true };
  }

  /**
   * Read a socket's hibernation attachment and register it.
   *
   * Returns null when the socket carries no usable attachment — the caller then
   * leaves the frame unhandled rather than inventing an identity for it. The
   * caller is responsible for indexing the returned `topics`, because the topic
   * index is a separate owner.
   */
  adopt(ws: WebSocket): AdoptedSocket | null {
    let attachment: WebSocketAttachment | undefined;
    try {
      attachment = ws.deserializeAttachment() as WebSocketAttachment | undefined;
    } catch {
      return null;
    }
    if (!attachment?.userId) return null;

    const userId = attachment.userId;
    this.track(ws, userId);

    const meta: PresenceMeta = {
      name: attachment.name ?? null,
      avatar: attachment.avatar ?? null,
    };
    if (attachment.name !== undefined || attachment.avatar !== undefined) {
      this.userMeta.set(userId, meta);
    }

    return { userId, topics: attachment.topics ?? [], meta };
  }

  /** Sockets per user — the input the presence count folds over. */
  get socketsByUser(): ReadonlyMap<string, ReadonlySet<WebSocket>> {
    return this.userSockets;
  }

  /** Number of tracked sockets (exposed through the DO's `/stats`). */
  get socketCount(): number {
    return this.wsToUser.size;
  }

  /** Number of distinct users with at least one socket (through `/stats`). */
  get userCount(): number {
    return this.userSockets.size;
  }
}
