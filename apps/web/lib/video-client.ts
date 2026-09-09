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

/**
 * True when the file starts with an MP4/MOV signature (`ftyp` box) — i.e. the
 * bytes themselves are what we think they are, regardless of the claimed MIME
 * type. Everything else (WebM, unknown, junk) is left untouched.
 */
export function looksLikeMp4(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxSize = view.getUint32(0);
  if (boxSize < 8) return false;
  return bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70; // "ftyp"
}

/** Box type (FourCC) at the given byte offset, or null when out of range. */
function boxType(bytes: Uint8Array, offset: number): string | null {
  if (offset + 8 > bytes.length) return null;
  return String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
}

/**
 * True when the MP4 `moov` atom (the playback index the browser needs before
 * drawing a frame) appears within the first 1 KB of the file — the practical
 * definition of "faststart". `moov` at the end forces whole-file buffering.
 * Only used to skip re-uploading files that are already stream-friendly.
 */
export function isFaststart(bytes: Uint8Array): boolean {
  if (!looksLikeMp4(bytes)) return false;
  // First box after `ftyp` (usually `free` or the metadata itself). If we see
  // `mdat` (the mass of media data) before `moov`, the index is at the end.
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const size = view.getUint32(offset);
    const type = boxType(bytes, offset);
    if (!type || size < 8) return false;
    if (type === "moov") return true;
    if (type === "mdat") return false;
    if (size === 1) {
      // 64-bit box size — not expected this early in a file; bail out.
      return false;
    }
    offset += size;
  }
  return false;
}

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
