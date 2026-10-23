/**
 * Persistent, bounded chat windows — what lets a cold start paint a
 * conversation instead of a spinner.
 *
 * Messaging clients keep a local store and treat the network as a delta on top
 * of it (WhatsApp's encrypted SQLite message store is the canonical example).
 * The in-memory bootstrap cache dies with the process, so every relaunch used
 * to refetch the whole first page before showing a row. This module is the
 * mobile app's local store: the newest window of each room is written through
 * to AsyncStorage and read back on mount while the existing bootstrap /
 * `?after=` catch-up reconciles it.
 *
 * Windows are capped and the server's 15-day retention is applied here too, so
 * the cache can never resurrect rows the sweep has deleted. Keys are scoped to
 * the signed-in member, so one account's rooms are never served to another.
 */

import { CHAT_MESSAGE_RETENTION_DAYS } from './chat';
import type { ChatContentEvent } from './chatContentEvents';
import type { Community, Message } from './communities';
import type { DmConversation, DmMessage } from './dm';

export const COMMUNITY_MESSAGE_CACHE_LIMIT = 120;
export const COMMUNITY_EVENT_CACHE_LIMIT = 60;
export const DM_MESSAGE_CACHE_LIMIT = 100;
/** The lists are snapshots for the first paint, not an offline database. */
export const COMMUNITY_LIST_CACHE_LIMIT = 200;
export const DM_CONVERSATION_LIST_CACHE_LIMIT = 100;
export const LIST_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How many room windows one member may keep on disk. Android's AsyncStorage
 * defaults to a 6 MB database, so the per-window caps alone are not enough for
 * a member who visits many rooms; the oldest window is evicted past this.
 */
export const MAX_CACHED_WINDOWS = 40;

const CACHE_PREFIX = '@chat-cache/v1';
const CACHE_VERSION = 1;
const RETENTION_MS = CHAT_MESSAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
/** Recency needs minute precision, not a write per incoming message. */
const INDEX_TOUCH_INTERVAL_MS = 60_000;

export interface ChatCacheStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys?(): Promise<readonly string[]>;
  multiRemove?(keys: readonly string[]): Promise<void>;
}

export interface ChatCacheOptions {
  /** Injected so retention can be tested without waiting 15 days. */
  now?: () => number;
  /** Injected so eviction can be tested without writing 41 windows. */
  maxCachedWindows?: number;
}

interface CachedWindow<T> {
  version: number;
  savedAt: number;
  rows: T[];
}

interface TimedRow {
  id: string;
  created_at: string;
}

function part(value: string): string {
  return encodeURIComponent(value);
}

export function communityMessagesCacheKey(userId: string, communityId: string): string {
  return `${CACHE_PREFIX}/u/${part(userId)}/community/${part(communityId)}/messages`;
}

export function communityEventsCacheKey(userId: string, communityId: string): string {
  return `${CACHE_PREFIX}/u/${part(userId)}/community/${part(communityId)}/events`;
}

export function dmMessagesCacheKey(userId: string, conversationId: string): string {
  return `${CACHE_PREFIX}/u/${part(userId)}/dm/${part(conversationId)}/messages`;
}

export function communityListCacheKey(userId: string): string {
  return `${CACHE_PREFIX}/u/${part(userId)}/list/communities`;
}

export function dmConversationListCacheKey(userId: string): string {
  return `${CACHE_PREFIX}/u/${part(userId)}/list/dm-conversations`;
}

function userIndexCacheKey(userId: string): string {
  return `${CACHE_PREFIX}/u/${part(userId)}/index`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMessageRow(value: unknown): value is Message {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.created_at === 'string' &&
    typeof value.user_id === 'string' &&
    (value.reactions === undefined || Array.isArray(value.reactions))
  );
}

function isDmMessageRow(value: unknown): value is DmMessage {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.created_at === 'string' &&
    typeof value.user_id === 'string'
  );
}

function isContentEventRow(value: unknown): value is ChatContentEvent {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.created_at === 'string' &&
    typeof value.user_id === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.title === 'string'
  );
}

function isCommunityRow(value: unknown): value is Community {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    // Group chats (city / event rooms) have no owner; the screens already
    // treat the field as optional.
    (value.owner_id === null || typeof value.owner_id === 'string') &&
    Array.isArray(value.enabled_tabs) &&
    typeof value.member_count === 'number' &&
    typeof value.unread_count === 'number'
  );
}

