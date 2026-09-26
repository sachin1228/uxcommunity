/**
 * PERF 4: Multiple hot communities — 3 × 500 subscribers.
 * Isolated worker instance to avoid miniflare overload.
 *
 * Room ownership: each community's 500 subscribers connect to THAT community's
 * room (`chat:p4_A|B|C`), so a publish is delivered by the owning CommunityDO.
 * The previous revision connected them to `user:${id}` and measured 0/500 per
 * community while asserting nothing; delivery and cross-leakage are now
 * asserted per community.
 *
 * Run: npx vitest run __tests__/perf-hot-communities.test.ts --reporter=verbose
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startHarness,
  type Harness,
  type Conn,
  sleep,
  measureDeliveries,
  countForeignEvents,
  reportLatency,
  closeAll,
} from "./helpers/realtime-harness";

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
}, 30_000);

afterAll(async () => {
  await harness?.stop();
});

// ============================================================================
// PERF 4: Multiple hot communities — 3 × 500
// ============================================================================

describe("PERF 4: Multiple hot communities — 3 × 500", () => {
  it("concurrent publishes to 3 communities, no cross-leakage", async () => {
    const N = 500;
    const comms = ["chat:p4_A", "chat:p4_B", "chat:p4_C"];
    const connsPerComm: Conn[][] = [];

    const connectStart = performance.now();
    for (const comm of comms) {
      const conns = await harness.connectBatch(`p4_${comm}`, N, comm, "chat");
      connsPerComm.push(conns);
    }
    const connectMs = performance.now() - connectStart;
    await sleep(2000);

    const publishTs = performance.now();
    const statuses = await Promise.all(
      comms.map((comm) => harness.publish(comm, "chat", { from: comm })),
    );
    await sleep(5000);

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  PERF 4: Multiple hot communities — 3 × 500");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Connect + subscribe setup: ${connectMs.toFixed(0)}ms`);
    console.log(
      `  /publish responses: ${statuses.map((s) => `${s.status} in ${s.ms.toFixed(1)}ms`).join(", ")}`,
    );

    let totalDelivered = 0;
    let totalLeaked = 0;
    for (let ci = 0; ci < comms.length; ci++) {
      const comm = comms[ci];
      const conns = connsPerComm[ci];

      const report = measureDeliveries(conns, (m) => m.data?.from === comm, publishTs);
      const leaked = countForeignEvents(
        conns,
        (m) => typeof m.data?.from === "string" && m.data.from !== comm,
      );

      totalDelivered += report.delivered;
      totalLeaked += leaked;

      console.log(
        `  ${comm}: delivered=${report.delivered}/${N}  duplicated=${report.duplicates}  leaked=${leaked}`,
      );
      reportLatency(`  ${comm} latency`, report.latencies);
    }
    console.log("═══════════════════════════════════════════════════════════\n");

    // Each room delivered to its own 500 subscribers, and no room saw another
    // room's event (a CommunityDO must be isolated by its own room name).
    expect(totalDelivered).toBe(N * comms.length);
    expect(totalLeaked).toBe(0);

    for (const conns of connsPerComm) closeAll(conns);
  }, 600_000);
});
