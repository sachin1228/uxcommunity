/**
 * Live E2E test for the centralized video pipeline (queue → transcoder → R2).
 *
 * Simulates exactly what the web app's upload route does (R2 original upload +
 * queued video_media row), waits for the server-side transcoder to claim and
 * process it, then reports a before/after comparison and cleans everything up
 * (DB row + R2 objects), leaving production untouched.
 *
 * Requires: a test input video (2s MP4), Supabase + R2 creds in apps/web/.env,
 * and API access to the R2 bucket (uses the same S3 API as the transcoder).
 *
 * Usage:
 *   npx tsx --tsconfig apps/web/tsconfig.json scripts/test-live-pipeline.ts <input.mp4>
 */

import { readFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";

// ── env (same sources as the deployed transcoder) ──────────────────────────
function env(name: string, file: string): string {
  const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
  if (!line) throw new Error(`missing ${name} in ${file}`);
  return line.slice(name.length + 1).trim();
}
const webEnv = "apps/web/.env";
const localEnv = "apps/web/.env.local";
const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL", webEnv);
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY", webEnv);
const r2AccountId = env("R2_ACCOUNT_ID", webEnv);
const r2AccessKeyId = env("R2_ACCESS_KEY_ID", webEnv);
const r2SecretAccessKey = env("R2_SECRET_ACCESS_KEY", webEnv);
const r2Bucket = env("R2_BUCKET_NAME", webEnv);
const r2PublicUrl = env("R2_PUBLIC_URL", webEnv);
const apiSecret = env("API_SECRET", localEnv);

async function main(): Promise<void> {
const inputPath = process.argv[2];
  if (!inputPath) {
  console.error("usage: test-live-pipeline.ts <input.mp4>");
  process.exit(2);
  }
  const original = readFileSync(inputPath);

// ── before stats ────────────────────────────────────────────────────────────
function probe(path: string): Record<string, string> {
  const json = execFileSync("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path], { encoding: "utf8" });
  const d = JSON.parse(json);
  const v = d.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  const a = d.streams.find((s: { codec_type: string }) => s.codec_type === "audio");
  return {
    codec: v?.codec_name ?? "?",
    size: `${v?.width}x${v?.height}`,
    fps: v?.avg_frame_rate ?? "?",
    duration: `${Math.round(Number(d.format?.duration ?? 0) * 1000)}ms`,
    audio: a?.codec_name ?? "none",
    bytes: d.format?.size ?? "?",
  };
  }
  const before = probe(inputPath);
console.log("BEFORE :", JSON.stringify(before));

// ── media id + keys (identical layout to the pipeline) ──────────────────────
  const mediaId = crypto.randomUUID();
  const prefix = "media/videos";
  const originalKey = `${prefix}/original/${mediaId}`;
  const processedKey = `${prefix}/processed/${mediaId}.mp4`;

// ── 1. upload original to R2 ────────────────────────────────────────────────
  const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: r2AccessKeyId, secretAccessKey: r2SecretAccessKey },
  });
  await r2.send(new PutObjectCommand({ Bucket: r2Bucket, Key: originalKey, Body: original, ContentType: "video/mp4" }));
console.log(`[1] original uploaded to R2: ${originalKey} (${original.length} bytes)`);

// ── 2. queue it ─────────────────────────────────────────────────────────────
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const userId = readFileSync("/tmp/transcoder-deploy/userid.txt", "utf8").trim();
  const { error } = await db.from("video_media").insert({
  user_id: userId,
  status: "queued",
  strategy: "transcode",
  original_key: originalKey,
  original_url: `${r2PublicUrl}/${originalKey}`,
  original_size: original.length,
  });
  if (error) throw new Error(`queue insert failed: ${error.message}`);
console.log(`[2] queued video_media row: ${mediaId}`);

// ── 3. wait for the transcoder ──────────────────────────────────────────────
  const deadline = Date.now() + 120_000;
let row: Record<string, unknown> | null = null;
  process.stdout.write("[3] waiting for transcoder");
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 5000));
  process.stdout.write(".");
  const { data } = await db.from("video_media").select("*").eq("id", mediaId).single();
  row = data as Record<string, unknown> | null;
  const status = String(row?.status ?? "?");
  if (status === "ready" || status === "failed") break;
  }
console.log();
  const status = String(row?.status ?? "timeout");
console.log(`[3] final status: ${status}${row?.error_message ? ` — ${row?.error_message}` : ""}`);

// ── 4. after comparison ─────────────────────────────────────────────────────
  if (status === "ready") {
  const res = await r2.send(new GetObjectCommand({ Bucket: r2Bucket, Key: processedKey }));
  const processed = Buffer.from(await res.Body!.transformToByteArray());
  const tmp = "/tmp/transcoder-deploy/live-after.mp4";
  unlinkSync(tmp);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(tmp, processed);
  const after = probe(tmp);
  console.log("AFTER  :", JSON.stringify(after));
  console.log(`[4] processed object: ${processedKey} (${processed.length} bytes)`);
  console.log(`[4] poster object: ${row?.poster_key ?? "none"}`);
  console.log(`[4] processing_ms: ${row?.processing_ms ?? "?"} | attempts: ${row?.attempts ?? "?"}`);
  const ok =
    before.size === after.size &&
    before.fps === after.fps &&
    after.codec === "h264";
  console.log(ok ? "✓ MATCH: resolution + fps preserved, H.264 output" : "✗ MISMATCH — inspect above");
  } else {
  console.log(`[4] no processed output to compare (status=${status})`);
  }

// ── 5. cleanup: row + R2 objects ──────────────────────────────────────────────────────
  await db.from("video_media").delete().eq("id", mediaId);
  await r2.send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: originalKey }));
try {
  await r2.send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: processedKey }));
  } catch { /* processed object may not exist if status != ready */ }
console.log("[5] cleaned: DB row + R2 original removed; processed object removed if it existed");

}

main().catch((error) => { console.error(error); process.exit(1); });
