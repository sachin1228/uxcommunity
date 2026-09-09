/**
 * Pure parser for `ffmpeg -i <input>` stderr output.
 *
 * The encoding worker runs a probe pass (`ffmpeg -i`) before encoding and
 * parses the stream/duration lines to learn the source's codecs, dimensions,
 * frame rate, pixel format, rotation and bitrate. Kept dependency-free so the
 * fixture-based unit tests can validate it against realistic ffmpeg output
 * (screen recordings, phone exports, 4K, 60fps, silent files, HDR...).
 */

import type { FfmpegProbeResult } from "./video-types";

const DURATION_RE = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/;
const BITRATE_RE = /Duration:.*?bitrate:\s*(\d+(?:\.\d+)?)\s*kb\/s/;
const VIDEO_STREAM_RE = /Stream #.*Video:\s*([^,\s]+)/;
const PIX_FMT_RE = /Video:\s*[^,]+,\s*([a-z0-9]+(?:\([^)]*\))?)/;
const DIMENSIONS_RE = /(\d{2,5})x(\d{2,5})/;
const FPS_RE = /(\d+(?:\.\d+)?)\s*fps/;
const AUDIO_STREAM_RE = /Stream #.*Audio:\s*([^,\s]+)/;
const CHANNELS_RE = /Audio:.*?,\s*(mono|stereo|(?:5\.1|7\.1|6\.1|2\.1|3\.1|4\.1)(?:\([^)]*\))?|(\d+) channels)/;
const ROTATE_RE = /rotate\s*:\s*(-?\d+)/;
const DISPLAY_MATRIX_RE = /displaymatrix:\s*rotation of\s*(-?\d+(?:\.\d+)?)\s*degrees/;

/** Maps an ffmpeg channel-layout token to a channel count. */
export function channelCountFromLayout(layout: string | null): number | null {
  switch (layout) {
    case "mono":
      return 1;
    case "stereo":
      return 2;
    case "2.1":
      return 3;
    case "3.1":
      return 4;
    case "4.1":
      return 5;
    case "5.1":
    case "5.1(side)":
      return 6;
    case "6.1":
      return 7;
    case "7.1":
      return 8;
    default:
      return null;
  }
}

/**
 * Parses the codec name out of an ffmpeg stream line.
 * `h264 (High) (avc1 / 0x31637661)` → `h264`; `vp9 (Profile 0)` → `vp9`.
 */
export function codecFromStreamLine(codecToken: string): string {
  const firstParen = codecToken.indexOf("(");
  return (firstParen === -1 ? codecToken : codecToken.slice(0, firstParen)).trim().toLowerCase();
}

/**
 * Parses ffmpeg `-i` stderr into structured metadata. Unknown fields are
 * null; malformed output degrades gracefully instead of throwing.
 */
export function parseFfmpegProbe(stderr: string): FfmpegProbeResult {
  const result: FfmpegProbeResult = {
    durationMs: null,
    videoCodec: null,
    audioCodec: null,
    width: null,
    height: null,
    fps: null,
    pixelFormat: null,
    rotation: null,
    bitrateMbps: null,
    audioChannels: null,
  };

  const durationMatch = stderr.match(DURATION_RE);
  if (durationMatch) {
    const hours = Number(durationMatch[1]);
    const minutes = Number(durationMatch[2]);
    const seconds = Number(durationMatch[3]);
    result.durationMs = Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
  }

  const bitrateMatch = stderr.match(BITRATE_RE);
  if (bitrateMatch) result.bitrateMbps = Number(bitrateMatch[1]) / 1000;

  const videoMatch = stderr.match(VIDEO_STREAM_RE);
  if (videoMatch) {
    result.videoCodec = codecFromStreamLine(videoMatch[1]);
    const pixFmtMatch = stderr.match(PIX_FMT_RE);
    if (pixFmtMatch) {
      result.pixelFormat = pixFmtMatch[1].split("(")[0].trim().toLowerCase() || null;
    }
    const dimensions = stderr.match(DIMENSIONS_RE);
    if (dimensions) {
      result.width = Number(dimensions[1]);
      result.height = Number(dimensions[2]);
    }
    const fps = stderr.match(FPS_RE);
    if (fps) result.fps = Number(fps[1]);
  }

  const audioMatch = stderr.match(AUDIO_STREAM_RE);
  if (audioMatch) {
    result.audioCodec = codecFromStreamLine(audioMatch[1]);
    const channelsMatch = stderr.match(CHANNELS_RE);
    if (channelsMatch) {
      const layout = channelsMatch[1];
      const numeric = channelsMatch[2];
      result.audioChannels = numeric ? Number(numeric) : channelCountFromLayout(layout.split("(")[0]);
    }
  }

  const rotateMatch = stderr.match(ROTATE_RE);
  const matrixMatch = stderr.match(DISPLAY_MATRIX_RE);
  if (rotateMatch) {
    result.rotation = (Number(rotateMatch[1]) % 360 + 360) % 360;
  } else if (matrixMatch) {
    result.rotation = (Math.round(Number(matrixMatch[1])) % 360 + 360) % 360;
  }

  return result;
}

