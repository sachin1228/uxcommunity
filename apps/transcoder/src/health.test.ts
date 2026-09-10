import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHealthPayload, isVersionOk, type WorkerStats } from "./health";
import type { TranscoderEnv } from "./env";

function env(overrides: Partial<TranscoderEnv> = {}): TranscoderEnv {
  return {
    supabaseUrl: "https://x.supabase.co",
    supabaseServiceRoleKey: "k",
    r2AccountId: "a",
    r2AccessKeyId: "k",
    r2SecretAccessKey: "s",
    r2BucketName: "b",
    r2PublicUrl: "https://media.example.com",
    apiSecret: "secret",
    appUrl: "https://app.example.com",
    ffmpegPath: "ffmpeg",
    ffprobePath: "ffprobe",
    workerId: "transcoder-test",
    pollIntervalMs: 5000,
    jobBatchSize: 2,
    claimLeaseMs: 600000,
    processTimeoutMs: 1500000,
    tempDir: "/tmp/transcoder",
    ...overrides,
  };
}

function stats(overrides: Partial<WorkerStats> = {}): WorkerStats {
  return {
    jobsProcessed: 3,
    jobsFailed: 1,
    lastJobAt: "2026-09-10T00:00:00Z",
    lastError: null,
    startedAt: Date.now() - 60000,
    ...overrides,
  };
}

test("isVersionOk accepts real version banners and rejects errors", () => {
  assert.equal(isVersionOk("ffmpeg version 8.0 Copyright (c) 2000-2026"), true);
  assert.equal(isVersionOk("ffprobe version 8.0"), true);
  assert.equal(isVersionOk("ENOENT: spawn ffmpeg ENOENT"), false);
  assert.equal(isVersionOk("exit 127: ffmpeg"), false);
});

test("buildHealthPayload reports ok when every check passes", () => {
  const payload = buildHealthPayload(
    env(),
    stats(),
    {
      ffmpeg: { status: "ok", detail: "ffmpeg version 8.0" },
      ffprobe: { status: "ok", detail: "ffprobe version 8.0" },
      supabase: { status: "ok", detail: "queue depth: 2 queued, 1 processing" },
      r2: { status: "ok", detail: "bucket reachable" },
    },
    { queued: 2, processing: 1 },
  );
  assert.equal(payload.status, "ok");
  assert.equal(payload.queue.queued, 2);
  assert.equal(payload.stats.jobsProcessed, 3);
  assert.ok(payload.uptimeSeconds >= 59);
});

test("buildHealthPayload degrades when any check fails", () => {
  const payload = buildHealthPayload(
    env(),
    stats(),
    {
      ffmpeg: { status: "ok", detail: "ffmpeg version 8.0" },
      ffprobe: { status: "ok", detail: "ffprobe version 8.0" },
      supabase: { status: "ok", detail: "queue depth: 0 queued, 0 processing" },
      r2: { status: "error", detail: "InvalidAccessKeyId" },
    },
    { queued: 0, processing: 0 },
  );
  assert.equal(payload.status, "degraded");
  assert.equal(payload.checks.r2.status, "error");
});