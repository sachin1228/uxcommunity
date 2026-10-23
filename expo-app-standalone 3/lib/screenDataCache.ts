/**
 * Bounded, account-owned snapshots for first paint on the main mobile tabs.
 *
 * The storage interface is injected so the race rules can be tested without
 * React Native. Values are display hints only; screens still load their APIs
 * and the server remains the authority for access and mutations.
 */

export interface ScreenCacheStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface ScreenCacheSnapshot<T> {
  data: T;
  updatedAt: number;
  isFresh: boolean;
}

interface StoredEntry {
  updatedAt: number;
  expiresAt: number;
  data: unknown;
}

interface StoredEnvelope {
  version: 1;
  entries: Record<string, StoredEntry>;
}

interface MemoryEntry extends StoredEntry {
  touchedAt: number;
}

export interface ScreenCacheLimits {
  maxEntries: number;
  maxBytes: number;
  maxEntryBytes: number;
}

export const DEFAULT_SCREEN_CACHE_LIMITS: ScreenCacheLimits = {
  maxEntries: 10,
  maxBytes: 512 * 1024,
  maxEntryBytes: 256 * 1024,
};

export const SCREEN_CACHE_TTL_MS = {
  homeFeed: 2 * 60 * 1000,
  explore: 5 * 60 * 1000,
  jobs: 2 * 60 * 1000,
  ownProfile: 10 * 60 * 1000,
  profileFeed: 2 * 60 * 1000,
  memberFeed: 2 * 60 * 1000,
} as const;

const STORAGE_PREFIX = '@uxcommunity/screen-cache:v1:';

