/**
 * Client-side source inspection for the video pipeline.
 *
 * The app runs on Cloudflare Workers (OpenNext), which cannot execute a
 * native ffmpeg/ffprobe binary, so the source is probed where the bytes
 * already are: in the browser, via mediabunny's parser (codecs, dimensions,
 * frame rate, rotation, duration) plus direct byte inspection of the MP4
 * box layout (container signature + faststart). The FFmpeg worker re-probes
 * with ffmpeg.wasm's built-in ffprobe before encoding, which adds pixel
 * format / bitrate / color details for the encode decision.
 */

import {
  ALL_FORMATS,
  BlobSource,
  Input,
  type InputAudioTrack,
  type InputVideoTrack,
} from "mediabunny";
import { isFaststart, looksLikeMp4 } from "@/lib/video-client";
import type { VideoProbeResult } from "./video-types";

const MP4_BRAND_RE = /^qt\s\s/i;

/** Sniffs the container family from the file's own bytes. */
export function sniffContainer(bytes: Uint8Array): VideoProbeResult["container"] {
  if (bytes.length < 12) return "unknown";
  if (!looksLikeMp4(bytes)) {
    // EBML magic — Matroska/WebM.
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
      return "webm";
    }
    return "unknown";
  }
  // ftyp major brand at offset 8: "qt  " → QuickTime, "isom"/"mp42"/"avc1" → MP4.
  const major = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  return MP4_BRAND_RE.test(major) ? "mov" : "mp4";
}

/** Reads the file's first bytes once and reuses the buffer. */
async function readHead(file: File, length = 4096): Promise<Uint8Array> {
  const slice = file.slice(0, length);
  return new Uint8Array(await slice.arrayBuffer());
}

/**
 * Probes a source video file. Never throws — every failure degrades to a
 * minimal result so the pipeline can fall back to shipping the original.
 */
export async function probeVideoFile(file: File): Promise<VideoProbeResult> {
  const head = await readHead(file);
  const container = sniffContainer(head);
  const result: VideoProbeResult = {
    container,
    videoCodec: null,
    width: null,
    height: null,
    fps: null,
    durationMs: null,
    audioCodec: null,
    bitrateMbps: null,
    faststart: false,
    rotation: null,
    fileSize: file.size,
  };

  try {
    const source = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    const videoTrack = await source.getPrimaryVideoTrack();
    const audioTracks = await source.getAudioTracks();
    if (videoTrack) {
      result.videoCodec = await videoTrack.getCodec();
      result.width = await videoTrack.getCodedWidth();
      result.height = await videoTrack.getCodedHeight();
      try {
        const rotation = await videoTrack.getRotation();
        result.rotation = typeof rotation === "number" ? rotation : null;
      } catch {
        // Rotation is optional metadata.
      }
      try {
        const metrics = await videoTrack.computeFrameRateMetrics({ targetPacketCount: 256 });
        result.fps = metrics.bestGuessFrameRate ?? null;
      } catch {
        // Frame-rate estimation can fail on sparse/odd inputs.
      }
    }
    if (audioTracks.length > 0) {
      const primary = audioTracks[0];
      result.audioCodec = await primary.getCodec();
    }
    try {
      const duration = await source.getDurationFromMetadata();
      if (duration !== null) result.durationMs = Math.round(duration * 1000);
    } catch {
      // Duration stays null.
    }
    source.dispose();
  } catch {
    // Unparseable — container sniff is all we have.
  }

  // Faststart check only makes sense for MP4/MOV.
  if (container === "mp4" || container === "mov") {
    result.faststart = isFaststart(head);
  }

  // Bitrate estimate: bytes × 8 ÷ duration (seconds).
  if (result.durationMs && result.durationMs > 0) {
    result.bitrateMbps = (file.size * 8) / (result.durationMs / 1000) / 1_000_000;
  }

  return result;
}

/** Duration in seconds (for form payloads), or 0 when unknown. */
export function durationSeconds(probe: VideoProbeResult): number {
  return probe.durationMs ? Math.round(probe.durationMs / 1000) : 0;
}