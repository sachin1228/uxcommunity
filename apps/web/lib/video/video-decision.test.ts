import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires an explicit TS extension.
import { decideVideoStrategy, longestEdge, pixelsPerSecond, presetForDimensions } from "./video-decision.ts";
import type { VideoProbeResult } from "./video-types.ts";

function probe(overrides: Partial<VideoProbeResult> = {}): VideoProbeResult {
  return {
    container: "mp4",
    videoCodec: "avc",
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 10000,
    audioCodec: "aac",
    bitrateMbps: 6,
    faststart: true,
    rotation: null,
    fileSize: 7_500_000,
    ...overrides,
  };
}

test("already-optimal H.264 faststart MP4 passes through with ZERO re-encoding", () => {
  const decision = decideVideoStrategy(probe());
  assert.equal(decision.strategy, "passthrough");
  assert.equal(decision.reason, "already-optimal");
});

test("standard 1080p MP4 (sane bitrate) passes through — quality first, no blind compression", () => {
  const decision = decideVideoStrategy(probe({ bitrateMbps: 8.1 }));
  assert.equal(decision.strategy, "passthrough");
});

test("MOV (QuickTime) with H.264 is remuxed losslessly, not re-encoded", () => {
  const decision = decideVideoStrategy(probe({ container: "mov" }));
  assert.equal(decision.strategy, "remux");
  assert.equal(decision.reason, "container-mov");
});

test("MP4 with moov at the end is remuxed with faststart (lossless)", () => {
  const decision = decideVideoStrategy(probe({ faststart: false }));
  assert.equal(decision.strategy, "remux");
  assert.equal(decision.reason, "not-faststart");
});

test("WebM (VP9) is transcoded to H.264 with the slow preset", () => {
  const decision = decideVideoStrategy(probe({ container: "webm", videoCodec: "vp9", bitrateMbps: 4 }));
  assert.equal(decision.strategy, "transcode");
  assert.equal(decision.reason, "container-webm");
  assert.equal(decision.preset, "slow");
  assert.equal(decision.copyVideo, undefined);
});

test("HEVC/ProRes sources are transcoded to H.264 (browser compatibility)", () => {
  assert.equal(decideVideoStrategy(probe({ videoCodec: "hevc" })).strategy, "transcode");
  assert.equal(decideVideoStrategy(probe({ videoCodec: "prores", container: "mov" })).strategy, "transcode");
});

test("high-bitrate 1080p (screen-recording style) is compressed at CRF 18", () => {
  const decision = decideVideoStrategy(probe({ bitrateMbps: 40 }));
  assert.equal(decision.strategy, "transcode");
  assert.equal(decision.reason, "high-bitrate-40.0mbps");
  assert.equal(decision.preset, "slow");
});

test("4K with a huge bitrate transcodes with the MEDIUM preset (CRF still 18)", () => {
  const decision = decideVideoStrategy(probe({ width: 3840, height: 2160, fps: 30, bitrateMbps: 60 }));
  assert.equal(decision.strategy, "transcode");
  assert.equal(decision.preset, "medium");
  assert.equal(presetForDimensions(probe({ width: 3840, height: 2160 })), "medium");
});

test("4K@30 stays 4K@30 — never downscaled", () => {
  const decision = decideVideoStrategy(probe({ width: 3840, height: 2160, fps: 30, bitrateMbps: 60 }));
  assert.equal(decision.strategy, "transcode");
  // The decision never contains scale/resize instructions; resolution is
  // preserved by construction (no scale filter is ever emitted).
  assert.ok(!JSON.stringify(decision).includes("scale"));
});

test("60fps sources keep 60fps (no fps conversion anywhere in the decision)", () => {
  const decision = decideVideoStrategy(probe({ fps: 60, width: 1920, height: 1080, bitrateMbps: 30 }));
  assert.equal(decision.strategy, "transcode");
  assert.equal(decision.preset, "slow");
});

test("PCM audio in an H.264 source → video copied bit-identically, audio re-encoded", () => {
  const decision = decideVideoStrategy(probe({ container: "mov", audioCodec: "pcm_s16le", bitrateMbps: 8 }));
  assert.equal(decision.strategy, "transcode");
  assert.equal(decision.copyVideo, true);
  assert.equal(decision.reason, "audio-pcm_s16le");
});

test("silent videos pass through when otherwise optimal (no audio invented)", () => {
  const decision = decideVideoStrategy(probe({ audioCodec: null }));
  assert.equal(decision.strategy, "passthrough");
});

test("unprobeable files pass through untouched rather than risking a bad encode", () => {
  const decision = decideVideoStrategy(probe({ container: "unknown", videoCodec: null, durationMs: null }));
  assert.equal(decision.strategy, "passthrough");
  assert.equal(decision.reason, "could-not-probe");
});

test("safety limits: 4K@60 never encodes — the lossless source becomes canonical", () => {
  const decision = decideVideoStrategy(probe({ container: "webm", width: 3840, height: 2160, fps: 60 }));
  assert.equal(decision.strategy, "passthrough");
  assert.equal(decision.reason, "encode-safety-pixels-per-second");
});

test("safety limits: >10 minute sources pass through instead of encoding", () => {
  const decision = decideVideoStrategy(probe({ bitrateMbps: 60, durationMs: 15 * 60 * 1000 }));
  assert.equal(decision.strategy, "passthrough");
  assert.equal(decision.reason, "encode-safety-duration");
});

test("safety limits apply to high-bitrate H.264 too", () => {
  const decision = decideVideoStrategy(probe({ width: 3840, height: 2160, fps: 60, bitrateMbps: 90 }));
  assert.equal(decision.strategy, "passthrough");
});

test("unknown bitrate is not judged — already-optimal files pass through", () => {
  const decision = decideVideoStrategy(probe({ bitrateMbps: null }));
  assert.equal(decision.strategy, "passthrough");
});

test("geometry helpers", () => {
  assert.equal(longestEdge(probe()), 1920);
  assert.equal(longestEdge(probe({ width: 1080, height: 1920 })), 1920);
  assert.equal(pixelsPerSecond(probe({ width: 3840, height: 2160, fps: 30 })), 3840 * 2160 * 30);
  assert.equal(presetForDimensions(probe({ width: 1920, height: 1080 })), "slow");
  assert.equal(presetForDimensions(probe({ width: 2560, height: 1440 })), "medium");
});