/**
 * Encoding decision logic — pure and unit-testable.
 *
 * ⚠️ POLICY (2026-09): the pipeline NO LONGER ENCODES. Every upload ships
 * as-is (`passthrough`) or gets a lossless container fix (`remux` — moov
 * atom moved to the front for instant streaming; zero quality change, ~1s
 * in the browser). `transcode` is never chosen.
 *
 * Rationale: the target audience is on 2019+ hardware, whose browsers and
 * native players handle H.264, HEVC, VP9 and AV1 directly. Waiting minutes
 * for a server re-encode was judged worse than the rare incompatibility.
 *
 * What this means per source:
 *
 *   - WebM/MKV, HEVC, AV1, ProRes, high-bitrate H.264, PCM audio → shipped
 *     untouched. Modern browsers and the Expo app's native players decode
 *     them; old browsers may not (accepted trade-off).
 *   - MOV with H.264, or an MP4 with moov at the end → losslessly remuxed
 *     in the browser so Range streaming works everywhere.
 *   - Already-optimal files → stored as-is.
 *
 * Re-enabling encoding: restore the previous revision of this file (git log)
 * — the transcoder service, the encode-args builder and the client wasm
 * worker were all left intact and re-activate automatically from the
 * strategy this function returns.
 *
 * Resolution, frame rate, aspect ratio and audio are ALWAYS preserved.
 */

import type { VideoDecision, VideoProbeResult } from "./video-types";

/** Longest edge of the coded dimensions, or null when unknown. */
export function longestEdge(probe: VideoProbeResult): number | null {
  if (!probe.width || !probe.height) return null;
  return Math.max(probe.width, probe.height);
}

/** Preset for a given resolution — only meaningful if encoding is re-enabled. */
export function presetForDimensions(probe: VideoProbeResult): "slow" | "medium" {
  const edge = longestEdge(probe) ?? 0;
  return edge > 1920 ? "medium" : "slow";
}

/** Pass-through bitrate ceiling for the given resolution. */
export function maxPassThroughBitrateMbps(probe: VideoProbeResult): number {
  const edge = longestEdge(probe) ?? 0;
  return edge > 1920 ? 30 : 12;
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
 *
 * Passthrough-only policy: everything ships untouched EXCEPT the two
 * lossless remux cases (MOV container, non-faststart MP4) that make videos
 * stream instantly instead of download-then-play.
 */
export function decideVideoStrategy(probe: VideoProbeResult): VideoDecision {
  // Unprobeable or clearly not a video — ship untouched.
  if (probe.container === "unknown" || (!probe.videoCodec && !probe.durationMs)) {
    return { strategy: "passthrough", preset: "slow", reason: "could-not-probe" };
  }

  // MOV with H.264 → container-only fix (lossless remux to MP4).
  if (probe.container === "mov") {
    return { strategy: "remux", preset: "slow", reason: "container-mov" };
  }

  // MP4 with moov at the end → lossless remux with faststart.
  if (probe.container === "mp4" && !probe.faststart) {
    return { strategy: "remux", preset: "slow", reason: "not-faststart" };
  }

  // Everything else — WebM, MKV, HEVC, AV1, VP9, high bitrate, PCM audio,
  // whatever — is stored as-is. 2019+ devices decode it natively.
  return { strategy: "passthrough", preset: "slow", reason: "no-encode-policy" };
}