function isDmConversationRow(value: unknown): value is DmConversation {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isRecord(value.peer) &&
    typeof value.peer.id === 'string' &&
    typeof value.peer.name === 'string' &&
    typeof value.unread_count === 'number' &&
    typeof value.request_state === 'string'
  );
}

function compareTimedRows(a: TimedRow, b: TimedRow): number {
  const at = Date.parse(a.created_at);
  const bt = Date.parse(b.created_at);
  if (at !== bt) return at - bt;
  return a.id.localeCompare(b.id);
}

function latestWindow<T extends TimedRow>(
  rows: readonly T[],
  limit: number,
): T[] {
  return [...rows].sort(compareTimedRows).slice(-limit);
}

/**
 * Keep only rows the server can still hold: real (non-optimistic) rows inside
 * the retention window, in timeline order, capped to the newest N.
 */
function prepareWindow<T extends TimedRow>(
  rows: readonly T[],
  limit: number,
  now: number,
  retention: boolean,
): T[] {
  const cutoff = now - RETENTION_MS;
  return latestWindow(
    rows.filter((row) => {
      if (row.id.startsWith('temp-')) return false;
      const createdAt = Date.parse(row.created_at);
      if (!Number.isFinite(createdAt)) return false;
      return !retention || createdAt >= cutoff;
    }),
    limit,
  );
}

export interface ChatCache {
  /**
   * The member whose data may be read/written. `undefined` keeps the cache
   * unscoped (unit tests / tooling); the app sets a real id or null.
   */
  activateUser(userId: string | null): void;
  loadCommunityMessages(userId: string, communityId: string): Promise<Message[] | null>;
  saveCommunityMessages(userId: string, communityId: string, messages: readonly Message[]): Promise<void>;
  loadCommunityEvents(userId: string, communityId: string): Promise<ChatContentEvent[] | null>;
  saveCommunityEvents(
    userId: string,
    communityId: string,
    events: readonly ChatContentEvent[],
  ): Promise<void>;
  loadDmMessages(userId: string, conversationId: string): Promise<DmMessage[] | null>;
  saveDmMessages(userId: string, conversationId: string, messages: readonly DmMessage[]): Promise<void>;
  /** First-paint snapshots of the two lists (the live read still reconciles). */
  loadCommunityList(userId: string): Promise<Community[] | null>;
  saveCommunityList(userId: string, rows: readonly Community[]): Promise<void>;
  loadDmConversationList(userId: string): Promise<DmConversation[] | null>;
  saveDmConversationList(userId: string, rows: readonly DmConversation[]): Promise<void>;
  /** Drop every room window (sign-out). Best effort — never throws. */
  clearAll(userId?: string | null): Promise<void>;
}

