/**
 * Module-level caches for community data.
 * These persist across client-side navigations (SPA) without needing
 * React context, Redux, or external libraries.
 */

import {
  invalidateRequest,
  patchCachedRequest,
  setCachedRequest,
} from "@/lib/request-cache";

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
  users: { name: string; avatar_url: string | null; designation?: string | null; company?: string | null } | null;
  status?: "sending" | "sent" | "failed";
  reactions?: MessageReaction[];
  reply_to?: ReplyPreview | null;
  image_url?: string | null;
  deleted_at?: string | null;
}

/** A thread-created event shown inline in the chat timeline. */
export interface CachedThreadEvent {
  id: string;           // thread id
  community_id: string;
  user_id: string;
  title: string;
  description: string;
  category: string;
  attachments: Array<{ name: string; url: string; type: string; size: number }>;
  created_at: string;
  users: { name: string; avatar_url: string | null } | null;
}

export interface CachedMeta {
  community: {
    id: string;
    name: string;
    type: string;
    member_count: number;
    image_url: string | null;
    is_private?: boolean;
    enabled_tabs?: string[];
    owner_id?: string | null;
    invite_token?: string | null;
    description?: string | null;
    created_at?: string;
  };
  members: {
    user_id: string;
    role?: string;
    users: { name: string; avatar_url: string | null; designation?: string | null; company?: string | null } | null;
  }[];
  fetchedAt: number;
}

// ─── Sidebar joined-communities cache ─────────────────────────────────────────

export interface SidebarLastReaction {
  /** Message that received the reaction. */
  messageId: string;
  emoji: string;
  /** Used to ignore delayed realtime responses for older reactions. */
  createdAt?: string;
  /** First name of the person who reacted (or "You" if isOwn). */
  firstName: string;
  isOwn: boolean;
  /** Content snippet of the message that was reacted to. */
  messagePreview: string;
}

/** A single chat subchannel within a user-created community. */
export interface CachedCommunityChannel {
  id: string;
  name: string;
  created_at: string;
}

export interface CachedSidebarCommunity {
  id: string;
  name: string;
  type: "city" | "sector" | "interest" | "company" | "experience_level" | "general" | "user";
  image_url: string | null;
  reference_name?: string | null;
  is_private?: boolean;
  enabled_tabs?: string[];
  owner_id?: string | null;
  created_at?: string | null;
  joined_at?: string | null;
  member_count: number;
  message_count: number;
  /** Hidden by this user until a new message arrives. */
  is_archived?: boolean;
  last_read_at?: string | null;
  /** Subchannels of a user-created community (empty/none for auto-created communities). */
  channels?: CachedCommunityChannel[];
  /** Most recent reaction event — shown in the preview instead of last_message when set. Cleared when a new message arrives. */
  lastReaction?: SidebarLastReaction | null;
  last_message: {
    id: string;
    content: string;
    created_at: string;
    user: { name: string } | null;
    /** True when the message was sent by the current user (preview shows "You:"). */
    is_own?: boolean;
    /** True when the message was soft-deleted after it became the last preview. */
    is_deleted?: boolean;
    /** True when the message is an image-only post (no text content). */
    has_image?: boolean;
    /** True when the message is a reply to another message. */
    is_reply?: boolean;
    /** First name of the user whose message was replied to. */
    reply_to_user?: string | null;
    /** Unique emoji strings that have been reacted to this message. */
    reactions?: string[];
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
  type: "city" | "sector" | "interest" | "company" | "experience_level" | "general" | "user";
  image_url: string | null;
  description: string | null;
  is_private?: boolean;
  member_count: number;
  joined: boolean;
  /** Whether the current user is allowed to join this community based on their profile. */
  can_join: boolean;
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
  lastReadAtOnOpen.clear();
  removedSidebarReactions.clear();
  inFlightMsgFetch.clear();
  inFlightMetaFetch.clear();
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
  invalidateRequest("/api/communities");
  notifySidebarChanged();
}

export function invalidateCommunitiesList(): void {
  sidebarStore.data     = null;
  sidebarStore.inflight = null;
  exploreStore.data     = null;
  exploreStore.inflight = null;
  invalidateRequest("/api/communities");
  notifySidebarChanged();
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
    setCachedRequest("/api/communities", {
      communities: sidebarStore.data.communities,
    });
  } else {
    invalidateRequest("/api/communities");
  }
  evictCommunityState(communityId);
  notifySidebarChanged();
}

/** Hide a community for this user while retaining the membership. */
/**
 * Surgically update fields on a single community in the sidebar store
 * (e.g. name, image_url after saving settings) without busting the whole cache.
 * Fires SIDEBAR_CHANGED_EVENT so the panel re-renders immediately.
 */
