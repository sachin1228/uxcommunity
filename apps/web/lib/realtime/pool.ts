"use client";

/**
 * Room subscription pool backed by the multiplexed RealtimeClient singleton.
 *
 * With Option C (single community DO with logical topics), one WebSocket
 * handles all rooms. The pool is a thin reference-counting layer:
 *
 *   acquire(communityId) → subscribes to the room, returns the singleton
 *   release(communityId) → decrements refcount, unsubscribes when zero
 *
 * Connection lifecycle:
 *   - subscribe() → Worker forwards upgrade to community DO
 *   - release() with refCount=0 → unsubscribes from room after idle timeout
 */

import { realtimeClient, type RealtimeUser } from "./client";
import { realtimeRooms } from "./rooms";

const COMMUNITY_IDLE_MS = 5 * 60_000; // 5 min idle before unsubscribe

interface PooledSubscription {
  refCount: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

class RealtimePool {
  private subscriptions = new Map<string, PooledSubscription>();
  private initialized = false;

  /**
   * Initialize with the current user. Called once on sidebar mount.
   */
  init(user: RealtimeUser): void {
    if (!this.initialized) {
      realtimeClient.init(user);
      this.initialized = true;
    }
  }

  /**
   * Subscribe to a community's chat room and return the shared client.
   * Increments the reference count. Caller MUST call `release()` when done.
   */
  acquire(communityId: string, user?: RealtimeUser): typeof realtimeClient {
    if (!this.initialized && user) this.init(user);
    if (!this.initialized) {
      throw new Error("[realtime-pool] init() must be called before acquire()");
    }

    let pooled = this.subscriptions.get(communityId);

    if (pooled) {
      if (pooled.idleTimer) {
        clearTimeout(pooled.idleTimer);
        pooled.idleTimer = null;
      }
      pooled.refCount++;
      return realtimeClient;
    }

    // Subscribe to the community's chat room via the singleton
    const room = realtimeRooms.chat(communityId);
    realtimeClient.subscribe(room);
    realtimeClient.connect(room);

    pooled = { refCount: 1, idleTimer: null };
    this.subscriptions.set(communityId, pooled);
    return realtimeClient;
  }

  /**
   * Release a reference. When the last subscriber detaches, the subscription
   * stays active for COMMUNITY_IDLE_MS before unsubscribing.
   */
  release(communityId: string): void {
    const pooled = this.subscriptions.get(communityId);
    if (!pooled) return;

    pooled.refCount = Math.max(0, pooled.refCount - 1);

    if (pooled.refCount === 0 && !pooled.idleTimer) {
      pooled.idleTimer = setTimeout(() => {
        const current = this.subscriptions.get(communityId);
        if (current && current.refCount === 0) {
          const room = realtimeRooms.chat(communityId);
          realtimeClient.unsubscribe(room);
          this.subscriptions.delete(communityId);
        }
      }, COMMUNITY_IDLE_MS);
    }
  }

  /**
   * Get the shared client (read-only access).
   */
  peek(_communityId?: string): typeof realtimeClient | null {
    return this.initialized ? realtimeClient : null;
  }

  /**
   * Unsubscribe from all rooms and reset. Called on logout.
   */
  destroyAll(): void {
    for (const [communityId, pooled] of this.subscriptions) {
      if (pooled.idleTimer) clearTimeout(pooled.idleTimer);
      const room = realtimeRooms.chat(communityId);
      realtimeClient.unsubscribe(room);
    }
    this.subscriptions.clear();
    realtimeClient.destroy();
    this.initialized = false;
  }
}

/**
 * Singleton pool shared across the entire app.
 */
export const realtimePool = new RealtimePool();
