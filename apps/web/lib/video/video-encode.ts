/**
 * FFmpeg argument builder for the canonical video encode.
 *
 * Pure function — feed it the worker's probe result and the client's
 * decision, get the exact argv for `ffmpeg.exec`. This is the single place
 * the FFmpeg command line is constructed (no scattered `-crf` flags), so
 * the encoder policy from `video-config.ts` can never drift between paths.
 *
 * Baseline (see docs/video-processing.md):
 *
 *   ffmpeg -i input.mp4 -map 0:v:0 -c:v libx264 -preset slow -crf 18 \
 *     -profile:v high -pix_fmt yuv420p -movflags +faststart \
 *     -map 0:a:0? -c:a aac -b:a 192k -max_muxing_queue_size 1024 output.mp4
 *
 * Resolution, frame rate, aspect ratio and rotation are preserved implicitly:
 * no scale/crop/fps filters are ever added. `-map 0:v:0` selects the primary
 * video stream; `-map 0:a:0?` adds the first audio stream only when present
 * (silent sources stay silent — no synthesized track).
 */

import { VIDEO_ENCODE } from "./video-config";
import type { FfmpegProbeResult, VideoDecision } from "./video-types";

export const ENCODE_INPUT_NAME = "input.mp4";
export const ENCODE_OUTPUT_NAME = "output.mp4";

/** 10-bit sources keep their bit depth; everything else goes yuv420p. */
export function pixelFormatFor(probe: FfmpegProbeResult): string {
  const fmt = probe.pixelFormat?.toLowerCase() ?? "";
  return fmt.includes("10") ? VIDEO_ENCODE.pixelFormat10Bit : VIDEO_ENCODE.pixelFormat;
}

/**
 * Builds the FFmpeg argv for one canonical encode. `copyVideo` (from the
 * decision) copies the H.264 stream bit-identically while re-encoding only
 * the audio — used for sources whose audio browsers can't play in MP4.
 */
export function buildEncodeArgs(
  probe: FfmpegProbeResult,
  decision: VideoDecision,
): string[] {
  const args: string[] = ["-i", ENCODE_INPUT_NAME, "-map", "0:v:0"];

  if (decision.copyVideo) {
    args.push("-c:v", "copy");
  } else {
    const pixelFormat = pixelFormatFor(probe);
    args.push(
      "-c:v",
      VIDEO_ENCODE.codec,
      "-preset",
      decision.preset,
      "-crf",
      String(VIDEO_ENCODE.crf),
      "-pix_fmt",
      pixelFormat,
    );
    // `high` is an 8-bit profile — libx264 refuses it for 10-bit output.
    // For 10-bit (HDR/wide-gamut) sources the profile is omitted so the
    // encoder selects High10 automatically.
    if (pixelFormat !== VIDEO_ENCODE.pixelFormat10Bit) {
      args.push("-profile:v", VIDEO_ENCODE.profile);
    }
  }

  // Audio: only when the source actually has an audio stream.
  if (probe.audioCodec) {
    const channels = probe.audioChannels ?? 0;
    args.push(
      "-map",
      "0:a:0?",
      "-c:a",
      VIDEO_ENCODE.audioCodec,
      "-b:a",
      channels > 2 ? VIDEO_ENCODE.audioBitrateMultiChannel : VIDEO_ENCODE.audioBitrate,
    );
  }

  if (VIDEO_ENCODE.faststart) args.push("-movflags", "+faststart");
  args.push("-max_muxing_queue_size", String(VIDEO_ENCODE.maxMuxingQueueSize));
  args.push(ENCODE_OUTPUT_NAME);

  return args;
}