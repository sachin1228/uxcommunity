/**
 * Worker-level session revocation tests.
 *
 * A local API stub stands in for the web app's registry validation. It can
 * mark a sid revoked, which is exactly what the real route does after logout,
 * reset, suspension or deletion. The Worker and both Durable Object classes are
 * real, so this covers:
 *   - closing an existing community socket with code 4001;
 *   - leaving another device's socket open (per-session logout);
 *   - stopping delivery after the close;
 *   - refusing a reconnect once the sid is revoked;
 *   - closing a user-scoped socket too.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_dev } from "wrangler";
import type { UnstableDevWorker } from "wrangler";
import WebSocket from "ws";
import { createServer, type Server } from "http";
import { readFileSync } from "fs";
import { resolve } from "path";
import { pointDevVarsAt } from "./helpers/membership-stub";

const devVars = readFileSync(resolve(__dirname, "../.dev.vars"), "utf-8");
const vars = Object.fromEntries(
  devVars.split("\n").filter(Boolean).map((line) => {
    const [key, ...rest] = line.split("=");
    return [key.trim(), rest.join("=").trim()];
  }),
);
const SESSION_SECRET = vars.SESSION_SECRET;
const PUBLISH_SECRET = vars.REALTIME_PUBLISH_SECRET;

let worker: UnstableDevWorker;
let baseUrl: string;
let stub: Server;
let restoreDevVars: () => void;
const revokedSids = new Set<string>();
const blockedSids = new Set<string>();
/** A sid whose FIRST validation passes and SECOND fails, like a revocation
 *  landing between the pre-upgrade check and the post-accept check. */
let raceSid: string | null = null;
let raceSidValidations = 0;

async function createToken(userId: string, sid: string): Promise<string> {
  const { SignJWT } = await import("jose");
  return new SignJWT({ userId, sid, sv: 1, role: "user" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SESSION_SECRET));
}

function connect(room: string, token: string) {
  const ws = new WebSocket(
    `${baseUrl}/ws?room=${encodeURIComponent(room)}&token=${token}`,
  );
  const messages: any[] = [];
  const closed = new Promise<number>((resolveClose) => {
    ws.on("close", (code: number) => resolveClose(code));
  });
  ws.on("message", (data) => {
    try { messages.push(JSON.parse(String(data))); } catch { /* ignore */ }
  });
  return { ws, messages, closed };
}

function waitOpen(ws: WebSocket, ms = 5000): Promise<void> {
  return new Promise((resolveOpen, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolveOpen();
    const timer = setTimeout(() => reject(new Error("WS open timeout")), ms);
    ws.on("open", () => { clearTimeout(timer); resolveOpen(); });
  });
}

async function joinAndSubscribe(
  ws: WebSocket,
  messages: any[],
  userId: string,
  room: string,
  topic: string,
): Promise<void> {
  await waitOpen(ws);
  ws.send(JSON.stringify({ t: "join", user: { id: userId, name: userId, avatar: null } }));
  const start = Date.now();
  while (!messages.some((msg) => msg.t === "hello")) {
    if (Date.now() - start > 5000) throw new Error("hello timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
  ws.send(JSON.stringify({ t: "subscribe", room, topic }));
  await new Promise((r) => setTimeout(r, 150));
}

async function publish(room: string, topic: string, data: unknown): Promise<void> {
  const response = await fetch(`${baseUrl}/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-realtime-publish-secret": PUBLISH_SECRET,
    },
    body: JSON.stringify({ room, topic, data }),
  });
  expect(response.ok).toBe(true);
}

async function revoke(body: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/revoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PUBLISH_SECRET}`,
    },
    body: JSON.stringify(body),
  });
}

async function roomSocketCount(room: string): Promise<number> {
  const response = await fetch(`${baseUrl}/stats?room=${encodeURIComponent(room)}`, {
    headers: { "x-realtime-publish-secret": PUBLISH_SECRET },
  });
  const body = (await response.json()) as { sockets?: number };
  return body.sockets ?? -1;
}

beforeAll(async () => {
  stub = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      if (req.url?.includes("/internal/session/validate")) {
        let claims: { userId?: string; sid?: string; sv?: number } = {};
        try { claims = JSON.parse(body || "{}"); } catch { /* invalid */ }
        if (claims.sid && claims.sid === raceSid) {
          raceSidValidations += 1;
          if (raceSidValidations >= 2) {
            revokedSids.add(claims.sid);
            raceSid = null;
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false }));
            return;
          }
        }
        if (
          (claims.sid && revokedSids.has(claims.sid)) ||
          (claims.sid && blockedSids.has(claims.sid))
        ) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          userId: claims.userId,
          sessionVersion: claims.sv,
        }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolveListen) => stub.listen(0, "127.0.0.1", resolveListen));
  const port = (stub.address() as { port: number }).port;

  restoreDevVars = pointDevVarsAt(`http://127.0.0.1:${port}`);
  worker = await unstable_dev("src/index.ts", {
    configPath: "wrangler.toml",
    experimentalExcludeMiniflareV1: true,
  });
  baseUrl = `http://127.0.0.1:${worker.port}`;
}, 30_000);

afterAll(async () => {
  await worker?.stop();
  restoreDevVars?.();
  await new Promise<void>((resolveClose) => stub?.close(() => resolveClose()));
});

