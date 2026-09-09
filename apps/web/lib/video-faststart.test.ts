import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires an explicit TS extension.
import { isFaststart, looksLikeMp4 } from "./video-client.ts";

/** Builds a minimal ISO-BMFF byte layout from [type, bodyLength] pairs. */
function mp4(boxes: Array<[string, number]>): Uint8Array {
  const sizes = boxes.map(([, body]) => 8 + body);
  const bytes = new Uint8Array(sizes.reduce((sum, size) => sum + size, 0));
  let offset = 0;
  for (const [type, body] of boxes) {
    const size = 8 + body;
    new DataView(bytes.buffer).setUint32(offset, size);
    for (let i = 0; i < 4; i += 1) bytes[offset + 4 + i] = type.charCodeAt(i);
    offset += size;
  }
  return bytes;
}

test("looksLikeMp4 detects the ftyp signature and rejects others", () => {
  const file = mp4([["ftyp", 8], ["moov", 4]]);
  assert.equal(looksLikeMp4(file), true);
  // WebM starts with the EBML magic (0x1A45DFA3), not `ftyp`.
  assert.equal(looksLikeMp4(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])), false);
  // Too short to even hold a box header.
  assert.equal(looksLikeMp4(new Uint8Array(8)), false);
  // A box claiming size < 8 is malformed.
  assert.equal(looksLikeMp4(new Uint8Array([0, 0, 0, 4, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0])), false);
});

test("isFaststart is true when moov precedes mdat", () => {
  // ftyp + moov + mdat is the faststart layout browsers can stream.
  assert.equal(isFaststart(mp4([["ftyp", 8], ["moov", 16], ["mdat", 64]])), true);
  // moov at the very front (some muxers skip `free`) is still faststart.
  assert.equal(isFaststart(mp4([["ftyp", 4], ["moov", 8]])), true);
});

test("isFaststart is false when mdat comes first (moov at the end)", () => {
  // The classic slow layout: media data first, index last — browsers must
  // download the whole file before the first frame.
  assert.equal(isFaststart(mp4([["ftyp", 8], ["mdat", 128], ["moov", 32]])), false);
});

test("isFaststart tolerates free/skip boxes before moov", () => {
  assert.equal(isFaststart(mp4([["ftyp", 8], ["free", 4], ["moov", 16], ["mdat", 64]])), true);
});

test("isFaststart rejects non-MP4 and malformed layouts", () => {
  assert.equal(isFaststart(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])), false);
  // A zero-size box would loop forever — must bail out as not-faststart.
  assert.equal(isFaststart(new Uint8Array([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0])), false);
  // Unknown box type mid-scan with a size running past the buffer.
  assert.equal(isFaststart(mp4([["ftyp", 8], ["xxxx", 9999]])), false);
});
