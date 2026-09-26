/**
 * Unit tests for the client-publish security boundary.
 *
 * These pin the C-3 fix without a miniflare instance: what a member's socket is
 * allowed to publish, what a valid payload looks like, and that the broadcast
 * payload is rebuilt from the authenticated identity rather than echoed.
 *
 * The rule they enforce: a `publish` frame can only ever produce an ephemeral,
 * client-owned event. Server-authored topics (message, thread, comment, rule,
 * resource, showcase, notifications, …) are published by the API routes over
 * the secret-authenticated POST /publish path, never by a member.
 *
 * If these fail, a normal member can forge room content — including events that
 * make every recipient refetch from the database — so treat a failure here as a
 * release blocker, not a flaky test.
 */

import { describe, it, expect } from "vitest";
import {
  CLIENT_PUBLISHABLE_TOPICS,
  PublishRateLimiter,
  SOCKET_PUBLISH_BURST,
  SOCKET_PUBLISH_REFILL_PER_SECOND,
  USER_PUBLISH_BURST,
  USER_PUBLISH_REFILL_PER_SECOND,
  guardClientPublish,
  validateTypingPayload,
} from "../src/client-publish";

const identity = { userId: "member-1", name: "Member One" };

/** A payload shaped exactly like the one both clients send. */
function typingPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { user_id: "member-1", name: "Member One", typing: true, ts: Date.now(), ...overrides };
}

describe("CLIENT_PUBLISHABLE_TOPICS", () => {
  it("allows exactly the ephemeral topic a client actually publishes", () => {
    // `typing` is the only client-side publisher in the repository
    // (useTypingPresence in apps/web and the Expo app). Extending this list is
    // a deliberate act: each entry needs a validator below.
    expect([...CLIENT_PUBLISHABLE_TOPICS]).toEqual(["typing"]);
  });

  it.each([
    // chat
    "message",
    "message-edit",
    "message-delete",
    "reaction-insert",
    "reaction-update",
    "reaction-delete",
    "chat",
    // threads / comments
    "thread",
    "thread-update",
    "thread-delete",
    "thread-comment-count",
    "comment",
    "poll",
    // community content
    "event",
    "rsvp",
    "like",
    "save",
    "resource",
    "rule",
    "showcase",
    // user-scoped
    "insert",
    "update",
    // server frames / internals
    "presence",
    "presence_delta",
    "hello",
    "error",
    "",
  ])("rejects the server-owned topic %j", (topic) => {
    const decision = guardClientPublish(topic, typingPayload(), identity);

    expect(decision.ok).toBe(false);
    expect(decision.ok ? null : decision.reason).toBe("topic");
  });
});

describe("validateTypingPayload", () => {
  it("accepts the payload both clients send", () => {
    expect(validateTypingPayload(typingPayload())).toEqual({ typing: true, name: "Member One" });
  });

  it("accepts a payload without the optional fields", () => {
    expect(validateTypingPayload({ typing: false })).toEqual({ typing: false, name: null });
  });

  it.each([
    ["no data", undefined],
    ["null", null],
    ["a string", "typing"],
    ["a number", 1],
    ["an array", [{ typing: true }]],
    ["missing typing", { user_id: "member-1", name: "Member One", ts: 1 }],
    ["typing as a string", typingPayload({ typing: "true" })],
    ["typing as a number", typingPayload({ typing: 1 })],
    ["user_id as a number", typingPayload({ user_id: 42 })],
    ["name as an object", typingPayload({ name: { first: "Member" } })],
    ["ts as a string", typingPayload({ ts: "now" })],
    ["ts as NaN", typingPayload({ ts: Number.NaN })],
    ["ts as Infinity", typingPayload({ ts: Number.POSITIVE_INFINITY })],
    ["an unknown key", typingPayload({ extra: 1 })],
    ["server-owned sender identity", typingPayload({ sender: "someone-else" })],
    ["server-owned message id", typingPayload({ message_id: "msg-1" })],
    ["server-owned community id", typingPayload({ community_id: "community-1" })],
    ["an oversized name", typingPayload({ name: "n".repeat(121) })],
    ["an oversized user_id", typingPayload({ user_id: "u".repeat(65) })],
    ["more keys than the shape allows", { typing: true, a: 1, b: 2, c: 3, d: 4 }],
  ])("rejects %s", (_label, data) => {
    expect(validateTypingPayload(data)).toBeNull();
  });
});