/**
 * Parses `ffprobe -of json` output (the worker uses ffmpeg.wasm's built-in
 * ffprobe). Shape: `{ streams: [...], format: { duration, bit_rate } }`.
 */
export function parseFfprobeJson(output: string): FfmpegProbeResult {
  const result: FfmpegProbeResult = {
    durationMs: null,
    videoCodec: null,
    audioCodec: null,
    width: null,
    height: null,
    fps: null,
    pixelFormat: null,
    rotation: null,
    bitrateMbps: null,
    audioChannels: null,
  };

  let parsed: {
    streams?: Array<Record<string, unknown>>;
    format?: Record<string, unknown>;
  };
  try {
    parsed = JSON.parse(output);
  } catch {
    return result;
  }

  const format = parsed.format ?? {};
  const formatDuration = numberOrNull(format.duration);
  const formatBitRate = numberOrNull(format.bit_rate);
  if (formatDuration !== null) result.durationMs = Math.round(formatDuration * 1000);
  if (formatBitRate !== null) result.bitrateMbps = formatBitRate / 1_000_000;

  for (const stream of parsed.streams ?? []) {
    if (stream.codec_type === "video" && !result.videoCodec) {
      result.videoCodec = stringOrNull(stream.codec_name);
      result.width = numberOrNull(stream.width);
      result.height = numberOrNull(stream.height);
      result.pixelFormat = stringOrNull(stream.pix_fmt);
      const rotation = numberOrNull(stream.rotation);
      result.rotation = rotation === null ? null : ((Math.round(rotation) % 360) + 360) % 360;
      result.fps = fpsFromFrameRate(stringOrNull(stream.r_frame_rate) ?? stringOrNull(stream.avg_frame_rate));
      if (result.durationMs === null) {
        const streamDuration = numberOrNull(stream.duration);
        if (streamDuration !== null) result.durationMs = Math.round(streamDuration * 1000);
      }
      if (result.bitrateMbps === null) {
        const streamBitRate = numberOrNull(stream.bit_rate);
        if (streamBitRate !== null) result.bitrateMbps = streamBitRate / 1_000_000;
      }
    } else if (stream.codec_type === "audio" && !result.audioCodec) {
      result.audioCodec = stringOrNull(stream.codec_name);
      result.audioChannels = numberOrNull(stream.channels);
    }
  }

  return result;
}

/** Parses an ffprobe frame-rate string like `30000/1001` or `30/1`. */
export function fpsFromFrameRate(frameRate: string | null): number | null {
  if (!frameRate) return null;
  const [num, den] = frameRate.split("/");
  const numerator = Number(num);
  const denominator = Number(den);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    const flat = Number(frameRate);
    return Number.isFinite(flat) && flat > 0 ? flat : null;
  }
  if (numerator <= 0 || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/** True when the stderr output actually contained a usable probe result. */
export function isUsableProbe(probe: FfmpegProbeResult): boolean {
  return Boolean(probe.videoCodec && probe.width && probe.height);
}