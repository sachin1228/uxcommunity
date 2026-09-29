/**
 * Community membership authorization for the realtime room DO — fail-closed.
 *
 * WHY THIS EXISTS
 *   Deciding whether a connecting user may join a community room is a policy
 *   with its own lifetime, storage and failure mode: an in-memory LRU, a
 *   persisted `auth:*` re-check cache, a periodic sweep of the expired keys, and
 *   one bounded call to the internal membership API. It used to live inside the
 *   849-line community Durable Object next to presence coalescing and the
 *   fan-out index, where its three tuning constants, two counters and two cache
 *   layers were mixed into unrelated state.
 *
 *   This module is that policy, unchanged. The DO keeps the decision of WHEN to
 *   ask (`upgrade`, and not for sub-entity rooms); the authorizer answers it.
 *
 * FRESHNESS
 *   A membership answer is cached for `MEMBERSHIP_CACHE_TTL_MS` — in memory
 *   first (LRU, capped), then in DO storage so a hibernation does not force a
 *   re-check of the whole room. A cached entry that is past the TTL is ignored
 *   and re-fetched; expired storage keys are swept on a bounded page every
 *   `MEMBERSHIP_STORAGE_PRUNE_EVERY` API checks, because without a sweep a large
 *   community accumulated one permanent key per member forever.
 *
 * FAIL CLOSED
 *   Missing configuration (`API_URL` unset) and an unreachable API both DENY.
 *   The previous behaviour returned `true` when `API_URL` was unset, which
 *   silently disabled room authorization for every authenticated member.
 *
 * Storage keys (`auth:${communityId}:${userId}`) and the `{ ok, ts }` value shape
 * are part of the deployed format: a warm cache in a live DO is read by this
 * code, so neither may change without invalidating it.
 */

import type { Env } from "./env";
import type { RealtimeMetrics } from "./metrics";
import { resolveMembershipConfig } from "./membership-config";
import { logEvent } from "./log";

/** Membership re-check window and the cap on cached entries. */
const MEMBERSHIP_CACHE_TTL_MS = 60_000;
const MEMBERSHIP_CACHE_MAX_ENTRIES = 500;
/** Sweep expired `auth:*` storage keys every N membership API checks. */
const MEMBERSHIP_STORAGE_PRUNE_EVERY = 64;

/** How long the internal membership API may take before the check fails closed. */
const MEMBERSHIP_API_TIMEOUT_MS = 3000;

/** One cached authorization answer, in memory and in storage. */
interface MembershipCacheEntry {
  ok: boolean;
  ts: number;
}

/**
 * One warn per isolate when membership authorization is unconfigured. Repeated
 * per-connection logs would be noise; the aggregate counter and this line are
 * enough for an operator to spot the misconfiguration.
 */
let warnedMissingMembershipApi = false;

export interface MembershipAuthorizerDeps {
  /** Durable Object storage, for the persisted re-check cache. */
  storage: DurableObjectStorage;
  /** Worker bindings — `API_URL` and `API_SECRET`. */
  env: Env;
  /** Community this room belongs to — the membership subject. */
  communityId: string;
  /** Room name, used in log lines only. */
  roomName: string;
  /** The DO's counters. The authorizer increments them, never owns them. */
  metrics: RealtimeMetrics;
}

export class MembershipAuthorizer {
  /** Bounded membership authorization cache (in-memory LRU + pruned storage). */
  private cache = new Map<string, MembershipCacheEntry>();
  /** API checks performed, for the periodic storage sweep cadence. */
  private storageWrites = 0;

  constructor(private readonly deps: MembershipAuthorizerDeps) {}

  /** Cached entries currently held — exposed through the DO's `/stats`. */
  get cacheSize(): number {
    return this.cache.size;
  }

