/**
 * Client-side video pipeline — the single integration point every video
 * upload in the app flows through.
 *
 *   User picks a video
 *     → probe the source (mediabunny + byte inspection)
 *     → decide the strategy (passthrough / lossless remux / FFmpeg transcode)
 *     → upload to R2 via the showcase upload route (original vs canonical)
 *     → when transcoding: FFmpeg worker encodes with progress
 *     → finalize: canonical MP4 + poster to R2, DB state → ready
 *
 * The server owns the state machine (`video_media` rows); this module owns
 * the bytes and the encode. Processing is asynchronous and resumable: a
 * failed or interrupted transcode leaves the original in R2 and the media
 * row in `uploaded`/`failed`, so retrying never requires re-uploading.
 */

import type { ShowcaseAttachment } from "@/components/communities/showcase/types";
import { processVideoForUpload } from "@/lib/video-client";
import { decideVideoStrategy, presetForDimensions } from "./video-decision";
import { probeVideoFile } from "./video-probe";
import type {
  VideoDecision,
  VideoEncodeResult,
  VideoProbeResult,
  VideoStatus,
} from "./video-types";

export interface PreparedVideo {
  /** The file to upload (remuxed when the strategy is remux, original otherwise). */
  file: File;
  /** First-frame poster captured client-side (uploaded at finalize for transcodes). */
  poster: Blob | null;
  probe: VideoProbeResult;
  decision: VideoDecision;
}

export interface VideoUploadResponse {
  mediaId: string;
  status: "queued" | "ready";
  attachment: ShowcaseAttachment;
}

/** How often the composer polls the server-side transcoder queue. */
export const QUEUED_POLL_INTERVAL_MS = 2500;
/**
 * How long to wait for the server-side transcoder before falling back to the
 * in-browser FFmpeg wasm worker (local dev without a transcoder, or a worker
 * outage). The fallback keeps uploads moving; finalize is idempotent, so if
 * the server worker finishes first the client's finalize short-circuits.
 */
export const QUEUED_FALLBACK_AFTER_MS = 60_000;

export interface VideoFinalizeResponse {
  mediaId: string;
  status: "ready" | "deleted";
  attachment: ShowcaseAttachment | null;
  discarded?: boolean;
}

const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

/** Video MIME types accepted by the pipeline (mirrors the upload route). */
export const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

/**
 * Probe + decide + (losslessly) prepare a source file for the pipeline.
 * Never throws for probe/prepare failures — unprobeable files fall back to
 * passthrough so uploads never break because preprocessing did.
 */
export async function prepareVideoForPipeline(file: File): Promise<PreparedVideo> {
  const probe = await probeVideoFile(file);
  let decision = decideVideoStrategy(probe);

  // Poster capture + lossless remux (MOV→MP4 / moov→front) via mediabunny.
  // Fails soft — the original file is kept.
  const prepared = await processVideoForUpload(file);

  if (decision.strategy === "remux") {
    if (prepared.remuxed) {
      decision = { ...decision, strategy: "passthrough", reason: "remuxed-lossless" };
    } else {
      // Remux unavailable (exotic layout) — a real encode is the safer bet.
      decision = {
        strategy: "transcode",
        preset: presetForDimensions(probe),
        reason: "remux-unavailable",
      };
    }
  }

  // Transcodes use the ORIGINAL bytes (ffmpeg handles container + rotation);
  // remux/passthrough use the prepared (possibly remuxed) file.
  const payload = decision.strategy === "transcode" ? file : prepared.file;

  return { file: payload, poster: prepared.poster, probe, decision };
}

