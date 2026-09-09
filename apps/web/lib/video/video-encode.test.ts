import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires an explicit TS extension.
import { buildEncodeArgs, pixelFormatFor, ENCODE_INPUT_NAME, ENCODE_OUTPUT_NAME } from "./video-encode.ts";
import type { FfmpegProbeResult, VideoDecision } from "./video-types.ts";

function probe(overrides: Partial<FfmpegProbeResult> = {}): FfmpegProbeResult {
  return {
    durationMs: 10000,
    videoCodec: "h264",
    audioCodec: "aac",
    width: 1920,
    height: 1080,
    fps: 30,
    pixelFormat: "yuv420p",
    rotation: null,
    bitrateMbps: 8,
    audioChannels: 2,
    ...overrides,
  };
}

function decision(overrides: Partial<VideoDecision> = {}): VideoDecision {
  return {
    strategy: "transcode",
    preset: "slow",
    reason: "test",
    ...overrides,
  };
}

test("baseline transcode: libx264 High profile CRF 18, slow, yuv420p, faststart, AAC 192k", () => {
  const args = buildEncodeArgs(probe(), decision());
  assert.deepEqual(args, [
    "-i", ENCODE_INPUT_NAME,
    "-map", "0:v:0",
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-profile:v", "high",
    "-map", "0:a:0?",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    "-max_muxing_queue_size", "1024",
    ENCODE_OUTPUT_NAME,
  ]);
});

test("4K sources use the medium preset (CRF stays 18 — quality is never lowered)", () => {
  const args = buildEncodeArgs(probe({ width: 3840, height: 2160 }), decision({ preset: "medium" }));
  const presetIndex = args.indexOf("-preset");
  assert.equal(args[presetIndex + 1], "medium");
  const crfIndex = args.indexOf("-crf");
  assert.equal(args[crfIndex + 1], "18");
});

test("no audio track in the source → no audio mapping or AAC args (no silent track invented)", () => {
  const args = buildEncodeArgs(probe({ audioCodec: null, audioChannels: null }), decision());
  assert.ok(!args.includes("-c:a"));
  assert.ok(!args.includes("-b:a"));
  assert.ok(!args.includes("0:a:0?"));
});

test("5.1 audio gets the multi-channel bitrate", () => {
  const args = buildEncodeArgs(probe({ audioChannels: 6 }), decision());
  const index = args.indexOf("-b:a");
  assert.equal(args[index + 1], "320k");
});

test("10-bit sources keep their bit depth (yuv420p10le) and skip the 8-bit-only High profile", () => {
  assert.equal(pixelFormatFor(probe({ pixelFormat: "yuv420p10le" })), "yuv420p10le");
  assert.equal(pixelFormatFor(probe({ pixelFormat: "yuv420p" })), "yuv420p");
  assert.equal(pixelFormatFor(probe({ pixelFormat: "yuv444p10le" })), "yuv420p10le");
  const args = buildEncodeArgs(probe({ pixelFormat: "yuv420p10le" }), decision());
  const index = args.indexOf("-pix_fmt");
  assert.equal(args[index + 1], "yuv420p10le");
  // `-profile:v high` rejects 10-bit output in libx264 — it must be omitted
  // so the encoder selects High10 automatically.
  assert.ok(!args.includes("-profile:v"), "profile must be omitted for 10-bit output");
  assert.ok(!args.includes("high"), "no 8-bit profile flag for 10-bit output");
});

test("copyVideo keeps the video bit-identical and re-encodes only audio", () => {
  const args = buildEncodeArgs(probe({ audioCodec: "pcm_s16le" }), decision({ copyVideo: true }));
  assert.ok(args.includes("-c:v"));
  assert.equal(args[args.indexOf("-c:v") + 1], "copy");
  assert.ok(!args.includes("-crf"));
  assert.ok(!args.includes("-preset"));
  assert.equal(args[args.indexOf("-c:a") + 1], "aac");
  assert.ok(args.includes("+faststart"));
});

test("resolution and frame rate are NEVER passed to ffmpeg (preserved implicitly)", () => {
  const args = buildEncodeArgs(probe(), decision());
  assert.ok(!args.includes("-s") && !args.includes("scale"));
  assert.ok(!args.includes("-r") && !args.includes("fps"));
  assert.ok(!args.includes("crop"));
});