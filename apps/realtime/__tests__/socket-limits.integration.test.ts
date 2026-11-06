/**
 * Server-enforced connection limits and community-membership revocation.
 *
 * These run against a real Worker + Room DO (miniflare) and the membership
 * stub supplied by global-setup. They cover the two behaviours that cannot be
 * proven with a pure unit test: the DO evicts the oldest socket under its
 * per-user/per-session caps, and a membership revocation closes the member's
 * sockets in one community while leaving another community and the user socket
 * untouched.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_dev } from "wrangler";
import type { UnstableDevWorker } from "wrangler";
import WebSocket from "ws";
import { readFileSync } from "fs";
import { resolve } from "path";

const devVars = readFileSync(resolve(__dirname, "../.dev.vars"), "utf-8");
const vars = Object.fromEntries(
  devVars.split("\n").filter(Boolean).map((line) => {
    const [key, ...rest] = line.split("=");
    return [key.trim(), rest.join("=").trim().replace(/^["']|["']$/g, "")];
  }),
);
const SESSION_SECRET = vars.SESSION_SECRET;
const PUBLISH_SECRET = vars.REALTIME_PUBLISH_SECRET;

let worker: UnstableDevWorker;
let baseUrl: string;

async function tokenFor(userId: string, sid: string): Promise<string> {
  const { SignJWT } = await import("jose");
  return new SignJWT({ userId, sid, sv: 1, role: "user" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SESSION_SECRET));
}

interface Client {
  ws: WebSocket;
  messages: unknown[];
  closed: Promise<number>;
}

function connect(room: string, token: string): Client {
  const ws = new WebSocket(
    `${baseUrl}/ws?room=${encodeURIComponent(room)}&token=${token}`,
  );
  const messages: unknown[] = [];
  ws.on("message", (data) => {
    try { messages.push(JSON.parse(String(data))); } catch { /* ignore */ }
  });
  const closed = new Promise<number>((resolveClose) => {
    ws.on("close", (code: number) => resolveClose(code));
  });
  return { ws, messages, closed };
}

function waitOpen(ws: WebSocket, ms = 5_000): Promise<void> {
  return new Promise((resolveOpen, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolveOpen();
    const timer = setTimeout(() => reject(new Error("WS open timeout")), ms);
    ws.on("open", () => { clearTimeout(timer); resolveOpen(); });
  });
}

async function connectAndJoin(room: string, userId: string, sid: string): Promise<Client> {
  const token = await tokenFor(userId, sid);
  const client = connect(room, token);
  await waitOpen(client.ws);
  client.ws.send(JSON.stringify({ t: "join", user: { id: userId, name: userId, avatar: null } }));
  await new Promise((resolveWait) => setTimeout(resolveWait, 120));
  return client;
}

async function stats(room: string): Promise<{ sockets?: number; metrics?: Record<string, number> }> {
  const response = await fetch(`${baseUrl}/stats?room=${encodeURIComponent(room)}`, {
    headers: { "x-realtime-publish-secret": PUBLISH_SECRET },
  });
  return (await response.json()) as { sockets?: number; metrics?: Record<string, number> };
}

async function revoke(body: Record<string, unknown>, secret = PUBLISH_SECRET): Promise<Response> {
  return fetch(`${baseUrl}/revoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  worker = await unstable_dev("src/index.ts", {
    configPath: "wrangler.toml",
    experimentalExcludeMiniflareV1: true,
  });
  baseUrl = `http://127.0.0.1:${worker.port}`;
}, 30_000);

afterAll(async () => {
  await worker?.stop();
});

describe("Room connection limits", () => {
  it("evicts the oldest socket when the per-user cap is reached", async () => {
    const communityId = crypto.randomUUID();
    const room = `chat:${communityId}`;
    const userId = crypto.randomUUID();
    const clients: Client[] = [];

    // Default per-user cap is 12. Open 12 distinct sessions (devices/tabs),
    // then one more; the oldest must close with the connection-limit code.
    for (let index = 0; index < 12; index += 1) {
      clients.push(await connectAndJoin(room, userId, `sid-${index}`));
    }
    const oldest = clients[0];
    clients.push(await connectAndJoin(room, userId, "sid-extra"));

    await expect(oldest.closed).resolves.toBe(4008);
    const after = await stats(room);
    expect(after.sockets).toBe(12);
    expect(after.metrics?.connectionsEvictedLimit).toBeGreaterThanOrEqual(1);

    for (const client of clients) {
      try { client.ws.close(); } catch { /* already closed */ }
    }
  }, 30_000);

  it("evicts the oldest tab when the per-session cap is reached", async () => {
    const communityId = crypto.randomUUID();
    const room = `chat:${communityId}`;
    const userId = crypto.randomUUID();
    const sid = "one-browser-session";
    const clients: Client[] = [];

    // Default per-session cap is 8.
    for (let index = 0; index < 8; index += 1) {
      clients.push(await connectAndJoin(room, userId, sid));
    }
    const oldest = clients[0];
    clients.push(await connectAndJoin(room, userId, sid));

    await expect(oldest.closed).resolves.toBe(4008);
    expect((await stats(room)).sockets).toBe(8);

    for (const client of clients) {
      try { client.ws.close(); } catch { /* already closed */ }
    }
  }, 30_000);

  it("accepts a reconnection after a client closes", async () => {
    const communityId = crypto.randomUUID();
    const room = `chat:${communityId}`;
    const userId = crypto.randomUUID();
    const first = await connectAndJoin(room, userId, "sid-reconnect");
    first.ws.close();
    await first.closed;

    const second = await connectAndJoin(room, userId, "sid-reconnect");
    expect(second.ws.readyState).toBe(WebSocket.OPEN);
    second.ws.close();
    await second.closed;
  }, 15_000);
});

describe("Community membership revocation", () => {
  it("closes only the removed community's sockets, not another community or the user socket", async () => {
    const communityOne = crypto.randomUUID();
    const communityTwo = crypto.randomUUID();
    const userId = crypto.randomUUID();

    const inOne = await connectAndJoin(`chat:${communityOne}`, userId, "sid-one");
    const inTwo = await connectAndJoin(`chat:${communityTwo}`, userId, "sid-two");
    const userSocket = await connectAndJoin(`user:${userId}`, userId, "sid-user");

    const response = await revoke({ userId, communityId: communityOne });
    expect(response.status).toBe(200);

    await expect(inOne.closed).resolves.toBe(4003);
    // The other community and the user stream must remain live.
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    expect(inTwo.ws.readyState).toBe(WebSocket.OPEN);
    expect(userSocket.ws.readyState).toBe(WebSocket.OPEN);

    // Idempotent: a second revocation is accepted and closes nothing.
    const again = await revoke({ userId, communityId: communityOne });
    expect(again.status).toBe(200);

    for (const client of [inTwo, userSocket]) {
      try { client.ws.close(); } catch { /* already closed */ }
    }
  }, 20_000);

  it("refuses an unauthenticated revocation", async () => {
    const response = await revoke({ userId: crypto.randomUUID(), communityId: crypto.randomUUID() }, "wrong");
    expect(response.status).toBe(403);
  });
});
