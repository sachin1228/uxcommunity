/**
 * Module-level caches for community data.
 * These persist across client-side navigations (SPA) without needing
 * React context, Redux, or external libraries.
 */

export interface MessageReaction {
  emoji: string;
  user_ids: string[];
}

/** Snapshot of the message being replied to, embedded in the reply bubble. */
export interface ReplyPreview {
  id: string;
  content: string;
  user_name: string;
}

export interface CachedMessage {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
  users: { name: string; avatar_url: string | null } | null;
  status?: "sending" | "sent" | "failed";
  reactions?: MessageReaction[];
  reply_to?: ReplyPreview | null;
}

export interface CachedMeta {
  community: {
    id: string;
    name: string;
    type: string;
    member_count: number;
    image_url: string | null;
  };
  members: {
    user_id: string;
    users: { name: string; avatar_url: string | null } | null;
  }[];
  fetchedAt: number;
}

// ─── Sidebar joined-communities cache ─────────────────────────────────────────

export interface CachedSidebarCommunity {
  id: string;
  name: string;
  type: "city" | "sector" | "interest" | "company" | "experience_level";
  image_url: string | null;
  member_count: number;
  message_count: number;
  last_read_at?: string | null;
  last_message: {
    content: string;
    created_at: string;
    user: { name: string } | null;
  } | null;
}

export const sidebarStore: {
  data: { communities: CachedSidebarCommunity[]; fetchedAt: number } | null;
  inflight: Promise<void> | null;
} = { data: null, inflight: null };

export const SIDEBAR_STALE_MS = 60_000;

// ─── Explore Communities cache ────────────────────────────────────────────────

export interface CachedExploreCommunity {
  id: string;
  name: string;
  type: "city" | "sector" | "interest" | "company" | "experience_level";
  image_url: string | null;
  member_count: number;
  joined: boolean;
}

export const exploreStore: {
  data: { communities: CachedExploreCommunity[]; fetchedAt: number } | null;
  inflight: Promise<void> | null;
} = { data: null, inflight: null };

export const EXPLORE_STALE_MS = 5 * 60_000;

// ─── User-isolation helpers ───────────────────────────────────────────────────

export let cachedUserId: string | null = null;

export function initUserCache(userId: string): void {
  if (userId && cachedUserId !== userId) {
    clearAllUserCaches();
    cachedUserId = userId;
  }
}

export function clearAllUserCaches(): void {
  msgCache.clear();
  metaCache.clear();
  msgFetchedAt.clear();
  inFlightMsgFetch.clear();
  sidebarStore.data     = null;
  sidebarStore.inflight = null;
  exploreStore.data     = null;
  exploreStore.inflight = null;
  cachedUserId          = null;
}

// ─── Cache-invalidation helpers (join / leave) ────────────────────────────────

export function invalidateOnJoin(communityId: string): void {
  if (exploreStore.data) {
    exploreStore.data = {
      ...exploreStore.data,
      communities: exploreStore.data.communities.map((c) =>
        c.id === communityId ? { ...c, joined: true } : c
      ),
    };
  }
  sidebarStore.data     = null;
  sidebarStore.inflight = null;
}

export function invalidateOnLeave(communityId: string): void {
  if (exploreStore.data) {
    exploreStore.data = {
      ...exploreStore.data,
      communities: exploreStore.data.communities.map((c) =>
        c.id === communityId ? { ...c, joined: false } : c
      ),
    };
  }
  if (sidebarStore.data) {
    sidebarStore.data = {
      ...sidebarStore.data,
      communities: sidebarStore.data.communities.filter((c) => c.id !== communityId),
    };
  }
  msgCache.delete(communityId);
  metaCache.delete(communityId);
  msgFetchedAt.delete(communityId);
}

// ─── Reaction helpers ─────────────────────────────────────────────────────────

export function applyReactionInsert(
  reactions: MessageReaction[],
  emoji: string,
  userId: string,
): MessageReaction[] {
  const without = reactions.map((r) => ({
    ...r,
    user_ids: r.user_ids.filter((uid) => uid !== userId),
  })).filter((r) => r.user_ids.length > 0);

  const existing = without.find((r) => r.emoji === emoji);
  if (existing) {
    return without.map((r) =>
      r.emoji === emoji ? { ...r, user_ids: [...r.user_ids, userId] } : r
    );
  }
  return [...without, { emoji, user_ids: [userId] }];
}

export function applyReactionDelete(
  reactions: MessageReaction[],
  emoji: string,
  userId: string,
): MessageReaction[] {
  return reactions
    .map((r) =>
      r.emoji === emoji
        ? { ...r, user_ids: r.user_ids.filter((uid) => uid !== userId) }
        : r
    )
    .filter((r) => r.user_ids.length > 0);
}

// ─── Chat caches ──────────────────────────────────────────────────────────────

export const lastReadAtOnOpen = new Map<string, string | null>();
export const msgCache         = new Map<string, CachedMessage[]>();
export const metaCache        = new Map<string, CachedMeta>();
export const msgFetchedAt     = new Map<string, number>();
export const inFlightMsgFetch = new Map<string, Promise<void>>();
export const inFlightMetaFetch = new Map<string, Promise<void>>();

export const META_STALE_MS      = 5 * 60_000;
export const MSG_STALE_MS       = 3 * 60_000;
export const MAX_CACHE_ENTRIES  = 25;

export function evictIfNeeded(): void {
  while (msgCache.size > MAX_CACHE_ENTRIES) {
    const oldest = msgCache.keys().next().value;
    if (!oldest) break;
    msgCache.delete(oldest);
    msgFetchedAt.delete(oldest);
  }
  while (metaCache.size > MAX_CACHE_ENTRIES) {
    const oldest = metaCache.keys().next().value;
    if (!oldest) break;
    metaCache.delete(oldest);
  }
}