  /**
   * May this user join this community's room?
   *
   * Denies when the membership API is unconfigured or unreachable, and when the
   * API answers anything other than `{ ok: true }`.
   */
  async check(userId: string): Promise<boolean> {
    const { env, metrics } = this.deps;

    // FAIL CLOSED: without a membership API there is no way to authorize a
    // community room, so the connection is refused instead of granting access.
    const config = resolveMembershipConfig(env);
    if (!config.configured || !config.apiUrl) {
      if (!warnedMissingMembershipApi) {
        warnedMissingMembershipApi = true;
        logEvent("error", {
          event: "realtime.membership.config_missing",
          room: this.deps.roomName,
        });
      }
      return false;
    }

    const cacheKey = `${this.deps.communityId}:${userId}`;

    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < MEMBERSHIP_CACHE_TTL_MS) {
      metrics.membershipCacheHits += 1;
      // Refresh LRU position: the cache is capped, so a hot community with
      // thousands of connecting members must not evict its own active set.
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      return cached.ok;
    }
    if (cached) this.cache.delete(cacheKey);

    try {
      const stored = await this.deps.storage.get<MembershipCacheEntry>(`auth:${cacheKey}`);
      if (
        stored &&
        typeof stored.ok === "boolean" &&
        typeof stored.ts === "number" &&
        Date.now() - stored.ts < MEMBERSHIP_CACHE_TTL_MS
      ) {
        this.setCache(cacheKey, stored);
        metrics.membershipCacheHits += 1;
        return stored.ok;
      }
    } catch {
      // Storage read failed — fall through to the authoritative API check.
    }

    metrics.membershipChecks += 1;
    try {
      const response = await fetch(
        `${config.apiUrl}/api/communities/${this.deps.communityId}/members/${userId}/check`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${env.API_SECRET}`,
          },
          signal: AbortSignal.timeout(MEMBERSHIP_API_TIMEOUT_MS),
        },
      );

      let authorized = false;
      if (response.ok) {
        try {
          const body = await response.json() as { ok?: boolean };
          authorized = body.ok === true;
        } catch {
          authorized = false;
        }
      }

      this.setCache(cacheKey, { ok: authorized, ts: Date.now() });

      try {
        await this.deps.storage.put(`auth:${cacheKey}`, {
          ok: authorized,
          ts: Date.now(),
        });
        this.storageWrites += 1;
        if (this.storageWrites % MEMBERSHIP_STORAGE_PRUNE_EVERY === 0) {
          // Storage entries are only useful inside the TTL; without a sweep a
          // large community accumulated one permanent key per member forever.
          await this.pruneStorage();
        }
      } catch {
        // Storage write failed — not critical
      }

      return authorized;
    } catch (error) {
      // The API is unreachable: fail closed and make the cause observable.
      metrics.membershipChecksFailed += 1;
      logEvent("warn", {
        event: "realtime.membership.check_failed",
        community_id: this.deps.communityId,
        error,
      });
      this.cache.delete(cacheKey);
      return false;
    }
  }

  /** Insert into the bounded cache, evicting the oldest entry past the cap. */
  private setCache(cacheKey: string, value: MembershipCacheEntry): void {
    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, value);
    while (this.cache.size > MEMBERSHIP_CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
      this.deps.metrics.membershipCacheEvictions += 1;
    }
  }

  /** Delete expired `auth:*` keys (bounded page — the sweep repeats next cycle). */
  private async pruneStorage(): Promise<void> {
    try {
      const now = Date.now();
      const entries = await this.deps.storage.list<MembershipCacheEntry>({
        prefix: "auth:",
        limit: 256,
      });
      const expired: string[] = [];
      for (const [key, value] of entries) {
        const ts = typeof value?.ts === "number" ? value.ts : 0;
        if (now - ts >= MEMBERSHIP_CACHE_TTL_MS) expired.push(key);
      }
      if (expired.length > 0) await this.deps.storage.delete(expired);
    } catch {
      // Maintenance only — never fail a connection because cleanup failed.
    }
  }
}
