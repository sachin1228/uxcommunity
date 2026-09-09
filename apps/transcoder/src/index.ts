/**
 * Server-side video transcoder — the durable encode engine of the pipeline.
 *
 * Polls `video_media` rows queued by the web app, encodes originals with
 * NATIVE ffmpeg (the exact same shared argv the browser worker uses),
 * uploads the canonical MP4 + poster to the media-ID derived R2 keys, and
 * completes the job through the web app's internal API — so `ready` rows,
 * post patching and delete-during-processing checks all stay in one place.
 *
 * Resilience:
 *  - atomic claim (`claimVideoJob`) — any number of workers may run;
 *  - crashed workers' leases are reclaimed (`reclaimExpiredVideoJobs`) —
 *    re-encoding is safe because the processed key is media-ID derived;
 *  - failures are recorded (`markVideoFailed`) with code + stderr tail so
 *    the UI can offer a retry and humans can debug;
 *  - temp files are removed on success AND failure (per-job temp dirs);
 *  - a hard per-job timeout kills runaway encodes;
 *  - completing an already-ready row is a no-op; completing a deleted row
 *    returns 410 and the output is discarded.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import {
  claimVideoJob,
  markVideoFailed,
  reclaimExpiredVideoJobs,
  type VideoMediaRow,
} from "@uxcommunity/shared";
import { createR2Store } from "./r2";
import { encodeJob } from "./encode";
import { loadEnv } from "./env";

const ENCODE_INPUT_NAME = "input.mp4";
const ENCODE_OUTPUT_NAME = "output.mp4";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Fails the job in the DB and returns the safe error message to log. */
async function failJob(
  db: SupabaseClient,
  mediaId: string,
  code: string,
  error: unknown,
): Promise<string> {
  const detail = error instanceof Error ? error.message : String(error);
  await markVideoFailed(db, mediaId, code, detail);
  return detail;
}

/**
 * Processes one claimed job end-to-end. All temp files live in a per-job
 * directory that is removed on every exit path.
 */
async function processJob(db: SupabaseClient, row: VideoMediaRow): Promise<void> {
  const env = loadEnv();
  const mediaId = row.id;
  const tempDir = join(env.tempDir, mediaId);
  await fs.mkdir(tempDir, { recursive: true });

  // Track what THIS attempt uploaded so a failure never deletes an object
  // another worker produced for the same media ID after a lease re-claim.
  let uploadedProcessed = false;
  let uploadedPoster = false;

  try {
    const r2 = createR2Store(env);
    console.log(`[transcoder] job ${mediaId} started (strategy=${row.strategy ?? "?"})`);

    const startedAt = Date.now();
    const originalKey = row.original_key ?? r2.keys.original(mediaId);

    // 1. Download the original into the job dir (never trust URL columns —
    //    fetch by key).
    const originalBytes = await r2.getObject(originalKey);
    if (originalBytes.length === 0) throw new Error("original object is empty");
    await fs.writeFile(join(tempDir, ENCODE_INPUT_NAME), originalBytes);

    // 2. Inspect + encode with the SHARED decision/argv.
    const outcome = await encodeJob(env, tempDir);
    const processedBytes = await fs.readFile(outcome.outputPath);
    if (processedBytes.length === 0) throw new Error("encode produced an empty output");

    // 3. Upload the canonical MP4 to the media-ID derived key.
    const processedKey = r2.keys.processed(mediaId);
    await r2.putObject(processedKey, processedBytes, "video/mp4");
    uploadedProcessed = true;

    // 4. Poster (optional — separate object, never blocks completion).
    if (outcome.posterPath) {
      try {
        const posterBytes = await fs.readFile(outcome.posterPath);
        await r2.putObject(r2.keys.poster(mediaId), posterBytes, "image/jpeg");
        uploadedPoster = true;
      } catch (posterError) {
        console.error(`[transcoder] poster upload failed for ${mediaId}:`, posterError);
      }
    }

    // 5. Complete through the web app — idempotent, discard-aware, patched.
    const response = await fetch(`${env.appUrl}/api/internal/video/complete`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.apiSecret}`,
      },
      body: JSON.stringify({
        mediaId,
        size: processedBytes.length,
        width: outcome.probe.width,
        height: outcome.probe.height,
        fps: outcome.probe.fps,
        durationMs: outcome.probe.durationMs,
        videoCodec: outcome.probe.videoCodec,
        audioCodec: outcome.probe.audioCodec,
        processingMs: Date.now() - startedAt,
      }),
    });

    if (response.status === 410) {
      console.log(`[transcoder] job ${mediaId} discarded — content deleted while processing`);
      return;
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`complete route returned ${response.status}: ${text.slice(0, 300)}`);
    }

    console.log(`[transcoder] job ${mediaId} done in ${Date.now() - startedAt}ms`);
  } catch (error) {
    const detail = await failJob(db, mediaId, "transcoder-failed", error);
    console.error(`[transcoder] job ${mediaId} failed:`, detail);

    // Remove partial objects THIS attempt wrote, so a truncated canonical
    // never lingers at the ready key. (See the flags above — objects from a
    // previous attempt are left alone.)
    try {
      const r2 = createR2Store(env);
      if (uploadedProcessed) await r2.deleteObject(r2.keys.processed(mediaId));
      if (uploadedPoster) await r2.deleteObject(r2.keys.poster(mediaId));
    } catch (cleanupError) {
      console.error(`[transcoder] partial-object cleanup failed for ${mediaId}:`, cleanupError);
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  console.log(`[transcoder] starting worker "${env.workerId}" (poll=${env.pollIntervalMs}ms, batch=${env.jobBatchSize}, ffmpeg=${env.ffmpegPath})`);

  const db = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });

  while (true) {
    try {
      // 1. Pick up jobs whose lease expired (a worker crashed mid-encode).
      const reclaimed = await reclaimExpiredVideoJobs(db, env.workerId, env.claimLeaseMs);
      for (const row of reclaimed) {
        console.warn(`[transcoder] reclaiming expired job ${row.id} (was ${row.claimed_by ?? "unknown"})`);
      }

      // 2. Claim + process up to batchSize queued jobs.
      let processed = 0;
      while (processed < env.jobBatchSize) {
        const row = await claimVideoJob(db, env.workerId);
        if (!row) break;
        processed += 1;
        await processJob(db, row);
      }
    } catch (error) {
      // Loop-level failures (DB down, bad env) must never kill the worker.
      console.error("[transcoder] poll cycle failed:", error);
    }

    await sleep(env.pollIntervalMs);
  }
}

main().catch((error) => {
  console.error("[transcoder] fatal:", error);
  process.exit(1);
});