/**
 * CRF benchmark driver — measures real file-size vs quality trade-offs for
 * the pipeline's encoder config on a given source.
 *
 * For each CRF it runs the EXACT argv from `buildEncodeArgs` (the same
 * function the in-browser worker and the server-side transcoder use) with a
 * real ffmpeg binary, then measures:
 *   - output size + bitrate,
 *   - SSIM and PSNR vs the source (frame-accurate, full duration),
 *   - encode wall time.
 *
 * Usage:
 *   npx tsx --tsconfig apps/web/tsconfig.json scripts/benchmark-crf.ts \
 *     <input> <outputDir> [--crf 17,18,19] [--preset slow|medium]
 *
 * Prints one JSON line per (source, crf) run. Requires ffmpeg + ffprobe.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error Node's type-stripping runner requires an explicit TS extension.
import { buildEncodeArgs, ENCODE_INPUT_NAME, ENCODE_OUTPUT_NAME } from "../apps/web/lib/video/video-encode.ts";
// @ts-expect-error Node's type-stripping runner requires an explicit TS extension.
import { parseFfprobeJson } from "../apps/web/lib/video/probe-parser.ts";
// @ts-expect-error Node's type-stripping runner requires an explicit TS extension.
import { decideVideoStrategy, presetForDimensions } from "../apps/web/lib/video/video-decision.ts";
import type { FfmpegProbeResult, VideoDecision } from "../apps/web/lib/video/video-types.ts";

const [inputPath, outputDir] = process.argv.slice(2);
if (!inputPath || !outputDir || !existsSync(inputPath)) {
  console.error("usage: benchmark-crf.ts <input> <outputDir> [--crf 17,18,19] [--preset slow|medium]");
  process.exit(2);
}

const crfs = process.argv.includes("--crf")
  ? (process.argv[process.argv.indexOf("--crf") + 1] ?? "17,18,19").split(",").map(Number).filter(Number.isFinite)
  : [17, 18, 19];
const presetOverride = process.argv.includes("--preset")
  ? (process.argv[process.argv.indexOf("--preset") + 1] as "slow" | "medium")
  : null;

function ffprobeJson(path: string): FfmpegProbeResult {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=codec_name,codec_type,width,height,pix_fmt,r_frame_rate,avg_frame_rate,duration,bit_rate,channels:format=duration,bit_rate", "-of", "json", path],
    { encoding: "utf8" },
  );
  return parseFfprobeJson(out);
}

interface QualityResult {
  ssim: number | null;
  psnr: number | null;
}

/** Runs the ssim+psnr filters (source vs encode) and parses the averages. */
function measureQuality(sourcePath: string, encodedPath: string): QualityResult {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner", "-i", sourcePath, "-i", encodedPath,
      "-lavfi", "[0:v][1:v]ssim;[0:v][1:v]psnr",
      "-f", "null", "-",
    ],
    { encoding: "utf8" },
  );
  const stderr = result.stderr ?? "";
  const ssimMatch = stderr.match(/SSIM Y:([\d.]+)/g);
  const psnrMatch = stderr.match(/PSNR y:([\d.]+)/g);
  const ssim = ssimMatch ? parseFloat(ssimMatch[ssimMatch.length - 1].split(":")[1]) : null;
  const psnr = psnrMatch ? parseFloat(psnrMatch[psnrMatch.length - 1].split(":")[1]) : null;
  return { ssim, psnr };
}

const probe = ffprobeJson(inputPath);
const decision: VideoDecision = {
  strategy: "transcode",
  preset: presetOverride ?? presetForDimensions({ ...probe, container: "mp4", faststart: true, fileSize: statSync(inputPath).size }),
  reason: "benchmark",
};

mkdirSync(outputDir, { recursive: true });
const sourceSize = statSync(inputPath).size;
const sourceBitrateMbps = probe.bitrateMbps ?? (sourceSize * 8 / 1000 / ((probe.durationMs ?? 4000) / 1000)) / 1000;

for (const crf of crfs) {
  const workDir = join(outputDir, `crf-${crf}`);
  mkdirSync(workDir, { recursive: true });
  const inputCopy = join(workDir, ENCODE_INPUT_NAME);
  const outputPath = join(workDir, ENCODE_OUTPUT_NAME);
  writeFileSync(inputCopy, readFileSync(inputPath));

  const args = buildEncodeArgs(probe, decision, crf);
  const started = Date.now();
  const encode = spawnSync("ffmpeg", ["-hide_banner", ...args], { cwd: workDir, encoding: "utf8" });
  const encodeMs = Date.now() - started;

  if (encode.status !== 0 || !existsSync(outputPath)) {
    console.error(JSON.stringify({
      input: inputPath, crf, error: "encode failed", stderrTail: (encode.stderr ?? "").slice(-500),
    }));
    process.exitCode = 1;
    continue;
  }

  const outputSize = statSync(outputPath).size;
  const quality = measureQuality(inputPath, outputPath);
  const outProbe = ffprobeJson(outputPath);

  console.log(JSON.stringify({
    input: inputPath,
    crf,
    preset: decision.preset,
    width: outProbe.width,
    height: outProbe.height,
    fps: outProbe.fps,
    durationMs: outProbe.durationMs,
    inputSize: sourceSize,
    inputBitrateMbps: Math.round(sourceBitrateMbps * 100) / 100,
    outputSize,
    outputBitrateMbps: outProbe.bitrateMbps !== null ? Math.round(outProbe.bitrateMbps * 100) / 100 : null,
    sizeReductionPct: Math.round((1 - outputSize / sourceSize) * 1000) / 10,
    ssim: quality.ssim !== null ? Math.round(quality.ssim * 10000) / 10000 : null,
    psnr: quality.psnr !== null ? Math.round(quality.psnr * 100) / 100 : null,
    encodeMs,
    videoCodec: outProbe.videoCodec,
    pixelFormat: outProbe.pixelFormat,
  }));
}