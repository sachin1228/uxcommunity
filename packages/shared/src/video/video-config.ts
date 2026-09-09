/**
 * Centralized video-processing configuration.
 *
 * Single source of truth for the FFmpeg encoder settings used by the
 * canonical video pipeline. Every value here is deliberately a constant —
 * change quality policy in one place, not per call-site.
 *
 * Quality philosophy (designer content: UI animations, screen recordings,
 * typography, gradients, motion graphics):
 *
 *   - CRF 18 is the default starting point. If testing shows degradation on
 *     UI/screen-recording content, prefer lowering CRF (17/16) over touching
 *     resolution or frame rate.
 *   - Presets: `slow` up to 1080p. Above 1080p (e.g. 4K) the preset drops to
 *     `medium` — a documented platform-level safety/compute trade-off, NOT a
 *     quality concession. Resolution, FPS, aspect ratio and audio are always
 *     preserved; videos are never upscaled and never downscaled.
 *   - Sources that are already browser-perfect (H.264 + MP4 + faststart +
 *     sane bitrate) are passed through with ZERO re-encoding — the pipeline
 *     never degrades an excellent source just to squeeze bytes.
 */

/** Which container/encoding layouts we accept as uploads. */
export const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

/** Upload cap for the ORIGINAL video (kept — matches the current product cap). */
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

/**
 * Cap for the FINALIZE upload (the canonical processed MP4). The processed
 * file can legitimately be larger than a tiny original after a lossless
 * remux, so this is more generous than the original-upload cap.
 */
export const MAX_FINALIZE_BYTES = 150 * 1024 * 1024;

/** Poster (thumbnail) upload cap — one JPEG per video. */
export const MAX_POSTER_BYTES = 8 * 1024 * 1024;

// ── FFmpeg encode policy ─────────────────────────────────────────────────────

export const VIDEO_ENCODE = {
  /** H.264 target — universally playable in browsers. */
  codec: "libx264",
  /** High profile keeps the full H.264 feature set while staying browser-safe. */
  profile: "high",
  /**
   * Constant-rate-factor quality target. 18 is visually transparent for the
   * vast majority of content; see the module doc for the policy on going
   * lower (17/16) rather than downscaling.
   */
  crf: 18,
  /**
   * Default x264 preset. Larger presets = better compression at the same
   * quality, at the cost of encode time (this runs in the user's browser).
   */
  preset: "slow" as const,
  /**
   * Preset for sources above the high-resolution threshold (4K etc.).
   * `medium` keeps CRF 18 quality while bounding in-browser encode time and
   * memory for very large frames.
   */
  presetHighResolution: "medium" as const,
  /** Longest edge (px) above which `presetHighResolution` applies. */
  highResolutionThreshold: 1920,
  /** 8-bit sources are encoded as yuv420p — maximum browser compatibility. */
  pixelFormat: "yuv420p",
  /**
   * 10-bit (HDR / wide-gamut) sources keep their bit depth
   * (yuv420p10le). Quality-first decision: an 8-bit re-encode would band
   * gradients and crush highlights. Note: High-10 H.264 needs software
   * decode on some devices (notably iOS Safari).
   */
  pixelFormat10Bit: "yuv420p10le",
  /** AAC for broad browser compatibility. */
  audioCodec: "aac",
  /** Default stereo audio bitrate. */
  audioBitrate: "192k",
  /** 5.1/7.1 sources get more headroom — 192k would starve 6+ channels. */
  audioBitrateMultiChannel: "320k",
  /** Web-optimized MP4: `moov` atom moved to the front for Range streaming. */
  faststart: true,
  /** Avoid muxing-queue overflows on long encodes in wasm. */
  maxMuxingQueueSize: 1024,
} as const;

// ── Pass-through policy ──────────────────────────────────────────────────────

export const VIDEO_PASSTHROUGH = {
  /**
   * H.264 MP4s whose estimated overall bitrate is at or below this are
   * shipped as-is (no re-encode). Above it, a CRF 18 re-encode can shrink
   * the file with no visible loss.
   */
  maxBitrateMbps1080p: 12,
  /** Bitrate sanity for >1080p sources (4K) — much more generous. */
  maxBitrateMbps4k: 30,
  /** The resolution boundary between the two bitrate tiers. */
  tierBoundaryPx: 1920,
} as const;

// ── Processing safety limits (platform-level, documented) ───────────────────

/** How long a server transcoder may hold a claimed job before re-claim. */
export const JOB_LEASE_MS = 10 * 60 * 1000;

export const VIDEO_SAFETY = {
  /**
   * Maximum decode+encode throughput we allow in the browser worker:
   * 3840×2160@30 = 248,832,000 px/s. 4K@30 and 1080p@60 encode; 4K@60 and
   * anything above this does NOT (it is passed through losslessly instead —
   * quality is never sacrificed for a smaller file).
   */
  maxPixelsPerSecond: 3840 * 2160 * 30,
  /** Longest encode we'll run in the browser (10 min). Longer → passthrough. */
  maxEncodeDurationMs: 10 * 60 * 1000,
} as const;

// ── ffmpeg.wasm core ─────────────────────────────────────────────────────────

export const FFMPEG = {
  /**
   * Version of the `@ffmpeg/core` wasm build served at runtime. The build is
   * SELF-HOSTED at `/ffmpeg/` (apps/web/public/ffmpeg — see
   * scripts/fetch-ffmpeg-core.sh, which pins SHA-256 checksums), so the
   * pipeline never depends on a third-party CDN. Point
   * NEXT_PUBLIC_FFMPEG_CORE_BASE_URL elsewhere (e.g. an R2 custom domain)
   * to override. The core is ~32 MB, fetched lazily on the first transcode
   * and cached by the browser.
   */
  coreVersion: "0.12.10",
  get coreBaseUrl(): string {
    return process.env.NEXT_PUBLIC_FFMPEG_CORE_BASE_URL ?? "/ffmpeg";
  },
  get coreUrl(): string {
    return `${FFMPEG.coreBaseUrl}/ffmpeg-core.js`;
  },
  get wasmUrl(): string {
    return `${FFMPEG.coreBaseUrl}/ffmpeg-core.wasm`;
  },
} as const;