/**
 * The client → WebSocket → Durable Object publish boundary.
 *
 * WHY THIS EXISTS
 *   A member's socket could publish ANY topic into its room. The only check was
 *   "is this socket subscribed to that topic", so a `publish` frame was
 *   indistinguishable on the wire from a real server event: an ordinary member
 *   could forge a chat `message`, a `thread`, a `comment`, a `rule`, a
 *   `resource`, a `showcase` post or a notification `insert` and have it
 *   fanned out to the whole room.
 *
 *   Every persisted room event is produced by the API routes through the
 *   secret-authenticated `POST /publish` path, and those routes validate
 *   membership, ownership and content BEFORE writing to the database. A
 *   WebSocket publish bypassed all of it. The handlers on the receiving side
 *   act on the event, not on the database — the comment handlers refetch on
 *   every `comment` event (threads and showcase detail views) — so one forged
 *   frame from one member became one database read per recipient, repeatable at
 *   frame rate.
 *
 * WHAT IS ALLOWED
 *   Only the ephemeral presence a client genuinely owns: `typing` in a chat
 *   room. It is the only topic any client in this repository publishes
 *   (`useTypingPresence` in apps/web and in the Expo app); everything else is
 *   server-authored. Adding a topic here is the explicit, reviewable act that
 *   grants members the ability to publish it.
 *
 * WHAT A PUBLISH COSTS
 *   topic allow-list → payload shape → bounded token bucket → targeted
 *   fan-out. No database query, no cache read, no socket scan: the fan-out
 *   stays O(recipients) and the guard is a handful of string/typeof checks.
 *
 * WHAT IDENTITY MEANS
 *   The payload is a hint, never the event. The broadcast is rebuilt from the
 *   authenticated socket (the JWT-resolved `userId`) plus the display name that
 *   same socket supplied in its `join` frame, so a member can never make
 *   another member appear to be typing, and unknown keys, timestamps and
 *   message/community identifiers are dropped instead of forwarded.
 */

/**
 * Topics a connected member may publish over its own socket.
 *
 * Server-owned topics (`message`, `message-edit`, `message-delete`,
 * `reaction-*`, `thread`, `thread-update`, `thread-delete`,
 * `thread-comment-count`, `poll`, `event`, `rsvp`, `like`, `save`, `comment`,
 * `resource`, `rule`, `showcase`, `insert`, `update`, `chat`, `presence`, …)
 * are intentionally absent: they are published by the Worker's API routes with
 * `x-realtime-publish-secret` after the corresponding authorization.
 */
export const CLIENT_PUBLISHABLE_TOPICS: ReadonlySet<string> = new Set(["typing"]);

/**
 * Key set of a `typing` payload. Anything else is an attempt to inject a
 * server-owned field (`sender`, `message_id`, `community_id`, `sender_name`,
 * `avatar`, authorization flags, …) and is rejected rather than forwarded.
 */
const TYPING_PAYLOAD_KEYS: ReadonlySet<string> = new Set(["typing", "user_id", "name", "ts"]);

/** Bound on the self-claimed display name / id inside a `typing` payload. */
const MAX_TYPING_NAME_LENGTH = 120;
const MAX_TYPING_USER_ID_LENGTH = 64;

/**
 * Per-SOCKET budget.
 *
 * The client already throttles itself to one typing frame per second
 * (TYPING_THROTTLE_MS = 1000 in useTypingPresence), so a bucket that tolerates
 * a 12-frame burst and refills 4 tokens/s is 4× more generous than any real
 * typist and still cannot be used to hold a room under a flood.
 */
export const SOCKET_PUBLISH_BURST = 12;
export const SOCKET_PUBLISH_REFILL_PER_SECOND = 4;

/**
 * Per-USER budget, summed across that user's sockets.
 *
 * A per-socket limit alone is not a bound on a client that opens many sockets:
 * N tabs × burst would each get their own bucket. This is the shared ceiling —
 * one actively typing user (≈1 frame/s) or even 8 idle-tab typists fit, a
 * scripted fan-out of sockets does not.
 */
export const USER_PUBLISH_BURST = 24;
export const USER_PUBLISH_REFILL_PER_SECOND = 8;