export function patchSidebarCommunity(
  communityId: string,
  patch: Partial<Pick<CachedSidebarCommunity, "name" | "image_url" | "is_private" | "enabled_tabs">>,
): void {
  if (sidebarStore.data) {
    sidebarStore.data = {
      ...sidebarStore.data,
      communities: sidebarStore.data.communities.map((c) =>
        c.id === communityId ? { ...c, ...patch } : c
      ),
    };
    patchCachedRequest<{ communities: CachedSidebarCommunity[] }>(
      "/api/communities",
      (current) => ({
        communities: current.communities.map((community) =>
          community.id === communityId ? { ...community, ...patch } : community
        ),
      }),
    );
  }
  notifySidebarChanged();
}

const removedSidebarReactions = new Map<string, number>();

function sidebarReactionKey(communityId: string, messageId: string): string {
  return `${communityId}:${messageId}`;
}

/** Marks a local removal so an older, still-pending Realtime lookup cannot restore it. */
export function markSidebarReactionRemoved(
  communityId: string,
  messageId: string,
): void {
  const now = Date.now();
  for (const [key, removedAt] of removedSidebarReactions) {
    if (now - removedAt > REACTION_TOMBSTONE_TTL_MS) {
      removedSidebarReactions.delete(key);
    }
  }
  while (removedSidebarReactions.size >= MAX_REACTION_TOMBSTONES) {
    const oldest = removedSidebarReactions.keys().next().value;
    if (!oldest) break;
    removedSidebarReactions.delete(oldest);
  }
  removedSidebarReactions.set(sidebarReactionKey(communityId, messageId), now);
}

/** Returns true when a Realtime reaction predates the latest local removal. */
export function isSidebarReactionStale(
  communityId: string,
  messageId: string,
  createdAt?: string,
): boolean {
  const removedAt = removedSidebarReactions.get(
    sidebarReactionKey(communityId, messageId),
  );
  if (!removedAt) return false;

  const reactionTime = createdAt ? Date.parse(createdAt) : Number.NaN;
  return Number.isNaN(reactionTime) || reactionTime <= removedAt;
}

/**
 * Optimistically updates a community's reaction preview in the shared sidebar
 * cache. The sidebar listens for this event, so chat actions render there in
 * the same frame instead of waiting for the database and Realtime round trip.
 */
export function patchSidebarReaction(
  communityId: string,
  lastReaction: SidebarLastReaction | null,
): void {
  if (lastReaction) {
    removedSidebarReactions.delete(
      sidebarReactionKey(communityId, lastReaction.messageId),
    );
  }
  if (!sidebarStore.data) return;

  sidebarStore.data = {
    ...sidebarStore.data,
    communities: sidebarStore.data.communities.map((community) =>
      community.id === communityId
        ? { ...community, lastReaction }
        : community
    ),
  };
  notifySidebarReactionChanged();
}

export function invalidateOnArchive(communityId: string): void {
  if (sidebarStore.data) {
    sidebarStore.data = {
      ...sidebarStore.data,
      communities: sidebarStore.data.communities.map((c) =>
        c.id === communityId ? { ...c, is_archived: true } : c
      ),
    };
  }
  evictCommunityState(communityId);
  notifySidebarChanged();
}

export const SIDEBAR_CHANGED_EVENT = "uxcommunity:sidebar-changed";
/**
 * Fired only for local reaction preview patches. Unlike SIDEBAR_CHANGED_EVENT
 * this must NOT trigger a server refetch: the cached /api/communities snapshot
 * predates the reaction, and reloading it would clobber the optimistic preview
 * (and any newer last_message) with stale rows.
 */
export const SIDEBAR_REACTION_CHANGED_EVENT = "uxcommunity:sidebar-reaction-changed";
/**
 * Fired only for local last-message patches (optimistic sends from the chat
 * window). Same constraints as SIDEBAR_REACTION_CHANGED_EVENT: no server
 * refetch, because the cached /api/communities snapshot predates the send.
 */
export const SIDEBAR_MESSAGE_CHANGED_EVENT = "uxcommunity:sidebar-message-changed";

function notifySidebarChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SIDEBAR_CHANGED_EVENT));
  }
}

function notifySidebarReactionChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SIDEBAR_REACTION_CHANGED_EVENT));
  }
}

function notifySidebarMessageChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SIDEBAR_MESSAGE_CHANGED_EVENT));
  }
}

