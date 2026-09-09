/**
 * Native ffmpeg encoding for the transcoder service.
 *
 * Runs the SAME decision logic and the SAME argv builder as the browser
 * worker (`decideVideoStrategy` + `buildEncodeArgs` from @uxcommunity/shared)
 * — the only difference is the engine: a real ffmpeg binary instead of
 * ffmpeg.wasm. Resolution, frame rate, aspect ratio and rotation are
 * preserved; sources that turn out to be already-optimal are shipped with
 * zero re-encoding.
 *
 * Temp-file hygiene: every job runs in its own temp dir and the caller is
 * responsible for removing it (success AND failure) — see `processJob`.
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import {
  buildEncodeArgs,
  decideVideoStrategy,
  ENCODE_INPUT_NAME,
  ENCODE_OUTPUT_NAME,
  isFaststart,
  parseFfprobeJson,
  sniffVideoContainer,
  type FfmpegProbeResult,
  type VideoDecision,
  type VideoProbeResult,
} from "@uxcommunity/shared";
import type { TranscoderEnv } from "./env";

export interface EncodeOutcome {
  /** Where the canonical MP4 is (inside tempDir). */
  outputPath: string;
  /** Fresh server-side probe of the source (bytes + ffprobe). */
  probe: VideoProbeResult;
  /** The decision the worker actually executed (may differ from the row's). */
  decision: VideoDecision;
  /** Poster JPEG path, when a frame could be extracted. */
  posterPath: string | null;
  /** Encode wall time in ms (includes probe, excludes download/upload). */
  processingMs: number;
}

interface CommandResult {
  code: number;
  stderrTail: string;
}

function runCommand(
  bin: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`${bin} timed out after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 64 * 1024) stderr = stderr.slice(-64 * 1024);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stderrTail: stderr.slice(-4000) });
    });
  });
}

/** ffprobe JSON via stdout capture, parsed with the shared parser. */
async function probeFileJson(
  env: TranscoderEnv,
  inputPath: string,
  timeoutMs: number,
): Promise<FfmpegProbeResult> {
  const { code, stdout, stderrTail } = await runCommandCapture(
    env.ffprobePath,
    [
      "-v", "error",
      "-show_entries",
      "stream=codec_name,codec_type,width,height,pix_fmt,r_frame_rate,avg_frame_rate,duration,bit_rate,channels,rotation:format=duration,bit_rate,format_name",
      "-of", "json",
      inputPath,
    ],
    { cwd: process.cwd(), timeoutMs },
  );
  if (code !== 0) {
    throw new Error(`ffprobe failed (exit ${code}): ${stderrTail.slice(0, 500)}`);
  }
  const probe = parseFfprobeJson(stdout);
  if (!probe.videoCodec) {
    throw new Error(`ffprobe produced no video stream: ${stderrTail.slice(0, 500)}`);
  }
  return probe;
}

function runCommandCapture(
  bin: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<{ code: number; stdout: string; stderrTail: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`${bin} timed out after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 256 * 1024) stdout = stdout.slice(-256 * 1024);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 64 * 1024) stderr = stderr.slice(-64 * 1024);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderrTail: stderr.slice(-4000) });
    });
  });
}

/** Args for a lossless remux (container/index fixes only, zero re-encode). */
function remuxArgs(): string[] {
  return ["-i", ENCODE_INPUT_NAME, "-c", "copy", "-movflags", "+faststart", ENCODE_OUTPUT_NAME];
}

/**
 * Merges the ffprobe stream report with byte-level container sniffing into
 * the full probe shape the shared decision logic expects. The container is
 * taken from the actual bytes (never the extension/MIME), matching the web
 * app's sniffing.
 */
