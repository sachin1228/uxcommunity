/**
 * Shared types for the centralized video pipeline.
 *
 * These types cross the client/server boundary (upload payloads, attachment
 * shapes) and the main-thread/worker boundary, so they live in one module.
 */

/** Processing state machine — mirrors the `video_media.status` DB column. */
export type VideoStatus = "uploaded" | "processing" | "ready" | "failed" | "deleted";

/**
 * How an upload enters the pipeline:
 *
 *  - `passthrough` — already browser-perfect (H.264 MP4, faststart, sane
 *    bitrate): shipped as the canonical video with ZERO re-encoding.
 *  - `remux`       — container-level fix only (MOV→MP4, moov→front) via
 *    lossless packet copy: bit-identical media, no re-encode.
 *  - `transcode`   — real FFmpeg encode (libx264, CRF 18): WebM/HEVC/VP9,
 *    non-faststart, or unreasonably high bitrate sources.
 */
export type VideoStrategy = "passthrough" | "remux" | "transcode";

/** Client-side probe of the source file (mediabunny + byte inspection). */
export interface VideoProbeResult {
  /** Container family sniffed from the file bytes. */
  container: "mp4" | "mov" | "webm" | "mkv" | "unknown";
  /** Codec family: avc | hevc | vp9 | vp8 | av1 | prores | ... or null. */
  videoCodec: string | null;
  /** Coded dimensions (pre-rotation). */
  width: number | null;
  height: number | null;
  /** Best-guess frame rate, or null when unknown. */
  fps: number | null;
  /** Duration in ms (metadata-based estimate), or null. */
  durationMs: number | null;
  /** Audio codec family (aac | mp3 | opus | ...) or null when silent. */
  audioCodec: string | null;
  /** Estimated overall bitrate in Mbps (size×8/duration), or null. */
  bitrateMbps: number | null;
  /** `moov` before `mdat` (MP4/MOV only) — true means Range-stream friendly. */
  faststart: boolean;
  /** Clockwise rotation metadata in degrees (0/90/180/270), or null. */
  rotation: number | null;
  /** Source file size in bytes. */
  fileSize: number;
}

/** Probe result parsed from `ffmpeg -i` stderr inside the worker. */
export interface FfmpegProbeResult {
  durationMs: number | null;
  /** e.g. "h264", "hevc", "vp9", "aac", "mp3", null when absent. */
  videoCodec: string | null;
  audioCodec: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  /** e.g. "yuv420p", "yuv420p10le" — drives the 10-bit decision. */
  pixelFormat: string | null;
  rotation: number | null;
  /** Total stream bitrate from the `Duration:` line, in Mbps. */
  bitrateMbps: number | null;
  /** Audio channel count (mono=1, stereo=2, 5.1=6, 7.1=8), or null. */
  audioChannels: number | null;
}

/** What the client decided to do with a file. */
export interface VideoDecision {
  strategy: VideoStrategy;
  /** x264 preset to use when strategy === "transcode". */
  preset: "slow" | "medium";
  /**
   * Video stream is copied bit-identically while audio is re-encoded to AAC
   * (e.g. H.264 source with PCM audio, which browsers cannot play in MP4).
   * Only meaningful when strategy === "transcode".
   */
  copyVideo?: boolean;
  /** Reason, for logs/debugging. */
  reason: string;
}

/** Output metadata reported by the encoding worker. */
export interface VideoEncodeResult {
  file: Blob;
  /** File name of the processed MP4 (mediaId-based, safe). */
  name: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  durationMs: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  pixelFormat: string | null;
  /** Worker probe of the source (ffmpeg -i parse). */
  probe: FfmpegProbeResult;
}

/** Attachment state surfaced to the composer/feed for one video. */
export type VideoAttachmentStatus = "uploading" | VideoStatus;

/** Structured log payload for processing metrics (see video-server.ts). */
export interface VideoProcessingMetrics {
  mediaId: string;
  userId: string;
  communityId: string;
  strategy: VideoStrategy;
  status: VideoStatus;
  width: number | null;
  height: number | null;
  fps: number | null;
  durationMs: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  originalSize: number | null;
  processedSize: number | null;
  compressionRatio: number | null;
  attempts: number;
  processingMs: number | null;
  errorCode?: string | null;
  /** Number of posts patched server-side at finalize (informational). */
  patched?: number;
}