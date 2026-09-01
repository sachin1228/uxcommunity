/**
 * PERF 9: Duplicate detection — measures zero duplicates across rapid publishes.
 *
 * Instead of 500 sequential WS opens (which times out in miniflare),
 * this test uses a smaller set of concurrent connections and verifies
 * that rapid publishes produce exactly 1 delivery per subscriber per message.
 *
 * Run: npx vitest run __tests__/perf-duplicates.test.ts --reporter=verbose
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unstable_dev } from "wrangler";
import type { UnstableDevWorker } from "wrangler";
import WebSocket from "ws";
import { readFileSync } from "fs";
import { resolve } from "path";

const devVars = readFileSync(resolve(__dirname, "../.dev.vars"), "utf-8");
const vars = Object.fromEntries(
  devVars.split("\n").filter(Boolean).map((l) => {
    const [k, ...v] = l.split("=");
    return [k.trim(), v.join("=").trim()];
  })
);
const REALTIME_SECRET = vars.SESSION_SECRET;
const PUBLISH_SECRET = vars.REALTIME_PUBLISH_SECRET;

let worker: UnstableDevWorker;
let baseUrl: string;

async function createToken(userId: string): Promise<string> {
  const { SignJWT } = await import("jose");
  const secret = new TextEncoder().encode(REALTIME_SECRET);
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
}

function connectWs(room: string, token: string) {
  const url = `${baseUrl}/ws?room=${encodeURIComponent(room)}&token=${token}`;
  const ws = new WebSocket(url);
  const messages: any[] = [];
  ws.on("message", (data) => {
    try { messages.push(JSON.parse(String(data))); } catch { /* ignore */ }
  });
  return { ws, messages, close: () => { try { ws.close(); } catch { /* ignore */ } } };
}

function waitForOpen(ws: WebSocket, ms = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    const t = setTimeout(() => reject(new Error("WS open timeout")), ms);
    ws.on("open", () => { clearTimeout(t); resolve(); });
  });
}

function waitForMessage(messages: any[], type: string, ms = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const msg = messages.find((m) => m.t === type);
      if (msg) return resolve(msg);
      if (Date.now() - start > ms) return reject(new Error(`Timeout waiting for ${type}`));
      setTimeout(check, 50);
    };
    check();
  });
}

async function connectBatch(
  prefix: string,
  count: number,
  room: string,
  topic: string,
): Promise<Array<{ ws: WebSocket; messages: any[]; close: () => void }>> {
  const conns: Array<{ ws: WebSocket; messages: any[]; close: () => void }> = [];
  for (let i = 0; i < count; i++) {
    const token = await createToken(`${prefix}_${i}`);
    const conn = connectWs(`user:${prefix}_${i}`, token);
    conns.push(conn);
    await waitForOpen(conn.ws);
    conn.ws.send(JSON.stringify({
      t: "join", user: { id: `${prefix}_${i}`, name: `U${i}`, avatar: null },
    }));
    await waitForMessage(conn.messages, "hello");
    conn.ws.send(JSON.stringify({ t: "subscribe", room, topic }));
  }
  return conns;
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

// ============================================================================
// PERF 9: Duplicate detection — 50 msgs × 50 subscribers
// ============================================================================

describe("PERF 9: Duplicate detection — 50 msgs × 50 subs", () => {
  it("zero duplicates across 50 rapid publishes", async () => {
    const N = 50;
    const MESSAGES = 50;
    const conns = await connectBatch("p9", N, "chat:p9", "chat");
    await new Promise((r) => setTimeout(r, 2000));

    let totalDuplicates = 0;
    let totalDelivered = 0;

    for (let seq = 0; seq < MESSAGES; seq++) {
      await fetch(`${baseUrl}/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-realtime-publish-secret": PUBLISH_SECRET,
        },
        body: JSON.stringify({ room: "chat:p9", topic: "chat", data: { seq } }),
      });
      await new Promise((r) => setTimeout(r, 100));
    }

    await new Promise((r) => setTimeout(r, 10000));

    for (const conn of conns) {
      for (let seq = 0; seq < MESSAGES; seq++) {
        const count = conn.messages.filter(
          (m) => m.t === "event" && m.data?.seq === seq
        ).length;
        if (count > 1) totalDuplicates += count - 1;
        if (count >= 1) totalDelivered++;
      }
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  PERF 9: Duplicate detection — 50 msgs × 50 subs");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Expected: ${MESSAGES * N}`);
    console.log(`  Delivered: ${totalDelivered}`);
    console.log(`  Duplicates: ${totalDuplicates}`);
    console.log("═══════════════════════════════════════════════════════════\n");

    expect(totalDuplicates).toBe(0);
    expect(totalDelivered).toBe(MESSAGES * N);

    for (const conn of conns) conn.close();
  }, 120_000);
});
