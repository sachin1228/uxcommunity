/**
 * Health endpoint + readiness checks for the transcoder.
 *
 * `GET /health` reports:
 *   - ffmpeg / ffprobe binaries present and runnable (the encode engine),
 *   - Supabase reachable (queue counts — the job source),
 *   - R2 reachable (HeadBucket — the object store),
 *   - live queue depth and worker stats (jobs processed/failed, last error).
 *
 * Each check is `{ status: "ok" | "error", detail }`; the overall status is
 * `ok` when every check passes, `degraded` otherwise. The endpoint is also
 * usable as a container readiness probe (curl http://127.0.0.1:PORT/health).
 */

import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { QueueDb } from "@uxcommunity/shared";
import type { TranscoderEnv } from "./env";

export interface WorkerStats {
  jobsProcessed: number;
  jobsFailed: number;
  lastJobAt: string | null;
  lastError: string | null;
  startedAt: number;
}

export interface HealthCheck {
  status: "ok" | "error";
  detail: string;
}

export interface HealthPayload {
  status: "ok" | "degraded";
  workerId: string;
  uptimeSeconds: number;
  version: string;
  checks: {
    ffmpeg: HealthCheck;
    ffprobe: HealthCheck;
    supabase: HealthCheck;
    r2: HealthCheck;
  };
  queue: { queued: number; processing: number };
  stats: WorkerStats;
}

function runVersion(bin: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(bin, ["-version"], { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve("timed out");
    }, 10_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 512) {
        child.kill();
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve(error instanceof Error ? error.message : String(error));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const firstLine = stdout.split("\n")[0]?.trim() ?? "";
      resolve(code === 0 ? firstLine : `exit ${code}: ${firstLine}`.trim());
    });
  });
}

/** True when the binary responded with a plausible version banner. */
export function isVersionOk(detail: string): boolean {
  return detail.startsWith("ffmpeg version") || detail.startsWith("ffprobe version");
}

async function checkSupabase(
  db: QueueDb,
): Promise<HealthCheck & { queue: { queued: number; processing: number } }> {
  try {
    const [queuedResult, processingResult] = await Promise.all([
      db.from("video_media").select("id", { count: "exact", head: true }).eq("status", "queued"),
      db.from("video_media").select("id", { count: "exact", head: true }).eq("status", "processing"),
    ]);
    const error = queuedResult.error ?? processingResult.error;
    if (error) {
      return { status: "error", detail: error.message ?? "queue query failed", queue: { queued: -1, processing: -1 } };
    }
    const queue = {
      queued: queuedResult.count ?? 0,
      processing: processingResult.count ?? 0,
    };
    return {
      status: "ok",
      detail: `queue depth: ${queue.queued} queued, ${queue.processing} processing`,
      queue,
    };
  } catch (error) {
    return {
      status: "error",
      detail: error instanceof Error ? error.message : String(error),
      queue: { queued: -1, processing: -1 },
    };
  }
}

export async function collectHealth(
  env: TranscoderEnv,
  db: QueueDb,
  stats: WorkerStats,
): Promise<HealthPayload> {
  const [ffmpegDetail, ffprobeDetail, supabase, r2Detail] = await Promise.all([
    runVersion(env.ffmpegPath),
    runVersion(env.ffprobePath),
    checkSupabase(db),
    checkR2(env),
  ]);

  const ffmpeg: HealthCheck = {
    status: isVersionOk(ffmpegDetail) ? "ok" : "error",
    detail: ffmpegDetail,
  };
  const ffprobe: HealthCheck = {
    status: isVersionOk(ffprobeDetail) ? "ok" : "error",
    detail: ffprobeDetail,
  };

  return buildHealthPayload(env, stats, {
    ffmpeg,
    ffprobe,
    supabase: { status: supabase.status, detail: supabase.detail },
    r2: r2Detail,
  }, supabase.queue);
}

/**
 * Pure payload builder (unit-testable): overall status is `degraded` when
 * any check failed; the HTTP layer maps ok→200, degraded→503.
 */
export function buildHealthPayload(
  env: TranscoderEnv,
  stats: WorkerStats,
  checks: HealthPayload["checks"],
  queue: { queued: number; processing: number },
): HealthPayload {
  const degraded = Object.values(checks).some((check) => check.status === "error");
  return {
    status: degraded ? "degraded" : "ok",
    workerId: env.workerId,
    uptimeSeconds: Math.round((Date.now() - stats.startedAt) / 1000),
    version: "0.1.0",
    checks,
    queue,
    stats,
  };
}

async function checkR2(env: TranscoderEnv): Promise<HealthCheck> {
  try {
    const client = new S3Client({
      region: "auto",
      endpoint: `https://${env.r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.r2AccessKeyId,
        secretAccessKey: env.r2SecretAccessKey,
      },
    });
    await client.send(new HeadBucketCommand({ Bucket: env.r2BucketName }));
    return { status: "ok", detail: `bucket reachable: ${env.r2BucketName}` };
  } catch (error) {
    return {
      status: "error",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Starts the health HTTP server. Returns the server for tests/cleanup. */
export function startHealthServer(
  env: TranscoderEnv,
  db: QueueDb,
  stats: WorkerStats,
): Server {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") {
      try {
        const payload = await collectHealth(env, db, stats);
        res.writeHead(payload.status === "ok" ? 200 : 503, { "content-type": "application/json" });
        res.end(JSON.stringify(payload, null, 2));
      } catch (error) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "error", detail: String(error) }));
      }
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  const port = Number(process.env.HEALTH_PORT ?? 9090);
  const bind = process.env.HEALTH_BIND ?? "0.0.0.0";
  server.listen(port, bind, () => {
    console.log(`[transcoder] health endpoint: http://${bind}:${port}/health`);
  });
  return server;
}