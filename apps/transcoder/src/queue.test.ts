import assert from "node:assert/strict";
import { test } from "node:test";
import {
  claimVideoJob,
  countVideoQueue,
  markVideoFailed,
  reclaimExpiredVideoJobs,
  type VideoMediaRow,
} from "@uxcommunity/shared";

/** Minimal structural stand-in for the supabase-js query builder chain. */
class FakeQuery {
  private updateValue: Record<string, unknown> | null = null;
  private filters: Array<[string, unknown]> = [];
  private range: [string, unknown] | null = null;
  private head = false;

  constructor(private state: { rows: Array<Record<string, unknown>> }) {}

  update(value: Record<string, unknown>): this {
    this.updateValue = value;
    return this;
  }

  eq(col: string, value: unknown): this {
    this.filters.push([col, value]);
    return this;
  }

  lt(col: string, value: unknown): this {
    this.range = [col, value];
    return this;
  }

  select(_cols?: string, opts?: { head?: boolean }): this {
    this.head = Boolean(opts?.head);
    return this;
  }

  private apply(): Array<Record<string, unknown>> {
    let rows = this.state.rows;
    for (const [col, value] of this.filters) {
      rows = rows.filter((row) => row[col] === value);
    }
    if (this.range) {
      const [col, value] = this.range;
      rows = rows.filter((row) => (row[col] as string) < (value as string));
    }
    if (this.updateValue) {
      for (const row of rows) Object.assign(row, this.updateValue);
    }
    return rows;
  }

  async single(): Promise<{ data: Record<string, unknown> | null; error: unknown }> {
    const rows = this.apply();
    return { data: rows[0] ?? null, error: rows.length ? null : { message: "no rows" } };
  }

  async maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: null }> {
    const rows = this.apply();
    return { data: rows[0] ?? null, error: null };
  }

  then(resolve: (value: { data?: unknown; count?: number; error: null }) => void): Promise<void> {
    const rows = this.apply();
    if (this.head) {
      resolve({ count: rows.length, error: null });
    } else {
      resolve({ data: rows, error: null });
    }
    return Promise.resolve();
  }
}

function fakeDb(rows: VideoMediaRow[]) {
  const state = { rows: rows as unknown as Array<Record<string, unknown>> };
  return {
    state,
    from: () => new FakeQuery(state),
  };
}

function row(overrides: Partial<VideoMediaRow> = {}): VideoMediaRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: "u1",
    community_id: "c1",
    status: "queued",
    strategy: "transcode",
    original_key: "media/videos/original/11111111-1111-4111-8111-111111111111",
    processed_key: null,
    poster_key: null,
    original_url: null,
    processed_url: null,
    poster_url: null,
    width: null,
    height: null,
    fps: null,
    duration_ms: null,
    video_codec: null,
    audio_codec: null,
    original_size: 100,
    processed_size: null,
    attempts: 0,
    processing_ms: null,
    error_code: null,
    error_message: null,
    claimed_by: null,
    claimed_at: null,
    ...overrides,
  };
}

test("claimVideoJob atomically claims exactly one queued row", async () => {
  const db = fakeDb([row({ id: "a" }), row({ id: "b", status: "ready" })]);
  const claimed = await claimVideoJob(db as never, "worker-1");
  assert.equal(claimed?.id, "a");
  assert.equal(claimed?.status, "processing");
  assert.equal(claimed?.claimed_by, "worker-1");
  assert.ok(claimed?.claimed_at);
  // The ready row was never touched.
  assert.equal(db.state.rows.find((r) => r.id === "b")?.status, "ready");
});

test("claimVideoJob returns null when nothing is queued", async () => {
  const db = fakeDb([row({ id: "a", status: "processing" })]);
  const claimed = await claimVideoJob(db as never, "worker-1");
  assert.equal(claimed, null);
});

test("reclaimExpiredVideoJobs re-claims only leases past the cutoff", async () => {
  const now = Date.now();
  const db = fakeDb([
    row({ id: "stale", status: "processing", claimed_by: "dead-worker", claimed_at: new Date(now - 15 * 60 * 1000).toISOString() }),
    row({ id: "fresh", status: "processing", claimed_by: "live-worker", claimed_at: new Date(now - 1000).toISOString() }),
  ]);
  const reclaimed = await reclaimExpiredVideoJobs(db as never, "worker-2", 10 * 60 * 1000);
  assert.deepEqual(reclaimed.map((r) => r.id), ["stale"]);
  assert.equal(reclaimed[0].claimed_by, "worker-2");
});

test("countVideoQueue reports queued and processing totals", async () => {
  const db = fakeDb([
    row({ id: "a" }),
    row({ id: "b" }),
    row({ id: "c", status: "processing" }),
    row({ id: "d", status: "ready" }),
  ]);
  const counts = await countVideoQueue(db as never);
  assert.deepEqual(counts, { queued: 2, processing: 1 });
});

test("markVideoFailed records the error and increments attempts", async () => {
  const db = fakeDb([row({ id: "a" })]);
  await markVideoFailed(db as never, "a", "transcoder-failed", "ffmpeg exploded");
  const failed = db.state.rows.find((r) => r.id === "a");
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.error_code, "transcoder-failed");
  assert.equal(failed?.attempts, 1);
  assert.equal(failed?.claimed_by, null);
});