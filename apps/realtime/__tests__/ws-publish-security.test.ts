/**
 * End-to-end tests for the client → WebSocket → Durable Object publish boundary
 * (C-3).
 *
 * The vulnerability these lock down: a member's socket may publish ANY topic
 * into its room. The only check was "is this socket subscribed to that topic",
 * so one frame could forge a chat message, a thread, a comment, a rule, a
 * resource or a showcase post and have it fanned out to the whole room — while
 * the real versions of those events are produced by the API routes over the
 * secret-authenticated POST /publish path, after membership/ownership checks.
 * The receiving side acts on what it is told (the comment views refetch on
 * every `comment` event), so a forged frame became one database read per
 * recipient, repeatable at frame rate.
 *
 * What must be true after the fix:
 *   - `typing` (the only topic a client in this repo publishes) still works,
 *     sender-excluded, with a server-stamped identity;
 *   - every server-owned topic is rejected and never broadcast, while the
 *     server's own publishes to those same topics keep working;
 *   - malformed/oversized/extra-field payloads are rejected before fan-out;
 *   - one socket and one user cannot hold a room under a flood, and throttling
 *     does not affect other clients, other rooms, or server events;
 *   - the same rules hold on the user-scoped socket (UserDO), whose rooms carry
 *     server-published notifications.
 *
 * Run: npx vitest run __tests__/ws-publish-security.test.ts --reporter=verbose
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SOCKET_PUBLISH_BURST, USER_PUBLISH_BURST } from "../src/client-publish";
import {
  startHarness,
  sleep,
  closeAll,
  type Conn,
  type Harness,
} from "./helpers/realtime-harness";

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
}, 60_000);

afterAll(async () => {
  await harness?.stop();
});

/** Send a client `publish` frame exactly like the browser client does. */
function clientPublish(conn: Conn, room: string, topic: string, data: unknown): void {
  conn.ws.send(JSON.stringify({ t: "publish", room, topic, data }));
}

/** Event frames this socket received for `topic`. */
function events(conn: Conn, topic: string): Array<Record<string, any>> {
  return conn.messages.filter((m) => m.t === "event" && m.topic === topic);
}

/** A payload shaped exactly like the one both real clients send. */
function typingPayload(userId: string, overrides: Record<string, unknown> = {}) {
  return { user_id: userId, name: "Someone", typing: true, ts: Date.now(), ...overrides };
}

/** Join + subscribe one socket to several topics, then wait for the DO to hold them. */
async function subscribeMany(conn: Conn, room: string, topics: string[]): Promise<void> {
  for (const topic of topics) harness.subscribe(conn, room, topic);
  await harness.waitForRefs(room, topics.length, 30_000);
}

describe("client publish: allowed ephemeral topic", () => {
  it("delivers a member's typing to peers, never to the sender, with a stamped identity", async () => {
    const room = "chat:sec_allow";
    const [sender, peer] = await harness.connectBatch("sec_allow", 2, room, "typing");

    try {
      // The frame claims to be somebody else (its own display name included).
      clientPublish(sender, room, "typing", typingPayload("victim-id", { name: "Victim Name" }));
      await sleep(600);

      const received = events(peer, "typing");
      expect(received.length).toBe(1);
      // Identity is stamped from the authenticated socket, not echoed.
      expect(received[0].data.user_id).toBe(sender.userId);
      // The join-frame name wins over the claim in the frame.
      expect(received[0].data.name).toBe(sender.userId);
      expect(received[0].data.typing).toBe(true);
      // No smuggled field and no client timestamp is forwarded.
      expect(Object.keys(received[0].data).sort()).toEqual(["name", "typing", "user_id"]);

      // The sender never receives its own event.
      expect(events(sender, "typing").length).toBe(0);

      // Presence is untouched by any of this.
      expect(peer.messages.some((m) => m.t === "presence")).toBe(true);
    } finally {
      closeAll([sender, peer]);
    }
  });
});

