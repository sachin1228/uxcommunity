import assert from "node:assert/strict";
import { test } from "node:test";
import { buildVideoProbe } from "./encode";
import type { FfmpegProbeResult } from "@uxcommunity/shared";

function box(type: string, body: Buffer): Buffer {
  const buf = Buffer.alloc(8 + body.length);
  buf.writeUInt32BE(buf.length, 0);
  buf.write(type, 4, "latin1");
  body.copy(buf, 8);
  return buf;
}

function mp4Bytes(opts: { moovFirst?: boolean } = {}): Buffer {
  const ftyp = box(
    "ftyp",
    Buffer.from("isom\u0000\u0000\u0000\u0000isomiso2", "latin1"),
  );
  const moov = box("moov", Buffer.alloc(8));
  const mdat = box("mdat", Buffer.alloc(64));
  const moovFirst = opts.moovFirst ?? true;
  return Buffer.concat(moovFirst ? [ftyp, moov, mdat] : [ftyp, mdat, moov]);
}

function webmBytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), // EBML magic
    Buffer.alloc(64, 0x42), // junk
  ]);
}

function ffprobe(overrides: Partial<FfmpegProbeResult> = {}): FfmpegProbeResult {
  return {
    durationMs: 5000,
    videoCodec: "h264",
    audioCodec: "aac",
    width: 1920,
    height: 1080,
    fps: 30,
    pixelFormat: "yuv420p",
    rotation: null,
    bitrateMbps: 8.2,
    audioChannels: 2,
    ...overrides,
  };
}

test("buildVideoProbe merges ffprobe with byte-sniffed MP4 (faststart)", () => {
  const probe = buildVideoProbe(mp4Bytes(), ffprobe());
  assert.equal(probe.container, "mp4");
  assert.equal(probe.faststart, true);
  assert.equal(probe.fileSize, mp4Bytes().length);
  assert.equal(probe.videoCodec, "h264");
  assert.equal(probe.width, 1920);
  assert.equal(probe.fps, 30);
  assert.equal(probe.bitrateMbps, 8.2);
});

test("buildVideoProbe flags moov-at-end MP4 as not faststart", () => {
  const probe = buildVideoProbe(mp4Bytes({ moovFirst: false }), ffprobe());
  assert.equal(probe.container, "mp4");
  assert.equal(probe.faststart, false);
});

test("buildVideoProbe identifies WebM from bytes, never the extension", () => {
  const probe = buildVideoProbe(webmBytes(), ffprobe({ videoCodec: "vp9" }));
  assert.equal(probe.container, "webm");
  assert.equal(probe.faststart, false);
});

test("buildVideoProbe reports unknown container for garbage bytes", () => {
  const probe = buildVideoProbe(Buffer.alloc(32, 0xff), ffprobe());
  assert.equal(probe.container, "unknown");
});