function ownerStorageKey(ownerId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(ownerId)}`;
}

function estimateBytes(value: string): number {
  // AsyncStorage stores UTF-8, but UTF-16 code units are a safe upper bound
  // for the JSON emitted here (including non-ASCII member content).
  return value.length * 2;
}

function parseEnvelope(raw: string | null): StoredEnvelope {
  if (!raw) return { version: 1, entries: {} };
  try {
    const value = JSON.parse(raw) as Partial<StoredEnvelope>;
    if (value.version !== 1 || !value.entries || typeof value.entries !== 'object') {
      return { version: 1, entries: {} };
    }
    const entries: Record<string, StoredEntry> = {};
    for (const [key, entry] of Object.entries(value.entries)) {
      if (
        entry &&
        typeof entry === 'object' &&
        typeof entry.updatedAt === 'number' &&
        typeof entry.expiresAt === 'number' &&
        Object.prototype.hasOwnProperty.call(entry, 'data')
      ) {
        entries[key] = entry as StoredEntry;
      }
    }
    return { version: 1, entries };
  } catch {
    return { version: 1, entries: {} };
  }
}

function trimEnvelope(
  entries: Record<string, StoredEntry>,
  limits: ScreenCacheLimits,
): Record<string, StoredEntry> {
  const ordered = Object.entries(entries).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  const retained: Record<string, StoredEntry> = {};
  for (const [key, entry] of ordered) {
    if (Object.keys(retained).length >= limits.maxEntries) continue;
    const candidate = { ...retained, [key]: entry };
    const serialized = JSON.stringify({ version: 1, entries: candidate });
    const entrySerialized = JSON.stringify(entry);
    if (
      estimateBytes(entrySerialized) > limits.maxEntryBytes ||
      estimateBytes(serialized) > limits.maxBytes
    ) {
      continue;
    }
    retained[key] = entry;
  }
  return retained;
}

/**
 * In-memory plus per-account persistent snapshots. Every read, fetch result,
 * and write is guarded by the currently active account and auth epoch.
 */
export class ScreenDataCache {
  private activeOwnerId: string | null = null;
  private activeEpoch = 0;
  private memory = new Map<string, MemoryEntry>();
  private revisions = new Map<string, number>();
  private ownerRevisions = new Map<string, number>();
  private inFlight = new Map<string, Promise<{ data: unknown; accepted: boolean }>>();
  private writeQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly storage: ScreenCacheStorage,
    private readonly now: () => number = Date.now,
    private readonly limits: ScreenCacheLimits = DEFAULT_SCREEN_CACHE_LIMITS,
  ) {}

  activateSession(ownerId: string | null, epoch: number): void {
    if (this.activeOwnerId === ownerId && this.activeEpoch === epoch) return;
    this.activeOwnerId = ownerId;
    this.activeEpoch = epoch;
    this.memory.clear();
  }

  peek<T>(ownerId: string | null, key: string, epoch: number, ttlMs: number): ScreenCacheSnapshot<T> | null {
    if (!this.isCurrent(ownerId, epoch)) return null;
    const entry = this.memory.get(this.identity(ownerId, key));
    if (!entry) return null;
    entry.touchedAt = this.now();
    return this.snapshot<T>(entry, ttlMs);
  }

  async read<T>(
    ownerId: string | null,
    key: string,
    epoch: number,
    ttlMs: number,
  ): Promise<ScreenCacheSnapshot<T> | null> {
    if (!this.isCurrent(ownerId, epoch)) return null;
    const identity = this.identity(ownerId, key);
    const inMemory = this.memory.get(identity);
    if (inMemory) {
      inMemory.touchedAt = this.now();
      return this.snapshot<T>(inMemory, ttlMs);
    }

    const ownerRevision = this.ownerRevisions.get(ownerId) ?? 0;
    const keyRevision = this.revisions.get(identity) ?? 0;
    let raw: string | null;
    try {
      raw = await this.storage.getItem(ownerStorageKey(ownerId));
    } catch {
      return null;
    }
    if (
      !this.isCurrent(ownerId, epoch) ||
      ownerRevision !== (this.ownerRevisions.get(ownerId) ?? 0) ||
      keyRevision !== (this.revisions.get(identity) ?? 0)
    ) {
      return this.peek<T>(ownerId, key, epoch, ttlMs);
    }

    const entry = parseEnvelope(raw).entries[key];
    if (!entry) return null;
    if (estimateBytes(JSON.stringify(entry)) > this.limits.maxEntryBytes) return null;
    const memoryEntry: MemoryEntry = { ...entry, touchedAt: this.now() };
    this.memory.set(identity, memoryEntry);
    this.trimMemory();
    return this.snapshot<T>(memoryEntry, ttlMs);
  }

  /** Store an authoritative result or a locally reconciled mutation result. */
  async write<T>(
    ownerId: string | null,
    key: string,
    epoch: number,
    data: T,
    ttlMs: number,
  ): Promise<boolean> {
    if (!this.isCurrent(ownerId, epoch)) return false;
    let serializedData: string;
    try {
      serializedData = JSON.stringify(data);
    } catch {
      return false;
    }
    if (estimateBytes(serializedData) > this.limits.maxEntryBytes) return false;

    const identity = this.identity(ownerId, key);
    const timestamp = this.now();
    const entry: MemoryEntry = {
      data,
      updatedAt: timestamp,
      expiresAt: timestamp + ttlMs,
      touchedAt: timestamp,
    };
    const revision = (this.revisions.get(identity) ?? 0) + 1;
    this.revisions.set(identity, revision);
    this.memory.set(identity, entry);
    this.trimMemory();
    const ownerRevision = this.ownerRevisions.get(ownerId) ?? 0;

    await this.enqueueWrite(ownerId, async () => {
      if (
        !this.isCurrent(ownerId, epoch) ||
        ownerRevision !== (this.ownerRevisions.get(ownerId) ?? 0) ||
        revision !== (this.revisions.get(identity) ?? 0)
      ) {
        return;
      }
      try {
        const current = parseEnvelope(await this.storage.getItem(ownerStorageKey(ownerId)));
        const entries = { ...current.entries, [key]: { ...entry, touchedAt: undefined } };
        const trimmed = trimEnvelope(entries, this.limits);
        await this.storage.setItem(
          ownerStorageKey(ownerId),
          JSON.stringify({ version: 1, entries: trimmed }),
        );
      } catch {
        // Persistence is best effort; the in-memory cache remains usable.
      }
    });
    return true;
  }

  /** Dedupe identical reads and reject responses superseded by a mutation. */
  fetch<T>(
    ownerId: string | null,
    key: string,
    epoch: number,
    ttlMs: number,
    load: () => Promise<T>,
    cacheData: (data: T) => unknown = (data) => data,
  ): Promise<{ data: T; accepted: boolean }> {
    if (!this.isCurrent(ownerId, epoch)) {
      return Promise.resolve({ data: undefined as T, accepted: false });
    }
    const identity = this.identity(ownerId, key);
    const revision = this.revisions.get(identity) ?? 0;
    const requestKey = `${identity}\u0000${epoch}\u0000${revision}`;
    const existing = this.inFlight.get(requestKey);
    if (existing) return existing as Promise<{ data: T; accepted: boolean }>;

    const request = (async () => {
      const data = await load();
      if (
        !this.isCurrent(ownerId, epoch) ||
        revision !== (this.revisions.get(identity) ?? 0)
      ) {
        return { data, accepted: false };
      }
      // Commit the in-memory snapshot synchronously, but let AsyncStorage
      // persistence finish after the screen receives its authoritative data.
      void this.write(ownerId, key, epoch, cacheData(data), ttlMs);
      return { data, accepted: true };
    })();
    const tracked = request.finally(() => {
      if (this.inFlight.get(requestKey) === tracked) this.inFlight.delete(requestKey);
    });
    this.inFlight.set(requestKey, tracked);
    return tracked;
  }

  /** Remove one key and invalidate every request that began before it. */
  async invalidate(ownerId: string, key: string): Promise<void> {
    const identity = this.identity(ownerId, key);
    this.revisions.set(identity, (this.revisions.get(identity) ?? 0) + 1);
    this.memory.delete(identity);
    await this.enqueueWrite(ownerId, async () => {
      try {
        const envelope = parseEnvelope(await this.storage.getItem(ownerStorageKey(ownerId)));
        delete envelope.entries[key];
        if (Object.keys(envelope.entries).length === 0) {
          await this.storage.removeItem(ownerStorageKey(ownerId));
        } else {
          await this.storage.setItem(ownerStorageKey(ownerId), JSON.stringify(envelope));
        }
      } catch {
        // A failed invalidation only leaves a stale display snapshot. API
        // authorization and every later mutation remain server controlled.
      }
    });
  }

  /** Clear one account without touching a different account's snapshots. */
  async clearOwner(ownerId: string | null): Promise<void> {
    if (!ownerId) return;
    this.ownerRevisions.set(ownerId, (this.ownerRevisions.get(ownerId) ?? 0) + 1);
    for (const key of [...this.memory.keys()]) {
      if (key.startsWith(`${ownerId}\u0000`)) this.memory.delete(key);
    }
    await this.enqueueWrite(ownerId, async () => {
      try {
        await this.storage.removeItem(ownerStorageKey(ownerId));
      } catch {
        // The per-account key and active-session guard still prevent a read
        // from another account; a later sign-in can retry cleanup.
      }
    });
  }

  /** Wait for queued persistence, primarily for deterministic lifecycle tests. */
  async flushWrites(ownerId: string): Promise<void> {
    await this.writeQueues.get(ownerId);
  }

  private snapshot<T>(entry: StoredEntry, ttlMs: number): ScreenCacheSnapshot<T> {
    return {
      data: entry.data as T,
      updatedAt: entry.updatedAt,
      isFresh: this.now() < Math.min(entry.expiresAt, entry.updatedAt + ttlMs),
    };
  }

  private isCurrent(ownerId: string | null, epoch: number): ownerId is string {
    return Boolean(ownerId) && this.activeOwnerId === ownerId && this.activeEpoch === epoch;
  }

  private identity(ownerId: string | null, key: string): string {
    return `${ownerId ?? ''}\u0000${key}`;
  }

  private trimMemory(): void {
    const oldestFirst = [...this.memory.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt);
    let bytes = oldestFirst.reduce((total, [, entry]) => total + estimateBytes(JSON.stringify(entry)), 0);
    let count = oldestFirst.length;
    while (count > this.limits.maxEntries || bytes > this.limits.maxBytes) {
      const oldest = oldestFirst.shift();
      if (!oldest) break;
      this.memory.delete(oldest[0]);
      bytes -= estimateBytes(JSON.stringify(oldest[1]));
      count -= 1;
    }
  }

  private enqueueWrite(ownerId: string, task: () => Promise<void>): Promise<void> {
    const previous = this.writeQueues.get(ownerId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(task).catch(() => {});
    this.writeQueues.set(ownerId, next);
    void next.finally(() => {
      if (this.writeQueues.get(ownerId) === next) this.writeQueues.delete(ownerId);
    });
    return next;
  }
}

/** Append a keyset page without duplicating rows already painted from cache. */
export function mergeUniquePage<T>(
  current: T[],
  next: T[],
  keyOf: (item: T) => string,
): T[] {
  const seen = new Set(current.map(keyOf));
  return [...current, ...next.filter((item) => !seen.has(keyOf(item)))];
}
