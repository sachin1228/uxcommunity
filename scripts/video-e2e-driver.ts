/**
 * End-to-end driver for the centralized video pipeline's encoder config.
 *
 * Runs the EXACT argv produced by `buildEncodeArgs` (the same function the
 * in-browser FFmpeg worker uses) against a real input file with a real
 * ffmpeg binary, then verifies with ffprobe that the canonical output
 * preserves resolution, frame rate, duration, aspect ratio and audio — and
 * that it is faststart + yuv420p.
 *
 * Usage:
 *   npx tsx --tsconfig apps/web/tsconfig.json scripts/video-e2e-driver.ts \
 *     <input> <output> [--preset slow|medium] [--copy-video] [--expect-audio] [--expect-10bit]
 *
 * Exits non-zero when any assertion fails. Requires ffmpeg + ffprobe on PATH.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
// @ts-expect-error Node's type-stripping runner requires an explicit TS extension.
import { buildEncodeArgs, ENCODE_INPUT_NAME, ENCODE_OUTPUT_NAME } from "../apps/web/lib/video/video-encode.ts";
// @ts-expect-error Node's type-stripping runner requires an explicit TS extension.
import { parseFfprobeJson } from "../apps/web/lib/video/probe-parser.ts";
// @ts-expect-error Node's type-stripping runner requires an explicit TS extension.
import { isFaststart } from "../apps/web/lib/video-client.ts";
import type { FfmpegProbeResult, VideoDecision } from "../apps/web/lib/video/video-types.ts";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath || !existsSync(inputPath)) {
  console.error("usage: video-e2e-driver.ts <input> <output> [--preset slow|medium] [--copy-video] [--expect-audio] [--expect-10bit]");
  process.exit(2);
}

const preset = process.argv.includes("--preset")
  ? (process.argv[process.argv.indexOf("--preset") + 1] as "slow" | "medium")
  : "slow";
const copyVideo = process.argv.includes("--copy-video");
const expectAudio = process.argv.includes("--expect-audio");
const expect10Bit = process.argv.includes("--expect-10bit");

function ffprobeJson(path: string): FfmpegProbeResult {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=codec_name,codec_type,width,height,pix_fmt,r_frame_rate,avg_frame_rate,duration,bit_rate,channels:format=duration,bit_rate", "-of", "json", path],
    { encoding: "utf8" },
  );
  return parseFfprobeJson(out);
}

function check(condition: boolean, label: string): void {
  if (!condition) {
    console.error(`  ✗ ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const inputProbe = ffprobeJson(inputPath);
const decision: VideoDecision = {
  strategy: "transcode",
  preset,
  reason: "e2e",
  ...(copyVideo ? { copyVideo: true } : {}),
};

const args = buildEncodeArgs(inputProbe, decision);
console.log(`input:  ${inputPath}`);
console.log(`ffmpeg ${args.join(" ")}`);

// Stage the input under the exact MEMFS name the worker uses, run the exact
// argv, and read back the same output name the worker reads.
execFileSync("ffmpeg", ["-y", "-i", inputPath, "-c", "copy", "-movflags", "+faststart", ENCODE_INPUT_NAME], { stdio: "ignore" });
try {
  execFileSync("ffmpeg", ["-nostdin", "-y", ...args], { stdio: ["ignore", "ignore", "inherit"] });
} catch (error) {
  console.error("  ✗ ffmpeg encode failed:", (error as Error).message);
  process.exit(1);
}
execFileSync("mv", [ENCODE_OUTPUT_NAME, outputPath]);

const outputProbe = ffprobeJson(outputPath);
const outputBytes = readFileSync(outputPath);
const outputSize = outputBytes.length;
const inputSize = existsSync(inputPath) ? readFileSync(inputPath).length : 0;

console.log(`output: ${outputPath} (${(outputSize / 1e6).toFixed(2)} MB, input ${(inputSize / 1e6).toFixed(2)} MB)`);

// ── Quality-preservation assertions ──────────────────────────────────────────
check(
  outputProbe.videoCodec === "h264" || outputProbe.videoCodec === "avc1",
  `video codec is H.264 (got ${outputProbe.videoCodec})`,
);
check(outputProbe.width === inputProbe.width && outputProbe.height === inputProbe.height,
  `resolution preserved: ${inputProbe.width}x${inputProbe.height} → ${outputProbe.width}x${outputProbe.height}`);
const aspect = (inputProbe.width! / inputProbe.height!).toFixed(4);
const outAspect = (outputProbe.width! / outputProbe.height!).toFixed(4);
check(aspect === outAspect, `aspect ratio preserved: ${aspect} → ${outAspect}`);
if (inputProbe.fps && outputProbe.fps) {
  check(Math.abs(outputProbe.fps - inputProbe.fps) < 0.1,
    `frame rate preserved: ${inputProbe.fps} → ${outputProbe.fps}`);
} else {
  console.log("  (frame rate unknown on input — skipped)");
}
if (inputProbe.durationMs && outputProbe.durationMs) {
  const drift = Math.abs(outputProbe.durationMs - inputProbe.durationMs) / inputProbe.durationMs;
  check(drift < 0.02, `duration preserved (drift ${(drift * 100).toFixed(2)}%)`);
}
check(outputProbe.pixelFormat === (expect10Bit ? "yuv420p10le" : "yuv420p"),
  `pixel format ${expect10Bit ? "yuv420p10le" : "yuv420p"} (got ${outputProbe.pixelFormat})`);
check(isFaststart(new Uint8Array(outputBytes.slice(0, 4096))), "faststart (moov before mdat)");
check(Boolean(outputProbe.audioCodec) === expectAudio,
  `audio ${expectAudio ? "present (aac)" : "absent"} (got ${outputProbe.audioCodec ?? "none"})`);
if (expectAudio) {
  check(outputProbe.audioCodec === "aac", "audio codec is AAC");
}

console.log(process.exitCode ? "\n✗ FAILED" : "\n✓ PASSED");
process.exit(process.exitCode ?? 0);