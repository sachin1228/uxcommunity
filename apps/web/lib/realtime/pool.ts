"use client";

/**
 * Room subscription pool backed by the multiplexed RealtimeClient singleton.
 *
 * Architecture:
 *   acquire(communityId) → creates a WebSocket to CommunityDO, subscribes to rooms
 *   release(communityId) → decrements refcount, closes idle connections
 *
 * Community-scoped rooms (chat:*, threads:*, events:*, resources:*, showcase:*, rules:*)
 * each get their own WebSocket to the CommunityDO.
 *
 * User-scoped rooms (notifications:*, profile:*) share a connection to UserDO.
 */

import { realtimeClient, type RealtimeUser } from "./client";
import { realtimeRooms } from "./rooms";

const COMMUNITY_IDLE_MS = 5 * 60_000;

interface PooledSubscription {
  refCount: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

class RealtimePool {
  private subscriptions = new Map<string, PooledSubscription>();
  private initialized = false;

  init(user: RealtimeUser): void {
    if (!this.initialized) {
      realtimeClient.init(user);
      this.initialized = true;
    }
  }

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

    // Subscribe to the chat room for this community
    // This will create a WebSocket to CommunityDO
    const room = realtimeRooms.chat(communityId);
    realtimeClient.subscribe(room);
    realtimeClient.connect();

    pooled = { refCount: 1, idleTimer: null };
    this.subscriptions.set(communityId, pooled);
    return realtimeClient;
  }

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

  peek(_communityId?: string): typeof realtimeClient | null {
    return this.initialized ? realtimeClient : null;
  }

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

export const realtimePool = new RealtimePool();