describe("client publish: server-owned topics", () => {
  // Every topic the API routes publish in this repository, plus the internal
  // server frames a client must never be able to emit.
  const SERVER_TOPICS = [
    "message",
    "message-edit",
    "message-delete",
    "reaction-insert",
    "reaction-update",
    "reaction-delete",
    "thread",
    "thread-update",
    "thread-delete",
    "thread-comment-count",
    "comment",
    "poll",
    "event",
    "rsvp",
    "like",
    "save",
    "resource",
    "rule",
    "showcase",
    "insert",
    "update",
    "chat",
    "presence",
  ];

  it("rejects every one of them and broadcasts nothing", async () => {
    const room = "chat:sec_topics";
    const observer = await harness.connect(room, "sec_topics_observer");
    const attacker = await harness.connect(room, "sec_topics_attacker");

    try {
      await subscribeMany(observer, room, SERVER_TOPICS);
      await subscribeMany(attacker, room, SERVER_TOPICS);

      const before = await harness.stats(room);
      for (const topic of SERVER_TOPICS) {
        clientPublish(attacker, room, topic, {
          text: "forged",
          body: "forged",
          id: "forged",
          messageId: "forged",
        });
      }
      await sleep(600);

      // Nothing was fanned out — not to the observer, not to the attacker.
      for (const topic of SERVER_TOPICS) {
        expect(events(observer, topic).length).toBe(0);
        expect(events(attacker, topic).length).toBe(0);
      }

      // The DO refused them all at the topic gate.
      const after = await harness.stats(room);
      expect(after.instanceId).toBe(before.instanceId);
      expect(after.metrics.clientPublishRejectedTopic - before.metrics.clientPublishRejectedTopic).toBe(
        SERVER_TOPICS.length,
      );
      expect(after.metrics.clientPublishesAccepted - before.metrics.clientPublishesAccepted).toBe(0);

      // The server's own publishes to those very topics still arrive.
      const { status } = await harness.publish(room, "message", { text: "real" });
      expect(status).toBe(200);
      await sleep(400);
      expect(events(observer, "message").length).toBe(1);
      expect(events(attacker, "message").length).toBe(1);
      expect(events(observer, "message")[0].data.text).toBe("real");
    } finally {
      closeAll([observer, attacker]);
    }
  });
});

describe("client publish: payload validation", () => {
  it("rejects malformed, oversized and server-owned-looking payloads before fan-out", async () => {
    const room = "chat:sec_payload";
    const [attacker, observer] = await harness.connectBatch("sec_payload", 2, room, "typing");

    try {
      const invalidPayloads: unknown[] = [
        undefined, // frame without `data`
        null,
        "typing", // not an object
        42,
        [],
        [{ typing: true }],
        { user_id: "x", name: "X", ts: Date.now() }, // missing typing
        { typing: "true" }, // wrong type
        { typing: 1 },
        { typing: true, ts: "now" }, // wrong timestamp type
        { typing: true, ts: Number.POSITIVE_INFINITY },
        { typing: true, sender: "someone-else" }, // server-owned identity
        { typing: true, message_id: "msg-1" }, // server-owned id
        { typing: true, community_id: "community-1" }, // server-owned id
        { typing: true, name: "n".repeat(5000) }, // oversized string
        { typing: true, user_id: "u".repeat(300) },
        { typing: true, a: 1, b: 2, c: 3, d: 4 }, // more keys than the shape allows
      ];

      const before = await harness.stats(room);
      for (const data of invalidPayloads) clientPublish(attacker, room, "typing", data);
      await sleep(600);

      expect(events(observer, "typing").length).toBe(0);
      expect(events(attacker, "typing").length).toBe(0);

      const after = await harness.stats(room);
      expect(after.instanceId).toBe(before.instanceId);
      expect(
        after.metrics.clientPublishRejectedPayload - before.metrics.clientPublishRejectedPayload,
      ).toBe(invalidPayloads.length);
      expect(after.metrics.clientPublishesAccepted - before.metrics.clientPublishesAccepted).toBe(0);
      // A rejected payload never consumes rate-limit budget either.
      expect(after.metrics.clientPublishRateLimited - before.metrics.clientPublishRateLimited).toBe(0);

      // Same socket, one well-formed frame: still accepted and delivered.
      clientPublish(attacker, room, "typing", typingPayload(attacker.userId, { name: "Tester" }));
      await sleep(400);
      expect(events(observer, "typing").length).toBe(1);
      expect(events(observer, "typing")[0].data.name).toBe(attacker.userId);
    } finally {
      closeAll([attacker, observer]);
    }
  });
});

