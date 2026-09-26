/**
 * Targeted fan-out indexes for the realtime Durable Objects.
 *
 * WHY THIS EXISTS
 *   The Community DO used to resolve a broadcast by iterating every attached
 *   socket (`ctx.getWebSockets()`) and asking each one "are you subscribed to
 *   this topic?". That is O(all sockets in the DO) work per event — including
 *   sockets that never subscribed to the topic — and it re-reads a Map per
 *   socket on every publish.
 *
 *   These indexes keep the inverse mapping instead: topic → sockets. A publish
 *   then touches exactly the sockets that asked for that topic, which is what
 *   makes fan-out cost proportional to recipients rather than to the room's
 *   population.
 *
 *   Socket-scoped on purpose. Keying by user (as an earlier revision did) makes
 *   multi-device cleanup subtle: closing one tab must not remove a topic the
 *   user's other tab still holds. With one entry per socket that case cannot
 *   arise — each socket owns only its own subscriptions.
 *
 * The module is dependency-free (no `cloudflare:workers`) so the index
 * behaviour can be unit-tested directly.
 */

/** Minimal socket shape the index needs — a distinct object identity. */
export type IndexSocket = object;

export class TopicSocketIndex<Socket extends IndexSocket = IndexSocket> {
  private byTopic = new Map<string, Set<Socket>>();
  private bySocket = new Map<Socket, Set<string>>();

  /** Subscribe a socket to a topic. Returns false when it was already subscribed. */
  add(topic: string, socket: Socket): boolean {
    let sockets = this.byTopic.get(topic);
    if (!sockets) {
      sockets = new Set();
      this.byTopic.set(topic, sockets);
    }
    if (sockets.has(socket)) return false;
    sockets.add(socket);

    let topics = this.bySocket.get(socket);
    if (!topics) {
      topics = new Set();
      this.bySocket.set(socket, topics);
    }
    topics.add(topic);
    return true;
  }

  /** Unsubscribe a socket from one topic. Returns false when it was not subscribed. */
  remove(topic: string, socket: Socket): boolean {
    const sockets = this.byTopic.get(topic);
    if (!sockets?.delete(socket)) return false;
    if (sockets.size === 0) this.byTopic.delete(topic);

    const topics = this.bySocket.get(socket);
    if (topics) {
      topics.delete(topic);
      if (topics.size === 0) this.bySocket.delete(socket);
    }
    return true;
  }

  /**
   * Forget every subscription a socket holds (close / send failure / eviction).
   * Returns the topics it was subscribed to, so callers can decide whether a
   * resulting empty index entry needs cleaning up (it is already cleaned here).
   */
  removeSocket(socket: Socket): string[] {
    const topics = this.bySocket.get(socket);
    if (!topics) return [];
    this.bySocket.delete(socket);
    for (const topic of topics) {
      const sockets = this.byTopic.get(topic);
      if (!sockets) continue;
      sockets.delete(socket);
      if (sockets.size === 0) this.byTopic.delete(topic);
    }
    return [...topics];
  }

  /** Sockets that should receive an event for `topic`. Absent when nobody is subscribed. */
  subscribers(topic: string): ReadonlySet<Socket> | undefined {
    return this.byTopic.get(topic);
  }

  /** Subscriber count for one topic — used for metrics and tests. */
  subscriberCount(topic: string): number {
    return this.byTopic.get(topic)?.size ?? 0;
  }

  /** Topics one socket currently holds. */
  socketTopics(socket: Socket): ReadonlySet<string> | undefined {
    return this.bySocket.get(socket);
  }

  /** Number of distinct sockets with at least one subscription. */
  get socketCount(): number {
    return this.bySocket.size;
  }

  /** Number of distinct topics with at least one subscriber. */
  get topicCount(): number {
    return this.byTopic.size;
  }

  /** Total socket↔topic pairs (for leak/cache-size assertions in tests). */
  get referenceCount(): number {
    let total = 0;
    for (const sockets of this.byTopic.values()) total += sockets.size;
    return total;
  }

  clear(): void {
    this.byTopic.clear();
    this.bySocket.clear();
  }
}

/** One entry of a presence snapshot, exactly as the wire format expects. */
export interface PresenceEntry {
  id: string;
  name: string | null;
  avatar: string | null;
  connections: number;
}

export interface PresenceMeta {
  name: string | null;
  avatar: string | null;
}

/**
 * Build a presence snapshot from the user → sockets map plus cached display
 * metadata.
 *
 * Two things make this cheaper than the revision it replaces: it never calls
 * `deserializeAttachment()` (the metadata is cached in memory when a socket
 * joins), and it derives connection counts from the socket sets the DO already
 * maintains for multi-device cleanup instead of a second pass over every
 * socket.
 *
 * Ordering is first-seen, matching the previous snapshot's behaviour so the
 * client-side roster does not reshuffle between events.
 */
export function buildPresenceSnapshot<Socket extends IndexSocket>(
  socketsByUser: ReadonlyMap<string, ReadonlySet<Socket>>,
  meta: ReadonlyMap<string, PresenceMeta>,
): PresenceEntry[] {
  const users: PresenceEntry[] = [];
  for (const [userId, sockets] of socketsByUser) {
    if (sockets.size === 0) continue;
    const entry = meta.get(userId);
    users.push({
      id: userId,
      name: entry?.name ?? null,
      avatar: entry?.avatar ?? null,
      connections: sockets.size,
    });
  }
  return users;
}

/**
 * Stable, cheap signature of a presence snapshot. Used to skip a broadcast when
 * nothing changed, so an idle room does not re-serialize identical JSON for
 * every socket.
 */
export function presenceSignature(users: readonly PresenceEntry[]): string {
  let signature = "";
  for (const user of users) {
    signature += `${user.id}:${user.connections}:${user.name ?? ""}:${user.avatar ?? ""}|`;
  }
  return signature;
}

/**
 * Chunked iteration for the bounded fan-out in `/publish`. Kept here (pure) so
 * the concurrency behaviour is testable without a Worker.
 */
export async function runBoundedPool<T>(
  items: readonly T[],
  concurrency: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const poolSize = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;
  const workers = Array.from({ length: poolSize }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) continue;
      await work(item);
    }
  });
  await Promise.all(workers);
}
