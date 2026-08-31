"use client";

/**
 * WebSocket connection pool for chat rooms.
 *
 * Instead of creating + destroying a WebSocket per community switch, the pool
 * keeps connections open for all joined communities. When the user switches
 * from Community A to Community B, B's WebSocket is already connected — no
 * HTTP upgrade request needed.
 *
 * One connection per community, shared across all subscribers. When the last
 * subscriber for a community detaches, the connection stays open (warm cache)
 * for COMMUNITY_IDLE_MS before closing. This avoids thrashing when the user
 * rapidly switches between the same few communities.
 */

import { RealtimeClient, type RealtimeUser } from "./client";
import { realtimeRooms } from "./rooms";

const COMMUNITY_IDLE_MS = 5 * 60_000; // 5 min idle before disconnect

interface PooledConnection {
  client: RealtimeClient;
  refCount: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

class RealtimePool {
  private connections = new Map<string, PooledConnection>();
  private user: RealtimeUser | null = null;

  /**
   * Initialize with the current user. Called once on sidebar mount.
   * Safe to call multiple times — only the first call takes effect.
   */
  init(user: RealtimeUser): void {
    if (!this.user) this.user = user;
  }

  /**
   * Get or create a WebSocket connection for a community chat room.
   * Increments the reference count. Caller MUST call `release()` when done.
   *
   * If `init()` hasn't been called yet (sidebar hasn't mounted), the caller
   * can pass a `user` fallback to lazily initialize the pool.
   */
  acquire(communityId: string, user?: RealtimeUser): RealtimeClient {
    if (!this.user && user) this.user = user;
    if (!this.user) {
      throw new Error("[realtime-pool] init() must be called before acquire()");
    }

    let pooled = this.connections.get(communityId);

    if (pooled) {
      // Cancel any pending idle disconnect
      if (pooled.idleTimer) {
        clearTimeout(pooled.idleTimer);
        pooled.idleTimer = null;
      }
      pooled.refCount++;
      return pooled.client;
    }

    // Create new connection
    const client = new RealtimeClient({
      room: realtimeRooms.chat(communityId),
      user: this.user,
    });
    client.connect();

    pooled = { client, refCount: 1, idleTimer: null };
    this.connections.set(communityId, pooled);
    return client;
  }

  /**
   * Release a reference to a community connection. When the last subscriber
   * detaches, the connection stays open for COMMUNITY_IDLE_MS before closing.
   */
  release(communityId: string): void {
    const pooled = this.connections.get(communityId);
    if (!pooled) return;

    pooled.refCount = Math.max(0, pooled.refCount - 1);

    if (pooled.refCount === 0 && !pooled.idleTimer) {
      pooled.idleTimer = setTimeout(() => {
        // Double-check refCount hasn't changed (race condition guard)
        const current = this.connections.get(communityId);
        if (current && current.refCount === 0) {
          current.client.close();
          this.connections.delete(communityId);
        }
      }, COMMUNITY_IDLE_MS);
    }
  }

  /**
   * Get an existing client without incrementing refCount (read-only access).
   * Returns null if no connection exists for this community.
   */
  peek(communityId: string): RealtimeClient | null {
    return this.connections.get(communityId)?.client ?? null;
  }

  /**
   * Close all connections. Called on logout.
   */
  destroyAll(): void {
    for (const [, pooled] of this.connections) {
      if (pooled.idleTimer) clearTimeout(pooled.idleTimer);
      pooled.client.close();
    }
    this.connections.clear();
    this.user = null;
  }
}

/**
 * Singleton pool shared across the entire app. One pool = one user session.
 *
 * We intentionally use a module-level singleton (not React context) because:
 * 1. Pool lifetime must survive React component mount/unmount cycles.
 * 2. Multiple components (sidebar, chat, threads) need the same pool.
 * 3. React context would create a new pool on every provider re-render.
 */
export const realtimePool = new RealtimePool();
