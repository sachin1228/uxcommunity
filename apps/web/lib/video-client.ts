/**
 * Client-side video processing for uploads — server-side only where noted.
 *
 * Why this exists: feed videos autoplay muted in the feed via native HTTP
 * Range streaming (the browser downloads metadata, then fetches byte ranges
 * just ahead of playback). That only works well when the MP4 `moov` atom sits
 * at the FRONT of the file ("faststart"). Screen recordings and phone exports
 * put `moov` at the END, so the browser effectively downloads the whole file
 * (or seeks to its end) before the first frame — videos feel like they
 * "download fully before playing". Remuxing (container change only, zero
 * quality loss) fixes this at upload time for every future viewer.
 *
 * Mediabunny is a pure-TypeScript browser toolkit: remuxing copies compressed
 * packets without re-encoding, so it's fast (seconds for a 25 MB clip) and
 * uses the environment's own codec machinery (WebCodecs) rather than WASM.
 */

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  VideoSampleSink,
  type InputVideoTrack,
} from "mediabunny";

// Byte-level MP4/WebM sniffing lives in @uxcommunity/shared (shared with the
// server-side transcoder) — re-exported so the app's existing imports and
// tests keep working.
export { isFaststart, looksLikeMp4, sniffVideoContainer } from "@uxcommunity/shared";

export interface VideoProcessedResult {
  /** Remuxed, faststart MP4 (or the original file when remuxing was skipped). */
  file: File;
  /** Captured first frame as a JPEG blob, or null when no frame was available. */
  poster: Blob | null;
  /** Whether the file was remuxed (as opposed to passed through). */
  remuxed: boolean;
}

/**
 * Prepares a video for streaming playback:
 *  1. MOV (QuickTime) files are remuxed into MP4 — same codecs, browsers
 *     handle `.mov` poorly with Range streaming, and normalizing uploads to
 *     one container keeps the feed predictable.
 *  2. MP4s that don't start with `moov` are remuxed with
 *     `fastStart: 'in-memory'`, which copies packets and rewrites the index
 *     at the front — no re-encode, no quality loss.
 *  3. The first frame is decoded and captured as a JPEG poster so feed cards
 *     can show something instantly while the video data streams in.
 *
 * Returns the original file untouched when anything fails (WASM-less codecs
 * unavailable, corrupted file, unsupported layout) — an upload should never
 * break because preprocessing did.
 */
export async function processVideoForUpload(file: File): Promise<VideoProcessedResult> {
  const result: VideoProcessedResult = { file, poster: null, remuxed: false };

  const isQuickTime = file.type === "video/quicktime";
  const isMp4 = file.type === "video/mp4";
  if (!isQuickTime && !isMp4) return result;

  try {
    const source = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(file),
    });
    const videoTrack = await source.getPrimaryVideoTrack();

    // Capture the first frame as poster (before any conversion work).
    if (videoTrack) {
      result.poster = await capturePoster(videoTrack);
    }

    const needsRemux = isQuickTime || !(await isFaststartMp4(file));
    if (!needsRemux) return result;

    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: "in-memory" }),
      target: new BufferTarget(),
    });
    const conversion = await Conversion.init({ input: source, output });
    if (!conversion.isValid) return result;
    await conversion.execute();
    if (!output.target.buffer) return result;

    const remuxed = new File([output.target.buffer], swapExtension(file.name), { type: "video/mp4" });
    result.file = remuxed;
    result.remuxed = true;
    return result;
  } catch {
    // Codec/decoder unavailability or a malformed file — ship the original.
    return result;
  }
}

/** Best-effort check of the file's own bytes (MIME types can lie). */
async function isFaststartMp4(file: File): Promise<boolean> {
  const buffer = await file.arrayBuffer();
  return isFaststart(new Uint8Array(buffer));
}

/** `movie.mov` → `movie.mp4`; keeps names without an extension intact. */
function swapExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.mp4`;
}

const POSTER_MAX_DIMENSION = 1280;

/** Decodes the first video frame and returns it as a JPEG blob (≤1280px). */
async function capturePoster(track: InputVideoTrack): Promise<Blob | null> {
  try {
    const sink = new VideoSampleSink(track);
    const sample = await sink.getSample(0);
    if (!sample) return null;
    try {
      const scale = Math.min(1, POSTER_MAX_DIMENSION / Math.max(sample.displayWidth, sample.displayHeight));
      const width = Math.max(1, Math.round(sample.displayWidth * scale));
      const height = Math.max(1, Math.round(sample.displayHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return null;
      sample.draw(context, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
      return blob;
    } finally {
      sample.close();
    }
  } catch {
    return null;
  }
}