/** Uploads the (prepared) video to R2 and creates the `video_media` row. */
export async function uploadVideo(
  communityId: string,
  prepared: PreparedVideo,
): Promise<VideoUploadResponse> {
  if (prepared.file.size > MAX_VIDEO_BYTES) {
    throw new Error("Videos must be 25 MB or smaller.");
  }

  const form = new FormData();
  form.append("file", prepared.file);
  form.append("strategy", prepared.decision.strategy);
  if (prepared.decision.preset) form.append("preset", prepared.decision.preset);
  form.append("copyVideo", prepared.decision.copyVideo ? "1" : "0");

  // Probing metadata — recorded on the video_media row (server clamps).
  appendFormNumber(form, "width", prepared.probe.width);
  appendFormNumber(form, "height", prepared.probe.height);
  appendFormNumber(form, "fps", prepared.probe.fps);
  appendFormNumber(form, "durationMs", prepared.probe.durationMs);
  appendFormString(form, "videoCodec", prepared.probe.videoCodec);
  appendFormString(form, "audioCodec", prepared.probe.audioCodec);

  // Posters ride along for passthrough/remux (they land at finalize for
  // transcodes, after the encode produces the canonical file).
  if (prepared.decision.strategy !== "transcode" && prepared.poster) {
    form.append("poster", prepared.poster, "poster.jpg");
  }

  const response = await fetch(`/api/communities/${communityId}/showcase/upload`, {
    method: "POST",
    body: form,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Upload failed.");
  return data as VideoUploadResponse;
}

/**
 * Runs the FFmpeg worker (single shared instance, jobs serialized) and
 * returns the canonical MP4 + probe metadata. Progress is reported 0–100.
 */
export async function encodeVideo(
  mediaId: string,
  file: File,
  decision: VideoDecision,
  onProgress: (progress: number) => void,
): Promise<VideoEncodeResult> {
  return transcodeViaWorker({ id: mediaId, file, decision }, onProgress);
}

/** Posts the processed MP4 + poster; the server flips the row to `ready`. */
export async function finalizeVideo(
  communityId: string,
  mediaId: string,
  processed: Blob,
  poster: Blob | null,
  meta: Pick<VideoEncodeResult, "width" | "height" | "fps" | "durationMs" | "videoCodec" | "audioCodec">,
  processingMs: number,
): Promise<VideoFinalizeResponse> {
  const form = new FormData();
  form.append("mediaId", mediaId);
  form.append("file", processed, `video-${mediaId}.mp4`);
  if (poster) form.append("poster", poster, "poster.jpg");
  form.append("processingMs", String(Math.round(processingMs)));
  appendFormNumber(form, "width", meta.width);
  appendFormNumber(form, "height", meta.height);
  appendFormNumber(form, "fps", meta.fps);
  appendFormNumber(form, "durationMs", meta.durationMs);
  appendFormString(form, "videoCodec", meta.videoCodec);
  appendFormString(form, "audioCodec", meta.audioCodec);

  const response = await fetch(`/api/communities/${communityId}/showcase/video-finalize`, {
    method: "POST",
    body: form,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Processing failed.");
  return data as VideoFinalizeResponse;
}

/**
 * Polls the server-side transcoder status for a queued video.
 * Resolves with the current row state (and the canonical attachment when
 * ready). Never throws for network hiccups — returns the last known state.
 */
export async function getVideoStatus(
  communityId: string,
  mediaId: string,
): Promise<{ status: VideoStatus; attachment: ShowcaseAttachment | null }> {
  const response = await fetch(
  `/api/communities/${communityId}/showcase/video-status?mediaId=${encodeURIComponent(mediaId)}`,
  );
  const data = await response.json();
  if (!response.ok) {
    return { status: "uploaded", attachment: null };
  }
  return data as { status: VideoStatus; attachment: ShowcaseAttachment | null };
}

/**
 * Waits for a queued video to reach a terminal state (ready / failed /
 * deleted), polling until `timeoutMs` elapses. Returns the terminal
 * attachment (ready) or null when the wait timed out.
 */
export async function pollQueuedVideo(
  communityId: string,
  mediaId: string,
  opts: { intervalMs?: number; timeoutMs?: number; onProgress?: (status: VideoStatus) => void } = {},
): Promise<{ status: VideoStatus; attachment: ShowcaseAttachment | null }> {
  const intervalMs = opts.intervalMs ?? QUEUED_POLL_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? QUEUED_FALLBACK_AFTER_MS;
  const deadline = Date.now() + timeoutMs;

  let last: { status: VideoStatus; attachment: ShowcaseAttachment | null } = {
    status: "queued",
    attachment: null,
  };
  while (Date.now() < deadline) {
    try {
      last = await getVideoStatus(communityId, mediaId);
      opts.onProgress?.(last.status);
      if (last.status !== "queued" && last.status !== "processing" && last.status !== "uploaded") {
        return last;
      }
    } catch {
      // Transient network error — keep polling until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return last;
}

/**
 * Fallback used when the FFmpeg engine cannot run at all (CDN unreachable,
 * wasm unsupported, probe failure): the lossless ORIGINAL becomes the
 * canonical video (R2 copy, no re-encode, no quality loss).
 */
export async function finalizeVideoPassthrough(
  communityId: string,
  mediaId: string,
): Promise<VideoFinalizeResponse> {
  const response = await fetch(`/api/communities/${communityId}/showcase/video-finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mediaId, passthrough: true }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Processing failed.");
  return data as VideoFinalizeResponse;
}

/** Discards an uploaded-but-unused video (composer removal) — best effort. */
export async function cancelVideo(communityId: string, mediaId: string): Promise<void> {
  try {
    await fetch(`/api/communities/${communityId}/showcase/video-cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaId }),
    });
  } catch {
    // Best effort — the abandoned-upload sweep cleans up leftovers.
  }
}

// ── Worker manager ──────────────────────────────────────────────────────────

let worker: Worker | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function getWorker(): Promise<Worker> {
  if (worker) return worker;
  worker = new Worker(new URL("./video-worker.ts", import.meta.url));
  return worker;
}

function transcodeViaWorker(
  job: { id: string; file: File; decision: VideoDecision },
  onProgress: (progress: number) => void,
): Promise<VideoEncodeResult> {
  const run = () =>
    new Promise<VideoEncodeResult>((resolve, reject) => {
      void getWorker().then((instance) => {
        const startedAt = performance.now();
        const onMessage = (event: MessageEvent) => {
          const message = event.data;
          if (!message || message.id !== job.id) return;
          if (message.type === "progress") {
            onProgress(message.progress);
          } else if (message.type === "done") {
            instance.removeEventListener("message", onMessage);
            resolve({
              file: message.file as Blob,
              name: `video-${job.id}.mp4`,
              width: message.meta?.width ?? null,
              height: message.meta?.height ?? null,
              fps: message.meta?.fps ?? null,
              durationMs: message.meta?.durationMs ?? null,
              videoCodec: message.meta?.videoCodec ?? null,
              audioCodec: message.meta?.audioCodec ?? null,
              pixelFormat: message.meta?.pixelFormat ?? null,
              probe: message.probe,
            });
          } else if (message.type === "error") {
            instance.removeEventListener("message", onMessage);
            const error = new Error(message.message ?? "Video processing failed.");
            (error as Error & { code?: string }).code = message.code ?? "encode-failed";
            (error as Error & { encodeMs?: number }).encodeMs = performance.now() - startedAt;
            reject(error);
          }
        };
        instance.addEventListener("message", onMessage);
        instance.postMessage(job);
      });
    });

  // Serialize: one encode at a time on the single FFmpeg instance.
  const result = queue.then(run, run);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function appendFormNumber(form: FormData, name: string, value: number | null): void {
  if (value !== null && Number.isFinite(value)) form.append(name, String(value));
}

function appendFormString(form: FormData, name: string, value: string | null): void {
  if (value) form.append(name, value.slice(0, 64));
}