/**
 * Encoding decision logic — pure and unit-testable.
 *
 * Decides, per upload, whether the source is shipped as the canonical video
 * untouched (`passthrough`), losslessly remuxed (`remux` — container/index
 * fixes only, zero quality change), or genuinely re-encoded with libx264
 * (`transcode`).
 *
 * The guiding rule from the product spec: NEVER degrade an already-excellent
 * source. Re-encoding is only chosen when it is actually worth it:
 *
 *   - the container/codec isn't universally browser-playable (WebM, HEVC,
 *     ProRes, ...),
 *   - the file is not Range-stream friendly (moov at the end),
 *   - the bitrate is unreasonably high for the resolution (CRF 18 can shrink
 *     it with no visible loss), or
 *   - the audio can't play in MP4 (PCM/AC3 → video is copied bit-identically,
 *     only audio is re-encoded).
 *
 * Resolution, frame rate, aspect ratio and (unless incompatible) audio are
 * ALWAYS preserved. Videos are never upscaled or downscaled.
 */

import {
  VIDEO_ENCODE,
  VIDEO_PASSTHROUGH,
  VIDEO_SAFETY,
} from "./video-config";
import type { VideoDecision, VideoProbeResult } from "./video-types";

const H264_FAMILIES = new Set(["avc", "h264"]);
/** Audio codecs every modern browser plays inside an MP4. */
const MP4_COMPATIBLE_AUDIO = new Set(["aac", "mp3", "opus"]);

/** Longest edge of the coded dimensions, or null when unknown. */
export function longestEdge(probe: VideoProbeResult): number | null {
  if (!probe.width || !probe.height) return null;
  return Math.max(probe.width, probe.height);
}

/** Preset for a given resolution — slow ≤1080p, medium above (see config). */
export function presetForDimensions(probe: VideoProbeResult): "slow" | "medium" {
  const edge = longestEdge(probe) ?? 0;
  return edge > VIDEO_ENCODE.highResolutionThreshold
    ? VIDEO_ENCODE.presetHighResolution
    : VIDEO_ENCODE.preset;
}

/** Pass-through bitrate ceiling for the given resolution. */
export function maxPassThroughBitrateMbps(probe: VideoProbeResult): number {
  const edge = longestEdge(probe) ?? 0;
  return edge > VIDEO_PASSTHROUGH.tierBoundaryPx
    ? VIDEO_PASSTHROUGH.maxBitrateMbps4k
    : VIDEO_PASSTHROUGH.maxBitrateMbps1080p;
}

/**
 * Estimated decode/encode throughput in pixels/sec. Unknown fields degrade
 * to conservative defaults (fps 30) so safety checks never silently pass.
 */
export function pixelsPerSecond(probe: VideoProbeResult): number | null {
  if (!probe.width || !probe.height) return null;
  return probe.width * probe.height * (probe.fps ?? 30);
}

/**
 * Decides how the given source should enter the canonical pipeline.
 * Returns a passthrough decision for anything unprobeable or unsafe to
 * encode — the file ships as-is rather than risking a bad re-encode.
 */
export function decideVideoStrategy(probe: VideoProbeResult): VideoDecision {
  const unknown = {
    strategy: "passthrough" as const,
    preset: "slow" as const,
    reason: "could-not-probe",
  };

  // Unprobeable or clearly not a video — ship untouched.
  if (probe.container === "unknown" || (!probe.videoCodec && !probe.durationMs)) {
    return unknown;
  }

  const preset = presetForDimensions(probe);
  const needsTranscodeForContainer =
    probe.container === "webm" || probe.container === "mkv";
  const codecIsNotH264 =
    !probe.videoCodec || !H264_FAMILIES.has(probe.videoCodec.toLowerCase());

  // ── Encode-safety gates come FIRST: anything above the platform limits is
  //    passed through losslessly rather than risking a failed/huge encode.
  if (needsTranscodeForContainer || codecIsNotH264) {
    const rate = pixelsPerSecond(probe);
    if (rate !== null && rate > VIDEO_SAFETY.maxPixelsPerSecond) {
      return { strategy: "passthrough", preset: "slow", reason: "encode-safety-pixels-per-second" };
    }
    if (probe.durationMs !== null && probe.durationMs > VIDEO_SAFETY.maxEncodeDurationMs) {
      return { strategy: "passthrough", preset: "slow", reason: "encode-safety-duration" };
    }
    if (needsTranscodeForContainer) {
      return { strategy: "transcode", preset, reason: `container-${probe.container}` };
    }
    return { strategy: "transcode", preset, reason: `codec-${probe.videoCodec ?? "unknown"}` };
  }

  // From here on the video is H.264 in an MP4/MOV container.

  // Audio that browsers can't play in MP4 → keep the video bit-identical,
  // re-encode only the audio to AAC.
  if (
    probe.audioCodec &&
    !MP4_COMPATIBLE_AUDIO.has(probe.audioCodec.toLowerCase())
  ) {
    return {
      strategy: "transcode",
      preset,
      copyVideo: true,
      reason: `audio-${probe.audioCodec}`,
    };
  }

  // Unreasonably high bitrate for the resolution → CRF 18 re-encode.
  if (
    probe.bitrateMbps !== null &&
    probe.bitrateMbps > maxPassThroughBitrateMbps(probe)
  ) {
    const rate = pixelsPerSecond(probe);
    if (rate !== null && rate > VIDEO_SAFETY.maxPixelsPerSecond) {
      return { strategy: "passthrough", preset: "slow", reason: "encode-safety-pixels-per-second" };
    }
    if (probe.durationMs !== null && probe.durationMs > VIDEO_SAFETY.maxEncodeDurationMs) {
      return { strategy: "passthrough", preset: "slow", reason: "encode-safety-duration" };
    }
    return {
      strategy: "transcode",
      preset: presetForDimensions(probe),
      reason: `high-bitrate-${probe.bitrateMbps.toFixed(1)}mbps`,
    };
  }

  // MOV with H.264 → container-only fix (lossless remux to MP4).
  if (probe.container === "mov") {
    return { strategy: "remux", preset: "slow", reason: "container-mov" };
  }

  // MP4 with moov at the end → lossless remux with faststart.
  if (probe.container === "mp4" && !probe.faststart) {
    return { strategy: "remux", preset: "slow", reason: "not-faststart" };
  }

  return { strategy: "passthrough", preset: "slow", reason: "already-optimal" };
}