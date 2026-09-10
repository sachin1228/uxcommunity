/**
 * Typed environment for the transcoder service. Fails fast at boot with a
 * clear message when a required value is missing — a misconfigured worker
 * must never silently claim (and then fail) user uploads.
 */

import { hostname } from "node:os";

export interface TranscoderEnv {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  r2AccountId: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  r2BucketName: string;
  r2PublicUrl: string;
  apiSecret: string;
  appUrl: string;
  ffmpegPath: string;
  ffprobePath: string;
  workerId: string;
  pollIntervalMs: number;
  jobBatchSize: number;
  claimLeaseMs: number;
  processTimeoutMs: number;
  tempDir: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`[transcoder] missing required env var: ${name}`);
  }
  return value.trim();
}

function number(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadEnv(): TranscoderEnv {
  const env: TranscoderEnv = {
    supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    r2AccountId: required("R2_ACCOUNT_ID"),
    r2AccessKeyId: required("R2_ACCESS_KEY_ID"),
    r2SecretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    r2BucketName: required("R2_BUCKET_NAME"),
    r2PublicUrl: required("R2_PUBLIC_URL"),
    apiSecret: required("API_SECRET"),
    appUrl: required("APP_URL").replace(/\/+$/, ""),
    ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg",
    ffprobePath: process.env.FFPROBE_PATH ?? "ffprobe",
    workerId: process.env.WORKER_ID ?? `transcoder-${hostname()}`,
    pollIntervalMs: number("POLL_INTERVAL_MS", 5000),
    jobBatchSize: number("JOB_BATCH_SIZE", 2),
    claimLeaseMs: number("CLAIM_LEASE_MS", 10 * 60 * 1000),
    processTimeoutMs: number("PROCESS_TIMEOUT_MS", 25 * 60 * 1000),
    tempDir: process.env.TEMP_DIR ?? "/tmp/transcoder",
  };
  return env;
}