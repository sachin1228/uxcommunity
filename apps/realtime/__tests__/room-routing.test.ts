/**
 * Routing contract tests for room → Durable Object resolution.
 *
 * These pin the fix for a silent delivery bug: user-scoped rooms
 * (`notifications:${userId}`) published into the COMMUNITY_DO namespace, so the
 * event landed in a Durable Object no socket had ever connected to. The caller
 * still received "ok", so the only symptom was that notification updates never
 * arrived in realtime and every client quietly fell back to its periodic
 * refetch.
 *
 * If these fail, realtime delivery for notifications is broken even though
 * every publish reports success.
 */

import { describe, it, expect } from "vitest";
import {
  isUserScopedRoomAllowed,
  resolveRoomTarget,
  USER_ROOM_PREFIXES,
  type RoomRoutingBindings,
} from "../src/room-routing";

/** Minimal stand-in for the Worker's DO bindings — routing only reads identity. */
function bindings(): RoomRoutingBindings & { calls: string[] } {
  const calls: string[] = [];
  const ns = (label: string) =>
    ({
      idFromName: (name: string) => {
        calls.push(`${label}:${name}`);
        return { name, toString: () => `${label}:${name}` } as unknown as DurableObjectId;
      },
    }) as unknown as DurableObjectNamespace;

  return { COMMUNITY_DO: ns("community"), USER_DO: ns("user"), calls };
}

describe("resolveRoomTarget", () => {
  it("routes notifications:<userId> to that user's UserDO instance", () => {
    const env = bindings();
    const target = resolveRoomTarget(env, "notifications:8f14e45f-ceea-467a-9a3c-1b1d3e2f4a5b");

    expect(target.namespace).toBe(env.USER_DO);
    expect(target.name).toBe("user:8f14e45f-ceea-467a-9a3c-1b1d3e2f4a5b");
  });

  it("routes profile:<userId> to that user's UserDO instance", () => {
    const env = bindings();
    const target = resolveRoomTarget(env, "profile:user-42");

    expect(target.namespace).toBe(env.USER_DO);
    expect(target.name).toBe("user:user-42");
  });

  it("routes dm:<userId> to that user's UserDO instance", () => {
    // The DM stream is one logical room per user, multiplexed over the same
    // user socket as notifications — not a room per conversation.
    const env = bindings();
    const target = resolveRoomTarget(env, "dm:8f14e45f-ceea-467a-9a3c-1b1d3e2f4a5b");

    expect(target.namespace).toBe(env.USER_DO);
    expect(target.name).toBe("user:8f14e45f-ceea-467a-9a3c-1b1d3e2f4a5b");
  });

  it("accepts an already-resolved user:<userId> room", () => {
    const env = bindings();
    const target = resolveRoomTarget(env, "user:user-42");

    expect(target.namespace).toBe(env.USER_DO);
    expect(target.name).toBe("user:user-42");
  });

  it.each([
    "chat:community-1",
    "threads:community-1",
    "thread-comments:thread-1",
    "events:community-1",
    "resources:community-1",
    "resource-comments:resource-1",
    "showcase:post-1",
    "rules:community-1",
    "presence:community-1",
  ])("leaves community room %s alone", (room) => {
    const env = bindings();
    const target = resolveRoomTarget(env, room);

    expect(target.namespace).toBe(env.COMMUNITY_DO);
    expect(target.name).toBe(room);
  });

  it("never sends two different users to the same instance", () => {
    const env = bindings();
    const a = resolveRoomTarget(env, "notifications:user-a");
    const b = resolveRoomTarget(env, "notifications:user-b");

    expect(a.name).not.toBe(b.name);
  });

  it("falls back to the community namespace when a user room has no id", () => {
    const env = bindings();
    const target = resolveRoomTarget(env, "notifications:");

    expect(target.namespace).toBe(env.COMMUNITY_DO);
    expect(target.name).toBe("notifications:");
  });

  it("covers exactly the user-scoped prefixes the server publishes", () => {
    // Guards against a new user-scoped room being added in the web app without
    // extending the routing prefixes — the symptom would be silent non-delivery.
    expect([...USER_ROOM_PREFIXES]).toEqual(["notifications:", "profile:", "dm:"]);
  });
});

/**
 * The upgrade gate: user-scoped rooms may only be opened for the caller's own
 * instance. Before this check, a socket could connect with
 * `room=user:<victim>` and subscribe to that member's notifications/DM stream —
 * the DO instance is the only access boundary these rooms have.
 */
describe("isUserScopedRoomAllowed", () => {
  const ME = "user-me";

  it("allows the caller's own user instance", () => {
    expect(isUserScopedRoomAllowed("user:user-me", ME)).toBe(true);
  });

  it("rejects another member's user instance", () => {
    expect(isUserScopedRoomAllowed("user:user-victim", ME)).toBe(false);
  });

  it("allows the caller's own logical rooms", () => {
    expect(isUserScopedRoomAllowed("notifications:user-me", ME)).toBe(true);
    expect(isUserScopedRoomAllowed("profile:user-me", ME)).toBe(true);
    expect(isUserScopedRoomAllowed("dm:user-me", ME)).toBe(true);
  });

  it("rejects logical rooms addressed to someone else", () => {
    expect(isUserScopedRoomAllowed("notifications:user-victim", ME)).toBe(false);
    expect(isUserScopedRoomAllowed("dm:user-victim", ME)).toBe(false);
  });

  it("rejects a suffix scam hiding behind the prefix", () => {
    // `dm:user-me:extra` must not pass a bare startsWith comparison.
    expect(isUserScopedRoomAllowed("dm:user-me:extra", ME)).toBe(false);
    expect(isUserScopedRoomAllowed("user:user-me:extra", ME)).toBe(false);
  });

  it("rejects the pre-identity placeholder socket", () => {
    // The client opens `user:global` only pre-init; it can never belong to a
    // real user and was a wasted handshake — now it is refused outright.
    expect(isUserScopedRoomAllowed("user:global", ME)).toBe(false);
  });

  it("leaves community-scoped rooms to their own authorization", () => {
    expect(isUserScopedRoomAllowed("chat:community-1", ME)).toBe(true);
    expect(isUserScopedRoomAllowed("thread-comments:thread-1", ME)).toBe(true);
  });
});