export interface TypingPayload {
  typing: boolean;
  /** Self-claimed display name, when present — never trusted for identity. */
  name: string | null;
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

/**
 * Minimal shape of a client `typing` payload:
 *
 *   { typing: boolean, user_id?: string, name?: string, ts?: number }
 *
 * `typing` is the only meaningful value, and it is the only required field.
 * Missing/extra keys, wrong types, non-finite timestamps and oversized strings
 * are rejected; `user_id`/`name` are validated for size and then ignored — the
 * broadcast identity is stamped by the guard.
 */
export function validateTypingPayload(data: unknown): TypingPayload | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;

  const payload = data as Record<string, unknown>;
  const keys = Object.keys(payload);
  if (keys.length > TYPING_PAYLOAD_KEYS.size) return null;
  for (const key of keys) {
    if (!TYPING_PAYLOAD_KEYS.has(key)) return null;
  }

  if (typeof payload.typing !== "boolean") return null;
  if (payload.user_id !== undefined && !boundedString(payload.user_id, MAX_TYPING_USER_ID_LENGTH)) {
    return null;
  }
  if (payload.name !== undefined && !boundedString(payload.name, MAX_TYPING_NAME_LENGTH)) {
    return null;
  }
  if (payload.ts !== undefined && (typeof payload.ts !== "number" || !Number.isFinite(payload.ts))) {
    return null;
  }

  return { typing: payload.typing, name: typeof payload.name === "string" ? payload.name : null };
}

export type ClientPublishRejection = "topic" | "payload";

export type ClientPublishDecision =
  | { ok: true; data: unknown }
  | { ok: false; reason: ClientPublishRejection };

/**
 * Decide what a member's socket may publish into a Durable Object.
 *
 * Returns the exact payload to broadcast (never the client's object), or the
 * reason it is dropped. Rejection is silent by design: no error frame is sent
 * back, so a flood of rejected frames costs one counter increment each rather
 * than a response per frame.
 */
export function guardClientPublish(
  topic: string,
  data: unknown,
  identity: { userId: string; name?: string | null },
): ClientPublishDecision {
  if (!CLIENT_PUBLISHABLE_TOPICS.has(topic)) return { ok: false, reason: "topic" };

  if (topic === "typing") {
    const payload = validateTypingPayload(data);
    if (!payload) return { ok: false, reason: "payload" };

    // Identity is stamped, never echoed: the display name comes from this
    // socket's `join` frame when it has one (so the typing label matches the
    // presence roster), otherwise from the validated claim — which can only
    // ever describe the sender themselves.
    const name = identity.name ?? payload.name;
    const trimmed = typeof name === "string" ? name.trim() : "";

    return {
      ok: true,
      data: {
        user_id: identity.userId,
        name: trimmed ? trimmed.slice(0, MAX_TYPING_NAME_LENGTH) : null,
        typing: payload.typing,
      },
    };
  }

  // Unreachable while CLIENT_PUBLISHABLE_TOPICS has exactly one member; kept so
  // adding a topic without adding its validator fails closed.
  return { ok: false, reason: "topic" };
}

interface TokenBucket {
  tokens: number;
  updatedAt: number;
}

/**
 * Tiny token bucket that lives inside a Durable Object — no Redis, no storage,
 * no timers.
 *
 * State is exactly one entry per key and the caller owns the lifetime: keys are
 * released when their socket closes (and when a user's last socket closes), so
 * the map is bounded by the number of live sockets/users in the room rather
 * than by traffic.
 */
export class PublishRateLimiter<K> {
  private buckets = new Map<K, TokenBucket>();

  constructor(
    private readonly burst: number,
    private readonly refillPerSecond: number,
  ) {}

  /** Consume one token for `key`; false when the bucket is empty. */
  allow(key: K, now = Date.now()): boolean {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.burst, updatedAt: now };
      this.buckets.set(key, bucket);
    } else {
      const elapsedSeconds = (now - bucket.updatedAt) / 1000;
      if (elapsedSeconds > 0) {
        bucket.tokens = Math.min(this.burst, bucket.tokens + elapsedSeconds * this.refillPerSecond);
        bucket.updatedAt = now;
      }
    }

    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  /** Forget a key (socket closed, user left the room). */
  release(key: K): void {
    this.buckets.delete(key);
  }

  /** Live bucket count — exposed for tests and `/stats`. */
  get size(): number {
    return this.buckets.size;
  }
}