describe("session revocation closes live sockets", () => {
  it("closes only the revoked device, keeps the other, and stops delivery", async () => {
    const userId = "revoke-user-1";
    const room = "chat:revoke-community-1";
    const deviceA = connect(room, await createToken(userId, "revoke-sid-a"));
    const deviceB = connect(room, await createToken(userId, "revoke-sid-b"));

    await joinAndSubscribe(deviceA.ws, deviceA.messages, userId, room, "chat");
    await joinAndSubscribe(deviceB.ws, deviceB.messages, userId, room, "chat");

    const response = await revoke({ userId, sid: "revoke-sid-a" });
    expect(response.ok).toBe(true);
    expect(await deviceA.closed).toBe(4001);

    await publish(room, "chat", { text: "after-revoke" });
    await new Promise((r) => setTimeout(r, 300));

    expect(
      deviceA.messages.filter((msg) => msg.t === "event" && msg.data?.text === "after-revoke"),
    ).toHaveLength(0);
    expect(
      deviceB.messages.some((msg) => msg.t === "event" && msg.data?.text === "after-revoke"),
    ).toBe(true);

    deviceB.ws.close();
  });

  it("refuses a new connection whose sid has been revoked", async () => {
    const userId = "revoke-user-2";
    const sid = "revoke-sid-reconnect";
    revokedSids.add(sid);

    const ws = new WebSocket(
      `${baseUrl}/ws?room=${encodeURIComponent("chat:revoke-community-2")}&token=${await createToken(userId, sid)}`,
    );
    const status = await new Promise<number>((resolveStatus) => {
      ws.on("error", () => resolveStatus(0));
      ws.on("unexpected-response", (_req, res) => resolveStatus(res.statusCode ?? 0));
      ws.on("open", () => resolveStatus(200));
      setTimeout(() => resolveStatus(0), 3000);
    });
    expect(status).toBe(401);
    try { ws.close(); } catch { /* ignore */ }
  });

  it("closes a socket whose session dies between the pre-check and acceptance", async () => {
    const userId = "revoke-user-race";
    const sid = "revoke-sid-race";
    const room = "chat:revoke-community-race";
    raceSid = sid;
    raceSidValidations = 0;

    const conn = connect(room, await createToken(userId, sid));
    const state = await new Promise<number>((resolveState) => {
      const timer = setTimeout(() => resolveState(conn.ws.readyState), 3000);
      const settle = () => {
        clearTimeout(timer);
        // Give the close handshake one turn to move CONNECTING/CLOSING to CLOSED.
        setTimeout(() => resolveState(conn.ws.readyState), 100);
      };
      conn.ws.on("close", settle);
      conn.ws.on("error", settle);
      conn.ws.on("unexpected-response", settle);
    });

    // The close may land before the client finishes opening, in which case the
    // browser-visible code is 1006/CLOSING; the security property is that the
    // room no longer holds the socket and it cannot receive a later event.
    expect(state).not.toBe(WebSocket.OPEN);
    await new Promise((r) => setTimeout(r, 300));
    expect(await roomSocketCount(room)).toBe(0);
    await publish(room, "chat", { text: "after-race-revoke" });
    await new Promise((r) => setTimeout(r, 300));
    expect(
      conn.messages.filter((msg) => msg.t === "event" && msg.data?.text === "after-race-revoke"),
    ).toHaveLength(0);
  });

  it("refuses a blocked user's new community socket", async () => {
    const userId = "revoke-user-blocked";
    const sid = "revoke-sid-blocked";
    blockedSids.add(sid);

    const ws = new WebSocket(
      `${baseUrl}/ws?room=${encodeURIComponent("chat:revoke-community-blocked")}&token=${await createToken(userId, sid)}`,
    );
    const status = await new Promise<number>((resolveStatus) => {
      ws.on("error", () => resolveStatus(0));
      ws.on("unexpected-response", (_req, res) => resolveStatus(res.statusCode ?? 0));
      ws.on("open", () => resolveStatus(200));
      setTimeout(() => resolveStatus(0), 3000);
    });
    expect(status).toBe(401);
    try { ws.close(); } catch { /* ignore */ }
  });

  it("keeps the current device when revoking every other sid", async () => {
    const userId = "revoke-user-except";
    const room = "chat:revoke-community-except";
    const currentSid = "revoke-sid-current";
    const otherSid = "revoke-sid-other";
    const current = connect(room, await createToken(userId, currentSid));
    const other = connect(room, await createToken(userId, otherSid));

    await joinAndSubscribe(current.ws, current.messages, userId, room, "chat");
    await joinAndSubscribe(other.ws, other.messages, userId, room, "chat");

    const response = await revoke({ userId, exceptSid: currentSid });
    expect(response.ok).toBe(true);
    expect(await other.closed).toBe(4001);

    await publish(room, "chat", { text: "password-change-current" });
    await new Promise((r) => setTimeout(r, 300));
    expect(
      current.messages.some((msg) => msg.t === "event" && msg.data?.text === "password-change-current"),
    ).toBe(true);

    current.ws.close();
  });

  it("closes a user-scoped socket on logout-all", async () => {
    const userId = "revoke-user-3";
    const conn = connect(`user:${userId}`, await createToken(userId, "revoke-sid-user-room"));
    await waitOpen(conn.ws);

    const response = await revoke({ userId, all: true });
    expect(response.ok).toBe(true);
    expect(await conn.closed).toBe(4001);
  });
});
