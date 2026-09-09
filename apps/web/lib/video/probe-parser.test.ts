import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires an explicit TS extension.
import { parseFfmpegProbe, parseFfprobeJson, isUsableProbe, fpsFromFrameRate, channelCountFromLayout } from "./probe-parser.ts";

/** Minimal ffmpeg `-i` stderr with the lines the parser cares about. */
function stderr(lines: string[]): string {
  return [
    "ffmpeg version 6.0 Copyright (c) 2000-2023 the FFmpeg developers",
    "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'input.mp4':",
    ...lines,
  ].join("\n");
}

test("probes a standard 1080p30 landscape MP4 with AAC", () => {
  const probe = parseFfmpegProbe(stderr([
    "  Duration: 00:00:12.34, start: 0.000000, bitrate: 8123 kb/s",
    "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 30 fps, 30 tbr, 15360 tbn (default)",
    "  Stream #0:1[0x1](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 159 kb/s (default)",
  ]));
  assert.equal(probe.videoCodec, "h264");
  assert.equal(probe.width, 1920);
  assert.equal(probe.height, 1080);
  assert.equal(probe.fps, 30);
  assert.equal(probe.durationMs, 12340);
  assert.equal(probe.bitrateMbps, 8.123);
  assert.equal(probe.pixelFormat, "yuv420p");
  assert.equal(probe.audioCodec, "aac");
  assert.equal(probe.audioChannels, 2);
  assert.equal(probe.rotation, null);
  assert.equal(isUsableProbe(probe), true);
});

test("probes a 4K 60fps 10-bit source (HDR-safe pixel format)", () => {
  const probe = parseFfmpegProbe(stderr([
    "  Duration: 00:00:20.00, start: 0.000000, bitrate: 45000 kb/s",
    "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p10le(tv, bt2020nc, bt2020/smpte2084), 3840x2160 [SAR 1:1 DAR 16:9], 60 fps, 60 tbr, 15360 tbn (default)",
  ]));
  assert.equal(probe.width, 3840);
  assert.equal(probe.height, 2160);
  assert.equal(probe.fps, 60);
  assert.equal(probe.pixelFormat, "yuv420p10le");
  assert.equal(probe.audioCodec, null);
  assert.equal(probe.durationMs, 20000);
});

test("probes a portrait phone video with rotation metadata and mono audio", () => {
  const probe = parseFfmpegProbe(stderr([
    "  Metadata:",
    "    rotate          : 90",
    "  Duration: 00:00:05.00, start: 0.000000, bitrate: 9022 kb/s",
    "  Stream #0:0(und): Video: h264 (Constrained Baseline) (avc1 / 0x31637661), yuv420p(tv, bt709), 1080x1920 [SAR 1:1 DAR 9:16], 30 fps, 30 tbr, 15360 tbn (default)",
    "  Stream #0:1(und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp, 96 kb/s (default)",
  ]));
  assert.equal(probe.width, 1080);
  assert.equal(probe.height, 1920);
  assert.equal(probe.rotation, 90);
  assert.equal(probe.audioChannels, 1);
});

test("probes a square silent WebM (no audio stream)", () => {
  const probe = parseFfmpegProbe(stderr([
    "  Duration: 00:00:03.00, start: 0.000000, bitrate: 4020 kb/s",
    "  Stream #0:0: Video: vp9 (Profile 0), yuv420p(tv, bt709), 1080x1080 [SAR 1:1 DAR 1:1], 30 fps, 30 tbr, 1k tbn (default)",
  ]));
  assert.equal(probe.videoCodec, "vp9");
  assert.equal(probe.width, 1080);
  assert.equal(probe.height, 1080);
  assert.equal(probe.fps, 30);
  assert.equal(probe.audioCodec, null);
  assert.equal(probe.audioChannels, null);
});

