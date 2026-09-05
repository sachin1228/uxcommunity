import assert from "node:assert/strict"
import test from "node:test"

import { fitWithinBounds, readWebpDimensions } from "./image-geometry"

// ── fitWithinBounds ──────────────────────────────────────────────────────────

test("fitWithinBounds caps only the longest edge", () => {
  assert.deepEqual(fitWithinBounds(4000, 3000, 2560), { width: 2560, height: 1920 })
  assert.deepEqual(fitWithinBounds(5000, 3500, 2560), { width: 2560, height: 1792 })
  assert.deepEqual(fitWithinBounds(1920, 1080, 2560), { width: 1920, height: 1080 })
})

test("fitWithinBounds never upscales small images", () => {
  assert.deepEqual(fitWithinBounds(800, 600, 2560), { width: 800, height: 600 })
  assert.deepEqual(fitWithinBounds(100, 50, 2560), { width: 100, height: 50 })
})

test("fitWithinBounds handles portrait images", () => {
  assert.deepEqual(fitWithinBounds(3000, 4000, 2560), { width: 1920, height: 2560 })
})

// ── readWebpDimensions ───────────────────────────────────────────────────────

function riff(fourcc: string, payload: number[]): Uint8Array {
  const size = 8 + payload.length
  const bytes = new Uint8Array(20 + payload.length)
  bytes.set([0x52, 0x49, 0x46, 0x46], 0) // "RIFF"
  bytes[4] = size & 0xff
  bytes[5] = (size >> 8) & 0xff
  bytes[6] = (size >> 16) & 0xff
  bytes[7] = (size >> 24) & 0xff
  bytes.set([0x57, 0x45, 0x42, 0x50], 8) // "WEBP"
  const four = fourcc.split("").map((ch) => ch.charCodeAt(0))
  bytes.set(four, 12)
  bytes[16] = payload.length & 0xff
  bytes[17] = (payload.length >> 8) & 0xff
  bytes[18] = (payload.length >> 16) & 0xff
  bytes[19] = (payload.length >> 24) & 0xff
  bytes.set(payload, 20)
  return bytes
}

function blobOf(bytes: Uint8Array): Blob {
  return new Blob([bytes as unknown as BlobPart], { type: "image/webp" })
}

test("readWebpDimensions reads VP8X canvas size", async () => {
  // Canvas size is stored size-1 in 24-bit LE at payload offset 4.
  const w = 2560 - 1
  const h = 1920 - 1
  const payload = [0, 0, 0, 0, w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff]
  assert.deepEqual(await readWebpDimensions(blobOf(riff("VP8X", payload))), { width: 2560, height: 1920 })
})

test("readWebpDimensions reads VP8L lossless size", async () => {
  const width = 800
  const height = 600
  const bits = (width - 1) | ((height - 1) << 14)
  const payload = [
    0x2f,
    bits & 0xff,
    (bits >> 8) & 0xff,
    (bits >> 16) & 0xff,
    (bits >> 24) & 0xff,
  ]
  assert.deepEqual(await readWebpDimensions(blobOf(riff("VP8L", payload))), { width, height })
})

test("readWebpDimensions reads VP8 lossy size with start code first", async () => {
  // Common layout: [9d 01 2a][width LE][height LE]
  const payload = [0x9d, 0x01, 0x2a, 1200 & 0xff, (1200 >> 8) & 0xff, 800 & 0xff, (800 >> 8) & 0xff]
  assert.deepEqual(await readWebpDimensions(blobOf(riff("VP8 ", payload))), { width: 1200, height: 800 })
})

test("readWebpDimensions reads VP8 lossy size with the @jsquash 3-byte prefix", async () => {
  // The libwebp build shipped inside @jsquash prepends 3 bytes before the start
  // code — width/height must still be found after the 9d 01 2a marker.
  const payload = [0x50, 0x18, 0x26, 0x9d, 0x01, 0x2a, 2560 & 0xff, (2560 >> 8) & 0xff, 1920 & 0xff, (1920 >> 8) & 0xff]
  assert.deepEqual(await readWebpDimensions(blobOf(riff("VP8 ", payload))), { width: 2560, height: 1920 })
})

test("readWebpDimensions returns null for non-webp or truncated input", async () => {
  assert.equal(await readWebpDimensions(blobOf(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))), null)
  assert.equal(await readWebpDimensions(new Blob(["hello"])), null)
  assert.equal(await readWebpDimensions(blobOf(riff("VP8 ", [0x9d, 0x01]))), null)
})