describe("guardClientPublish", () => {
  it("accepts a valid typing publish", () => {
    const decision = guardClientPublish("typing", typingPayload(), identity);

    expect(decision.ok).toBe(true);
    expect(decision.ok ? decision.data : null).toEqual({
      user_id: "member-1",
      name: "Member One",
      typing: true,
    });
  });

  it("stamps identity from the socket instead of echoing the frame", () => {
    // The wire payload claims to be someone else; the broadcast must not.
    const decision = guardClientPublish(
      "typing",
      typingPayload({ user_id: "victim", name: "Victim" }),
      identity,
    );

    expect(decision.ok).toBe(true);
    expect(decision.ok ? decision.data : null).toEqual({
      user_id: "member-1",
      name: "Member One",
      typing: true,
    });
  });

  it("never forwards extra fields, timestamps included", () => {
    const decision = guardClientPublish("typing", typingPayload(), identity);

    expect(decision.ok).toBe(true);
    expect(Object.keys(decision.ok ? (decision.data as object) : {}).sort()).toEqual([
      "name",
      "typing",
      "user_id",
    ]);
  });

  it("falls back to the validated self-claimed name when the socket has none", () => {
    // The sidebar hook joins with name: null; the chat hook's payload carries
    // the display name, and it can only ever describe the sender.
    const decision = guardClientPublish("typing", typingPayload({ name: "Ada" }), {
      userId: "member-1",
      name: null,
    });

    expect(decision.ok ? decision.data : null).toEqual({
      user_id: "member-1",
      name: "Ada",
      typing: true,
    });
  });

  it("normalises an empty name to null", () => {
    const decision = guardClientPublish("typing", typingPayload({ name: "   " }), {
      userId: "member-1",
    });

    expect(decision.ok ? decision.data : null).toEqual({
      user_id: "member-1",
      name: null,
      typing: true,
    });
  });

  it("rejects a malformed payload on an allowed topic", () => {
    const decision = guardClientPublish("typing", { user_id: "member-1" }, identity);

    expect(decision.ok).toBe(false);
    expect(decision.ok ? null : decision.reason).toBe("payload");
  });

  it("reports the topic before the payload for a server-owned topic", () => {
    // A forged `comment` event is the amplification case (every recipient
    // refetches comments): it must be rejected as a topic, whatever it carries.
    const decision = guardClientPublish("comment", { thread_id: "t-1", body: "hi" }, identity);

    expect(decision.ok).toBe(false);
    expect(decision.ok ? null : decision.reason).toBe("topic");
  });
});

describe("PublishRateLimiter", () => {
  it("allows a burst up to its capacity, then refuses until it refills", () => {
    const limiter = new PublishRateLimiter<string>(3, 1);
    const now = 1_000_000;

    expect([1, 2, 3].map(() => limiter.allow("socket", now))).toEqual([true, true, true]);
    expect(limiter.allow("socket", now)).toBe(false);
    // One full second later a single token is available again.
    expect(limiter.allow("socket", now + 1000)).toBe(true);
    expect(limiter.allow("socket", now + 1000)).toBe(false);
  });

  it("never refills past the burst", () => {
    const limiter = new PublishRateLimiter<string>(2, 10);
    const now = 1_000_000;

    limiter.allow("socket", now);
    limiter.allow("socket", now);
    // A long idle period adds tokens back, but only up to the bucket size.
    expect(limiter.allow("socket", now + 60_000)).toBe(true);
    expect(limiter.allow("socket", now + 60_000)).toBe(true);
    expect(limiter.allow("socket", now + 60_000)).toBe(false);
  });

  it("keeps one bucket per key so one socket cannot spend another's budget", () => {
    const limiter = new PublishRateLimiter<string>(1, 0);
    const now = 1_000_000;

    expect(limiter.allow("a", now)).toBe(true);
    expect(limiter.allow("b", now)).toBe(true);
    expect(limiter.allow("a", now)).toBe(false);
  });

  it("drops state on release so the map tracks live keys, not traffic", () => {
    const limiter = new PublishRateLimiter<object>(1, 0);
    const first = {};
    const second = {};

    limiter.allow(first);
    limiter.allow(second);
    expect(limiter.size).toBe(2);

    limiter.release(first);
    expect(limiter.size).toBe(1);
    // A released key starts fresh (a reconnected socket is a new bucket).
    expect(limiter.allow(first)).toBe(true);
  });

  it("uses production budgets that cannot throttle a real typist", () => {
    // The client throttles itself to 1 frame/s (TYPING_THROTTLE_MS = 1000), so
    // ~4 frames/s per socket and 8 frames/s per user are pure headroom.
    expect(SOCKET_PUBLISH_REFILL_PER_SECOND).toBeGreaterThanOrEqual(3);
    expect(SOCKET_PUBLISH_BURST).toBeGreaterThanOrEqual(10);
    expect(USER_PUBLISH_REFILL_PER_SECOND).toBeGreaterThan(SOCKET_PUBLISH_REFILL_PER_SECOND);
    expect(USER_PUBLISH_BURST).toBeGreaterThan(SOCKET_PUBLISH_BURST);
  });
});