export function buildVideoProbe(
  inputBytes: Buffer,
  ffmpeg: FfmpegProbeResult,
): VideoProbeResult {
  const sniffed = sniffVideoContainer(inputBytes);
  const container: VideoProbeResult["container"] =
    sniffed === "webm" ? "webm" : sniffed === "mov" ? "mov" : sniffed === "mp4" ? "mp4" : "unknown";
  return {
    container,
    videoCodec: ffmpeg.videoCodec,
    width: ffmpeg.width,
    height: ffmpeg.height,
    fps: ffmpeg.fps,
    durationMs: ffmpeg.durationMs,
    audioCodec: ffmpeg.audioCodec,
    bitrateMbps: ffmpeg.bitrateMbps,
    faststart: isFaststart(inputBytes),
    rotation: ffmpeg.rotation,
    fileSize: inputBytes.length,
  };
}

/**
 * Encodes the source at `tempDir/input.mp4` into `tempDir/output.mp4` using
 * the shared decision + argv. Also extracts a poster frame (max edge 1280)
 * when the source has video. Throws with a descriptive message on failure.
 */
export async function encodeJob(
  env: TranscoderEnv,
  tempDir: string,
): Promise<EncodeOutcome> {
  const startedAt = Date.now();
  const inputPath = join(tempDir, ENCODE_INPUT_NAME);
  const outputPath = join(tempDir, ENCODE_OUTPUT_NAME);

  const inputBytes = await fs.readFile(inputPath);
  const ffmpegProbe = await probeFileJson(env, inputPath, env.processTimeoutMs);
  const probe = buildVideoProbe(inputBytes, ffmpegProbe);
  const decision = decideVideoStrategy(probe);

  let args: string[];
  if (decision.strategy === "passthrough") {
    // Server inspection disagrees with the client's transcode decision
    // (e.g. codec misdetection). Ship the lossless original instead.
    await fs.copyFile(inputPath, outputPath);
  } else if (decision.strategy === "remux") {
    args = remuxArgs();
    await runFfmpeg(env, args, tempDir);
  } else {
    // pixelFormat/audioChannels come from ffprobe; the merged probe drives
    // the decision. buildEncodeArgs only needs the ffmpeg-shaped fields.
    args = buildEncodeArgs(ffmpegProbe, decision);
    await runFfmpeg(env, args, tempDir);
  }

  let posterPath: string | null = null;
  try {
    posterPath = await extractPoster(env, tempDir);
  } catch (error) {
    // A missing poster must never fail the encode — it is optional metadata.
    console.error("[transcoder] poster extraction failed:", error);
  }

  return {
    outputPath,
    probe,
    decision,
    posterPath,
    processingMs: Date.now() - startedAt,
  };
}

async function runFfmpeg(env: TranscoderEnv, args: string[], tempDir: string): Promise<void> {
  const { code, stderrTail } = await runCommand(env.ffmpegPath, args, {
    cwd: tempDir,
    timeoutMs: env.processTimeoutMs,
  });
  if (code !== 0) {
    throw new Error(`ffmpeg failed (exit ${code}): ${stderrTail.slice(0, 1000)}`);
  }
  try {
    await fs.access(join(tempDir, ENCODE_OUTPUT_NAME));
  } catch {
    throw new Error(`ffmpeg exited 0 but produced no output: ${stderrTail.slice(0, 500)}`);
  }
}

/** One high-quality JPEG frame for the feed — separate R2 object per policy. */
async function extractPoster(env: TranscoderEnv, tempDir: string): Promise<string | null> {
  const posterName = "poster.jpg";
  const { code, stderrTail } = await runCommand(
    env.ffmpegPath,
    [
      "-ss", "1",
      "-i", ENCODE_INPUT_NAME,
      "-frames:v", "1",
      "-vf", "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease",
      "-q:v", "3",
      "-y",
      posterName,
    ],
    { cwd: tempDir, timeoutMs: 60_000 },
  );
  if (code !== 0) {
    console.error(`[transcoder] poster frame failed (exit ${code}):`, stderrTail.slice(0, 300));
    return null;
  }
  try {
    await fs.access(join(tempDir, posterName));
    return join(tempDir, posterName);
  } catch {
    return null;
  }
}