test("probes a screen recording (1440p60, PCM audio)", () => {
  const probe = parseFfmpegProbe(stderr([
    "  Duration: 00:00:42.00, start: 0.000000, bitrate: 18000 kb/s",
    "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 2560x1440 [SAR 1:1 DAR 16:9], 60 fps, 60 tbr, 15360 tbn (default)",
    "  Stream #0:1[0x1](und): Audio: pcm_s16le (sowt / 0x74776F73), 48000 Hz, stereo, s16, 1536 kb/s (default)",
  ]));
  assert.equal(probe.width, 2560);
  assert.equal(probe.height, 1440);
  assert.equal(probe.fps, 60);
  assert.equal(probe.audioCodec, "pcm_s16le");
  assert.equal(probe.audioChannels, 2);
});

test("parses display-matrix rotation (counter-clockwise → normalized)", () => {
  const probe = parseFfmpegProbe(stderr([
    "  Duration: 00:00:02.00, start: 0.000000, bitrate: 3000 kb/s",
    "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1280x720 [SAR 1:1 DAR 16:9], 30 fps, 30 tbr, 15360 tbn (default)",
    "    Side data:",
    "      displaymatrix: rotation of -90.00 degrees",
  ]));
  assert.equal(probe.rotation, 270);
});

test("degraded gracefully: unknown duration, junk output, empty output", () => {
  const unknown = parseFfmpegProbe(stderr([
    "  Duration: N/A, start: 0.000000, bitrate: N/A",
    "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1280x720 [SAR 1:1 DAR 16:9], 30 fps, 30 tbr, 15360 tbn (default)",
  ]));
  assert.equal(unknown.durationMs, null);
  assert.equal(unknown.bitrateMbps, null);
  assert.equal(unknown.width, 1280);

  const junk = parseFfmpegProbe("garbage that is not ffmpeg output");
  assert.equal(junk.videoCodec, null);
  assert.equal(junk.width, null);
  assert.equal(isUsableProbe(junk), false);

  assert.equal(isUsableProbe(parseFfmpegProbe("")), false);
});

test("parses ffprobe JSON output (29.97fps, 5.1 audio, format bitrate)", () => {
  const probe = parseFfprobeJson(JSON.stringify({
    streams: [
      {
        index: 0,
        codec_name: "h264",
        codec_type: "video",
        width: 1920,
        height: 1080,
        pix_fmt: "yuv420p",
        r_frame_rate: "30000/1001",
        avg_frame_rate: "30000/1001",
        duration: "10.000000",
        bit_rate: "6000000",
      },
      { index: 1, codec_name: "aac", codec_type: "audio", channels: 6, duration: "10.000000" },
    ],
    format: { duration: "10.000000", bit_rate: "6288000" },
  }));
  assert.equal(probe.videoCodec, "h264");
  assert.equal(probe.fps, 29.97);
  assert.equal(probe.pixelFormat, "yuv420p");
  assert.equal(probe.audioCodec, "aac");
  assert.equal(probe.audioChannels, 6);
  assert.equal(probe.durationMs, 10000);
  assert.equal(probe.bitrateMbps, 6.288);
});

test("ffprobe JSON with rotation side data is normalized", () => {
  const probe = parseFfprobeJson(JSON.stringify({
    streams: [
      {
        codec_name: "h264",
        codec_type: "video",
        width: 1080,
        height: 1920,
        pix_fmt: "yuv420p",
        r_frame_rate: "30/1",
        rotation: -90,
      },
    ],
    format: {},
  }));
  assert.equal(probe.rotation, 270);
});

test("frame-rate and channel-layout helpers", () => {
  assert.equal(fpsFromFrameRate("30000/1001"), 29.97);
  assert.equal(fpsFromFrameRate("60/1"), 60);
  assert.equal(fpsFromFrameRate("0/0"), null);
  assert.equal(fpsFromFrameRate(null), null);
  assert.equal(fpsFromFrameRate("29.97"), 29.97);
  assert.equal(channelCountFromLayout("stereo"), 2);
  assert.equal(channelCountFromLayout("5.1"), 6);
  assert.equal(channelCountFromLayout("5.1(side)"), 6);
  assert.equal(channelCountFromLayout("7.1"), 8);
  assert.equal(channelCountFromLayout("mono"), 1);
  assert.equal(channelCountFromLayout("unknown"), null);
});