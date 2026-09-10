/**
 * FFmpeg worker — the encoding engine of the centralized video pipeline.
 *
 * A dedicated Web Worker runs ffmpeg.wasm (real FFmpeg compiled to
 * WebAssembly) so the main thread never blocks during a transcode. The core
 * (~31 MB wasm) is fetched lazily on the first transcode from the
 * self-hosted R2 origin (NEXT_PUBLIC_FFMPEG_CORE_BASE_URL — see
 * scripts/upload-ffmpeg-core.mjs) and cached by the browser.
 *
 * Protocol (main thread ↔ this worker):
 *   in:  { type: "encode", id, file, decision }
 *   out: { type: "progress", id, progress }           0–100
 *        { type: "done", id, file, probe, meta }      processed MP4 File
 *        { type: "error", id, code, message }         safe, user-friendly
 *
 * Before encoding, the source is inspected with ffmpeg.wasm's built-in
 * ffprobe (codec, resolution, frame rate, pixel format, rotation, bitrate,
 * audio) — the same inspection the pipeline's decisions are based on. If
 * probing fails, we refuse to guess and report `probe-failed` so the caller
 * can fall back to shipping the lossless original instead of risking a
 * broken or audio-less encode.
 *
 * Jobs are serialized through a single FFmpeg instance (the worker handles
 * one message at a time) and every MEMFS file is deleted after each job, so
 * the worker's filesystem never grows across encodes.
 */

/// <reference lib="webworker" />

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { FFMPEG, VIDEO_ENCODE } from "./video-config";
import { parseFfprobeJson, parseFfmpegProbe } from "./probe-parser";
import { buildEncodeArgs, ENCODE_INPUT_NAME, ENCODE_OUTPUT_NAME } from "./video-encode";
import type { FfmpegProbeResult, VideoDecision } from "./video-types";

interface EncodeRequest {
  type: "encode";
  id: string;
  file: File;
  decision: VideoDecision;
}

type WorkerMessage = EncodeRequest;

const PROBE_OUTPUT_NAME = "probe.json";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

let ffmpeg: FFmpeg | null = null;

/** Lazily loads the ffmpeg core once and reuses it for every job. */
async function getFfmpeg(): Promise<FFmpeg> {
  if (ffmpeg?.loaded) return ffmpeg;
  if (!ffmpeg) ffmpeg = new FFmpeg();
  const coreURL = await toBlobURL(FFMPEG.coreUrl, "text/javascript");
  const wasmURL = await toBlobURL(FFMPEG.wasmUrl, "application/wasm");
  await ffmpeg.load({ coreURL, wasmURL });
  return ffmpeg;
}

/**
 * Runs ffprobe (bundled in the wasm core) against the input file and parses
 * the JSON report. Falls back to parsing `ffmpeg -i` stderr when ffprobe is
 * unavailable. Returns null when neither produced a usable probe.
 */
async function probeInput(
  instance: FFmpeg,
  logTail: string[],
): Promise<FfmpegProbeResult | null> {
  try {
    await instance.ffprobe([
      "-v",
      "error",
      "-show_entries",
      "stream=codec_name,codec_type,width,height,pix_fmt,r_frame_rate,avg_frame_rate,duration,bit_rate,channels,rotation:format=duration,bit_rate",
      "-of",
      "json",
      ENCODE_INPUT_NAME,
      "-o",
      PROBE_OUTPUT_NAME,
    ]);
    const data = await instance.readFile(PROBE_OUTPUT_NAME);
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    const parsed = parseFfprobeJson(text);
    if (parsed.videoCodec) return parsed;
  } catch {
    // ffprobe unavailable in this build — fall through to `-i` parsing.
  }

  try {
    await instance.exec(["-i", ENCODE_INPUT_NAME]);
  } catch {
    // `ffmpeg -i` with no output always exits non-zero — expected.
  }
  const probe = parseFfmpegProbe(logTail.join("\n"));
  return probe.videoCodec ? probe : null;
}

async function handleEncode(request: EncodeRequest): Promise<void> {
  const { id, file, decision } = request;
  const logTail: string[] = [];

  try {
    if (!FFMPEG.coreBaseUrl) {
      postError(
        id,
        "engine-unavailable",
        new Error("NEXT_PUBLIC_FFMPEG_CORE_BASE_URL is not configured"),
        "Video processing couldn't start (engine unavailable).",
      );
      return;
    }
    let instance: FFmpeg;
    try {
      instance = await getFfmpeg();
    } catch (error) {
      postError(id, "engine-unavailable", error, "Video processing couldn't start (engine unavailable).");
      return;
    }

    instance.on("log", ({ message }) => {
      logTail.push(message);
      if (logTail.length > 200) logTail.shift();
    });

    // ── Inspect the source before encoding (ffprobe). ─────────────────────
    const probe = await probeInput(instance, logTail);
    if (!probe) {
      postError(id, "probe-failed", new Error("Could not inspect the video."), "We couldn't analyze this video.");
      return;
    }

    const input = await fetchFile(file);
    await instance.writeFile(ENCODE_INPUT_NAME, input);

    // ── Encode with progress. ─────────────────────────────────────────────
    const onProgress = ({ progress }: { progress: number }) => {
      const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
      scope.postMessage({ type: "progress", id, progress: percent });
    };
    instance.on("progress", onProgress);

    const args = buildEncodeArgs(probe, decision);
    try {
      await instance.exec(args);
    } finally {
      instance.off("progress", onProgress);
    }

    const output = await instance.readFile(ENCODE_OUTPUT_NAME);
    const processed = new File(
      [output as unknown as BlobPart],
      `video-${id}.mp4`,
      { type: "video/mp4" },
    );

    scope.postMessage({
      type: "done",
      id,
      file: processed,
      probe,
      meta: {
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        durationMs: probe.durationMs,
        videoCodec: probe.videoCodec,
        audioCodec: probe.audioCodec,
        pixelFormat: probe.pixelFormat,
      },
    });

    // ── Temporary-file cleanup (input + output + probe report). ───────────
    await cleanup(instance);
  } catch (error) {
    await cleanup(ffmpeg);
    postError(id, "encode-failed", error, "Video processing failed. Please try again.");
  }
}

async function cleanup(instance: FFmpeg | null): Promise<void> {
  if (!instance?.loaded) return;
  for (const name of [ENCODE_INPUT_NAME, ENCODE_OUTPUT_NAME, PROBE_OUTPUT_NAME]) {
    try {
      await instance.deleteFile(name);
    } catch {
      // Missing file — nothing to clean.
    }
  }
}

function postError(id: string, code: string, error: unknown, message: string): void {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[video-worker] ${code}:`, detail);
  scope.postMessage({ type: "error", id, code, message });
}

scope.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  if (message?.type === "encode") {
    void handleEncode(message);
  }
};