describe("client publish: rate limiting", () => {
  it("throttles a per-socket flood without affecting server events or other rooms", async () => {
    const room = "chat:sec_rate";
    const [attacker, observer] = await harness.connectBatch("sec_rate", 2, room, "typing");
    const otherRoom = "chat:sec_rate_other";
    const watcher = await harness.connect(otherRoom, "sec_rate_watcher");
    harness.subscribe(watcher, otherRoom, "typing");
    await harness.waitForRefs(otherRoom, 1, 30_000);

    try {
      const FLOOD = 60;
      const before = await harness.stats(room);
      for (let i = 0; i < FLOOD; i++) {
        clientPublish(attacker, room, "typing", typingPayload(attacker.userId, { name: `Flood ${i}` }));
      }
      await sleep(700);

      const delivered = events(observer, "typing").length;
      // Sender-excluded delivery: accepted == delivered to the observer.
      const after = await harness.stats(room);
      const accepted = after.metrics.clientPublishesAccepted - before.metrics.clientPublishesAccepted;
      const limited = after.metrics.clientPublishRateLimited - before.metrics.clientPublishRateLimited;
      console.log(`  [sec-rate] flood=${FLOOD} accepted=${accepted} delivered=${delivered} limited=${limited}`);

      expect(delivered).toBeGreaterThan(0);
      expect(delivered).toBeLessThanOrEqual(SOCKET_PUBLISH_BURST + 4); // burst + a little refill
      expect(limited).toBeGreaterThanOrEqual(FLOOD - (SOCKET_PUBLISH_BURST + 4));
      expect(after.instanceId).toBe(before.instanceId);
      expect(accepted).toBe(delivered);

      // A server publish still reaches both sockets while the client is over budget.
      const { status } = await harness.publish(room, "typing", { typing: true });
      expect(status).toBe(200);
      await sleep(400);
      expect(events(observer, "typing").length).toBe(delivered + 1);
      expect(events(attacker, "typing").length).toBe(1);

      // Nothing leaked into another room's DO.
      expect(events(watcher, "typing").length).toBe(0);

      // The bucket refills: after ~1.5s the client can publish again.
      await sleep(1500);
      clientPublish(attacker, room, "typing", typingPayload(attacker.userId, { typing: false }));
      await sleep(400);
      expect(events(observer, "typing").length).toBe(delivered + 2);
      expect(events(observer, "typing").at(-1)?.data.typing).toBe(false);
    } finally {
      closeAll([attacker, observer, watcher]);
    }
  }, 30_000);

  it("shares one budget across every socket of the same user", async () => {
    const room = "chat:sec_user_limit";
    const observer = await harness.connect(room, "sec_ulimit_observer");
    const sockets: Conn[] = [];
    for (let i = 0; i < 4; i++) {
      sockets.push(await harness.connect(room, "sec_ulimit_attacker"));
    }

    try {
      harness.subscribe(observer, room, "typing");
      for (const socket of sockets) harness.subscribe(socket, room, "typing");
      await harness.waitForRefs(room, 5, 30_000);

      const before = await harness.stats(room);
      // 15 frames per socket: per-socket budgets alone would pass ~48 of them.
      for (let i = 0; i < 15; i++) {
        for (const socket of sockets) {
          clientPublish(socket, room, "typing", typingPayload("sec_ulimit_attacker"));
        }
      }
      await sleep(700);

      const delivered = events(observer, "typing").length;
      const after = await harness.stats(room);
      console.log(
        `  [sec-user-limit] sockets=4 sent=60 delivered=${delivered} accepted=${
          after.metrics.clientPublishesAccepted - before.metrics.clientPublishesAccepted
        } limited=${after.metrics.clientPublishRateLimited - before.metrics.clientPublishRateLimited}`,
      );

      expect(delivered).toBeGreaterThan(0);
      // The shared per-user ceiling, not 4 × the per-socket burst.
      expect(delivered).toBeLessThanOrEqual(USER_PUBLISH_BURST + 6);
      expect(delivered).toBeLessThan(sockets.length * SOCKET_PUBLISH_BURST);
    } finally {
      closeAll([observer, ...sockets]);
    }
  }, 30_000);
});

describe("client publish: user-scoped socket (UserDO)", () => {
  it("cannot forge a notification over the user socket, while server publishes still arrive", async () => {
    const userId = "sec_user_room";
    const conn = await harness.connect(`user:${userId}`, userId);
    const room = `notifications:${userId}`;

    try {
      harness.subscribe(conn, room, "insert");
      await harness.waitForRefs(`user:${userId}`, 1, 30_000);

      clientPublish(conn, room, "insert", { id: "forged", title: "Forged notification" });
      clientPublish(conn, room, "update", { id: "forged" });
      await sleep(500);

      expect(events(conn, "insert").length).toBe(0);
      expect(events(conn, "update").length).toBe(0);

      const { status } = await harness.publish(room, "insert", { id: "real", title: "Real" });
      expect(status).toBe(200);
      await sleep(400);

      const delivered = events(conn, "insert");
      expect(delivered.length).toBe(1);
      expect(delivered[0].data.id).toBe("real");
    } finally {
      conn.close();
    }
  });
});