/**
 * Optimistically updates a community's last-message preview in the shared
 * sidebar cache when the current user sends a message, so the community jumps
 * to the top of the list instantly instead of waiting for the Realtime echo
 * (DB insert → fan-out → WebSocket round trip). The Realtime echo, when it
 * arrives, replaces the optimistic preview with the authoritative row.
 *
 * Mirrors the change into the request cache so a sidebar refetch within the
 * stale window can't clobber the optimistic preview with an older snapshot.
 */
export function patchSidebarLastMessage(
  communityId: string,
  lastMessage: CachedSidebarCommunity["last_message"],
): void {
  const patch = (c: CachedSidebarCommunity): CachedSidebarCommunity => ({
    ...c,
    is_archived: false,
    lastReaction: null, // a new message supersedes any pending reaction preview
    last_message: lastMessage,
  });
  if (sidebarStore.data) {
    sidebarStore.data = {
      ...sidebarStore.data,
      communities: sidebarStore.data.communities.map((c) =>
        c.id === communityId ? patch(c) : c
      ),
    };
  }
  patchCachedRequest<{ communities: CachedSidebarCommunity[] }>(
    "/api/communities",
    (current) => ({
      communities: current.communities.map((community) =>
        community.id === communityId ? patch(community) : community
      ),
    }),
  );
  notifySidebarMessageChanged();
}

/**
 * Restores a community's sidebar entry to a previous snapshot — used to roll
 * back an optimistic last-message patch when a send fails (the message never
 * landed, so the preview must not show it).
 */
export function restoreSidebarEntry(
  communityId: string,
  entry: CachedSidebarCommunity,
): void {
  if (sidebarStore.data) {
    sidebarStore.data = {
      ...sidebarStore.data,
      communities: sidebarStore.data.communities.map((c) =>
        c.id === communityId ? entry : c
      ),
    };
  }
  patchCachedRequest<{ communities: CachedSidebarCommunity[] }>(
    "/api/communities",
    (current) => ({
      communities: current.communities.map((community) =>
        community.id === communityId ? entry : community
      ),
    }),
  );
  notifySidebarMessageChanged();
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

export const META_STALE_MS      = 5 * 60_000;
export const MSG_STALE_MS       = 3 * 60_000;
export const MAX_CACHE_ENTRIES  = 25;
const REACTION_TOMBSTONE_TTL_MS = 5 * 60_000;
const MAX_REACTION_TOMBSTONES   = 250;

/**
 * Composite key for per-message caches. Channels keep their own message
 * history, so the message cache (and its fetched-at / in-flight maps) is
 * keyed per channel. A null/undefined channel means the community's default
 * "general" chat, which shares the community key for backward compatibility.
 */
export function msgCacheKey(communityId: string, channelId?: string | null): string {
  return channelId ? `${communityId}:channel:${channelId}` : communityId;
}

class BoundedCommunityMap<T> extends Map<string, T> {
  override set(key: string, value: T): this {
    // Refresh insertion order so the first key remains the least recently written.
    super.delete(key);
    super.set(key, value);
    while (this.size > MAX_CACHE_ENTRIES) {
      const oldest = this.keys().next().value;
      if (!oldest) break;
      evictCommunityState(oldest);
    }
    return this;
  }
}

export const lastReadAtOnOpen = new Map<string, string | null>();
export const msgCache         = new BoundedCommunityMap<CachedMessage[]>();
export const metaCache        = new BoundedCommunityMap<CachedMeta>();
export const msgFetchedAt     = new Map<string, number>();
export const inFlightMsgFetch = new Map<string, Promise<void>>();
export const inFlightMetaFetch = new Map<string, Promise<void>>();

function evictCommunityState(communityId: string): void {
  for (const key of [...msgCache.keys()]) {
    if (key === communityId || key.startsWith(`${communityId}:channel:`)) msgCache.delete(key);
  }
  metaCache.delete(communityId);
  for (const key of [...msgFetchedAt.keys()]) {
    if (key === communityId || key.startsWith(`${communityId}:channel:`)) msgFetchedAt.delete(key);
  }
  lastReadAtOnOpen.delete(communityId);
  for (const key of [...inFlightMsgFetch.keys()]) {
    if (key === communityId || key.startsWith(`${communityId}:channel:`)) inFlightMsgFetch.delete(key);
  }
  inFlightMetaFetch.delete(communityId);
  for (const key of removedSidebarReactions.keys()) {
    if (key.startsWith(`${communityId}:`)) removedSidebarReactions.delete(key);
  }
}

export function evictIfNeeded(): void {
  // BoundedCommunityMap evicts synchronously on every write. Keep this export
  // for callers compiled against the previous cache API.
}