export function createChatCache(
  storage: ChatCacheStorage,
  options: ChatCacheOptions = {},
): ChatCache {
  const now = options.now ?? Date.now;
  const maxCachedWindows = Math.max(1, options.maxCachedWindows ?? MAX_CACHED_WINDOWS);

  /**
   * The signed-in owner of this cache. Until auth adopts an identity (and
   * immediately after sign-out) nothing may be read or written: an unmounting
   * screen from the previous account must not repopulate the cache after the
   * sign-out sweep.
   */
  let activeUserId: string | null | undefined;
  function isUserActive(userId: string): boolean {
    return activeUserId === undefined || (activeUserId !== null && userId === activeUserId);
  }

  // AsyncStorage has no ordering guarantee across concurrent setItem calls,
  // and live chats change state in bursts (send + echo + reactions). Chain the
  // writes per key so the last state observed is the last state persisted.
  const writes = new Map<string, Promise<void>>();
  function write(key: string, operation: () => Promise<void>): Promise<void> {
    const previous = writes.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(operation)
      .catch(() => {});
    writes.set(key, next);
    return next.finally(() => {
      if (writes.get(key) === next) writes.delete(key);
    });
  }

  function writeIfActive(
    userId: string,
    key: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    return write(key, () => (isUserActive(userId) ? operation() : Promise.resolve()));
  }

  // ── Per-member window index (recency for eviction) ─────────────────────
  // Kept beside the windows so a cold start can still enforce the cap: the
  // keys alone carry no write time.
  const indexes = new Map<string, Record<string, number>>();
  const indexQueues = new Map<string, Promise<void>>();

  async function readUserIndex(userId: string): Promise<Record<string, number>> {
    const cached = indexes.get(userId);
    if (cached) return cached;

    const index: Record<string, number> = {};
    try {
      const raw = await storage.getItem(userIndexCacheKey(userId));
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (
        isRecord(parsed) &&
        parsed.version === CACHE_VERSION &&
        isRecord(parsed.rooms)
      ) {
        for (const [key, savedAt] of Object.entries(parsed.rooms)) {
          if (typeof savedAt === 'number' && Number.isFinite(savedAt)) {
            index[key] = savedAt;
          }
        }
      }
    } catch {
      // An unreadable index starts a fresh one; the windows themselves remain
      // readable and are re-indexed as they are saved.
    }
    indexes.set(userId, index);
    return index;
  }

  /** Serialize index read-modify-writes per member and evict the oldest windows. */
  function updateIndex(
    userId: string,
    mutate: (index: Record<string, number>) => boolean,
  ): Promise<void> {
    const previous = indexQueues.get(userId) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        if (!isUserActive(userId)) return;
        const index = await readUserIndex(userId);
        if (!mutate(index)) return;

        const byRecency = Object.entries(index).sort((a, b) => b[1] - a[1]);
        for (const [staleKey] of byRecency.slice(maxCachedWindows)) {
          delete index[staleKey];
          await storage.removeItem(staleKey);
        }
        await storage.setItem(
          userIndexCacheKey(userId),
          JSON.stringify({ version: CACHE_VERSION, rooms: index }),
        );
      })
      .catch(() => {});
    indexQueues.set(userId, next);
    return next.finally(() => {
      if (indexQueues.get(userId) === next) indexQueues.delete(userId);
    });
  }

  function touchWindow(userId: string, key: string): Promise<void> {
    return updateIndex(userId, (index) => {
      const savedAt = now();
      if (savedAt - (index[key] ?? 0) < INDEX_TOUCH_INTERVAL_MS) return false;
      index[key] = savedAt;
      return true;
    });
  }

  function dropWindow(userId: string, key: string): Promise<void> {
    return updateIndex(userId, (index) => {
      if (!(key in index)) return false;
      delete index[key];
      return true;
    });
  }

  async function readWindow<T extends TimedRow>(
    key: string,
    limit: number,
    isRow: (value: unknown) => value is T,
    retention: boolean,
  ): Promise<T[] | null> {    try {
      const raw = await storage.getItem(key);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (
        !isRecord(parsed) ||
        parsed.version !== CACHE_VERSION ||
        !Array.isArray(parsed.rows)
      ) {
        return null;
      }
      const rows = prepareWindow(
        parsed.rows.filter(isRow),
        limit,
        now(),
        retention,
      );
      return rows.length > 0 ? rows : null;
    } catch {
      // A corrupt or unreadable entry must never break a chat — the network
      // path below it still paints the room.
      return null;
    }
  }

  function saveWindow<T extends TimedRow>(
    userId: string,
    key: string,
    rows: readonly T[],
    limit: number,
    retention: boolean,
  ): Promise<void> {
    if (!isUserActive(userId)) return Promise.resolve();
    const prepared = prepareWindow(rows, limit, now(), retention);
    if (prepared.length === 0) {
      return Promise.all([
        writeIfActive(userId, key, () => storage.removeItem(key)),
        dropWindow(userId, key),
      ]).then(() => {});
    }
    const payload: CachedWindow<T> = {
      version: CACHE_VERSION,
      savedAt: now(),
      rows: prepared,
    };
    let serialized: string;
    try {
      serialized = JSON.stringify(payload);
    } catch {
      return Promise.resolve();
    }
    return Promise.all([
      writeIfActive(userId, key, () => storage.setItem(key, serialized)),
      touchWindow(userId, key),
    ]).then(() => {});
  }

  // ── Lists (communities / DM conversations) ─────────────────────────────
  // One row-window per member, no recency index: the first paint after a
  // launch is the only job, and a week-old snapshot is still a better frame
  // than a spinner while the live read lands.

  async function readList<T extends { id: string }>(
    key: string,
    limit: number,
    isRow: (value: unknown) => value is T,
  ): Promise<T[] | null> {
    try {
      const raw = await storage.getItem(key);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (
        !isRecord(parsed) ||
        parsed.version !== CACHE_VERSION ||
        typeof parsed.savedAt !== 'number' ||
        !Array.isArray(parsed.rows)
      ) {
        return null;
      }
      if (now() - parsed.savedAt > LIST_CACHE_TTL_MS) return null;
      const rows = parsed.rows.filter(isRow).slice(0, limit);
      return rows.length > 0 ? rows : null;
    } catch {
      return null;
    }
  }

  function saveList<T extends { id: string }>(
    userId: string,
    key: string,
    rows: readonly T[],
    limit: number,
  ): Promise<void> {
    if (!isUserActive(userId)) return Promise.resolve();
    const prepared = rows.slice(0, limit);
    if (prepared.length === 0) {
      return writeIfActive(userId, key, () => storage.removeItem(key));
    }
    let serialized: string;
    try {
      serialized = JSON.stringify({ version: CACHE_VERSION, savedAt: now(), rows: prepared });
    } catch {
      return Promise.resolve();
    }
    return writeIfActive(userId, key, () => storage.setItem(key, serialized));
  }

  return {
    activateUser(userId) {
      activeUserId = userId;
    },

    loadCommunityMessages(userId, communityId) {
      if (!userId || !communityId || !isUserActive(userId)) return Promise.resolve(null);
      return readWindow(
        communityMessagesCacheKey(userId, communityId),
        COMMUNITY_MESSAGE_CACHE_LIMIT,
        isMessageRow,
        true,
      );
    },

    saveCommunityMessages(userId, communityId, messages) {
      if (!userId || !communityId) return Promise.resolve();
      return saveWindow(
        userId,
        communityMessagesCacheKey(userId, communityId),
        messages,
        COMMUNITY_MESSAGE_CACHE_LIMIT,
        true,
      );
    },

    loadCommunityEvents(userId, communityId) {
      if (!userId || !communityId || !isUserActive(userId)) return Promise.resolve(null);
      return readWindow(
        communityEventsCacheKey(userId, communityId),
        COMMUNITY_EVENT_CACHE_LIMIT,
        isContentEventRow,
        // Cards are permanent timeline items, not part of the 15-day message
        // sweep — only the window size bounds them.
        false,
      );
    },

    saveCommunityEvents(userId, communityId, events) {
      if (!userId || !communityId) return Promise.resolve();
      return saveWindow(
        userId,
        communityEventsCacheKey(userId, communityId),
        events,
        COMMUNITY_EVENT_CACHE_LIMIT,
        false,
      );
    },

    loadDmMessages(userId, conversationId) {
      if (!userId || !conversationId || !isUserActive(userId)) return Promise.resolve(null);
      return readWindow(
        dmMessagesCacheKey(userId, conversationId),
        DM_MESSAGE_CACHE_LIMIT,
        isDmMessageRow,
        true,
      );
    },

    saveDmMessages(userId, conversationId, messages) {
      if (!userId || !conversationId) return Promise.resolve();
      return saveWindow(
        userId,
        dmMessagesCacheKey(userId, conversationId),
        messages,
        DM_MESSAGE_CACHE_LIMIT,
        true,
      );
    },

    loadCommunityList(userId) {
      if (!userId || !isUserActive(userId)) return Promise.resolve(null);
      return readList(
        communityListCacheKey(userId),
        COMMUNITY_LIST_CACHE_LIMIT,
        isCommunityRow,
      );
    },

    saveCommunityList(userId, rows) {
      if (!userId) return Promise.resolve();
      return saveList(userId, communityListCacheKey(userId), rows, COMMUNITY_LIST_CACHE_LIMIT);
    },

    loadDmConversationList(userId) {
      if (!userId || !isUserActive(userId)) return Promise.resolve(null);
      return readList(
        dmConversationListCacheKey(userId),
        DM_CONVERSATION_LIST_CACHE_LIMIT,
        isDmConversationRow,
      );
    },

    saveDmConversationList(userId, rows) {
      if (!userId) return Promise.resolve();
      return saveList(
        userId,
        dmConversationListCacheKey(userId),
        rows,
        DM_CONVERSATION_LIST_CACHE_LIMIT,
      );
    },

    async clearAll(userId) {
      // Scoped sign-out clears only that member's keys: a delayed cleanup must
      // never delete a newly signed-in member's freshly written cache.
      const scoped = typeof userId === 'string' && userId.length > 0;
      if (!scoped || activeUserId === userId) activeUserId = null;
      if (scoped) indexes.delete(userId);
      else indexes.clear();
      if (!storage.getAllKeys || !storage.multiRemove) return;
      try {
        const prefix = scoped ? `${CACHE_PREFIX}/u/${part(userId)}/` : `${CACHE_PREFIX}/`;
        const keys = (await storage.getAllKeys()).filter((key) =>
          key.startsWith(prefix),
        );
        if (keys.length > 0) await storage.multiRemove(keys);
      } catch {
        // Sign-out must not fail because local storage did.
      }
    },
  };
}
