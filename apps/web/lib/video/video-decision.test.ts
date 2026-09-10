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

// ── No-encode policy (2026-09): nothing is ever re-encoded. ─────────────────

test("already-optimal H.264 faststart MP4 passes through with ZERO re-encoding", () => {
  const decision = decideVideoStrategy(probe());
  assert.equal(decision.strategy, "passthrough");
  assert.equal(decision.reason, "no-encode-policy");
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

test("POLICY: WebM (VP9) ships as-is — no encoding, modern clients decode it", () => {
  const decision = decideVideoStrategy(probe({ container: "webm", videoCodec: "vp9", bitrateMbps: 4 }));
  assert.equal(decision.strategy, "passthrough");
  assert.equal(decision.reason, "no-encode-policy");
});

test("POLICY: HEVC/AV1/ProRes ship as-is — never transcoded", () => {
  for (const [videoCodec, container, expected] of [
    ["hevc", "mp4", "passthrough"],
    ["av1", "mp4", "passthrough"],
    ["prores", "mov", "remux"], // lossless container fix only
    ["vp9", "webm", "passthrough"],
  ] as const) {
    const decision = decideVideoStrategy(probe({ videoCodec, container }));
    assert.equal(decision.strategy, expected, `${videoCodec} must not be transcoded`);
    assert.notEqual(decision.strategy, "transcode");
  }
});

test("POLICY: high-bitrate sources are NOT compressed — the original ships untouched", () => {
  const decision = decideVideoStrategy(probe({ bitrateMbps: 40 }));
  assert.equal(decision.strategy, "passthrough");
  assert.equal(decision.reason, "no-encode-policy");
});

test("POLICY: 4K huge-bitrate ships as-is (no medium-preset encode anymore)", () => {
  const decision = decideVideoStrategy(probe({ width: 3840, height: 2160, fps: 30, bitrateMbps: 60 }));
  assert.equal(decision.strategy, "passthrough");
});

test("4K@30 stays 4K@30 — the decision never contains scale instructions", () => {
  const decision = decideVideoStrategy(probe({ width: 3840, height: 2160, fps: 30, bitrateMbps: 60 }));
  assert.ok(!JSON.stringify(decision).includes("scale"));
});

test("60fps sources keep 60fps (no fps conversion anywhere in the decision)", () => {
  const decision = decideVideoStrategy(probe({ fps: 60, bitrateMbps: 30 }));
  assert.equal(decision.strategy, "passthrough");
});

test("POLICY: PCM audio is NOT re-encoded — file ships with its original audio", () => {
  const decision = decideVideoStrategy(probe({ container: "mov", audioCodec: "pcm_s16le", bitrateMbps: 8 }));
  assert.equal(decision.strategy, "remux"); // container fix only, video+audio copied
  assert.equal(decision.reason, "container-mov");
});

test("silent videos pass through (no audio invented)", () => {
  const decision = decideVideoStrategy(probe({ audioCodec: null }));
  assert.equal(decision.strategy, "passthrough");
});

test("unprobeable files pass through untouched", () => {
  const decision = decideVideoStrategy(probe({ container: "unknown", videoCodec: null, durationMs: null }));
  assert.equal(decision.strategy, "passthrough");
  assert.equal(decision.reason, "could-not-probe");
});

test("geometry helpers", () => {
  assert.equal(longestEdge(probe()), 1920);
  assert.equal(longestEdge(probe({ width: 1080, height: 1920 })), 1920);
  assert.equal(pixelsPerSecond(probe({ width: 3840, height: 2160, fps: 30 })), 3840 * 2160 * 30);
  assert.equal(presetForDimensions(probe({ width: 1920, height: 1080 })), "slow");
  assert.equal(presetForDimensions(probe({ width: 2560, height: 1440 })), "medium");
});
