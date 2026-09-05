/**
 * Pure image geometry helpers — safe to import anywhere (main thread, worker,
 * SSR). No DOM, no WASM.
 */

/**
 * Downscale `width` × `height` to fit inside `maxDimension` on the longest
 * edge. Never upscales and always preserves the aspect ratio.
 */
export function fitWithinBounds(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxDimension) return { width, height };
  const scale = maxDimension / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Read the pixel dimensions of a WebP file from its container header — cheap
 * (first 64 bytes), no full decode. Supports the three chunk layouts:
 *
 *   VP8X  (extended, may carry alpha / animation)  — canvas size
 *   VP8L  (lossless)                                — 14-bit width/height fields
 *   VP8   (lossy)                                   — 14-bit width/height fields
 *
 * Returns null when the bytes do not look like a readable WebP header so the
 * caller can fall back to a full decode/encode.
 */
export async function readWebpDimensions(file: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    if (head.length < 12) return null;
    // "RIFF" .... "WEBP"
    if (
      head[0] !== 0x52 || head[1] !== 0x49 || head[2] !== 0x46 || head[3] !== 0x46 ||
      head[8] !== 0x57 || head[9] !== 0x45 || head[10] !== 0x42 || head[11] !== 0x50
    ) {
      return null;
    }

    const fourcc = String.fromCharCode(head[12], head[13], head[14], head[15]);
    if (fourcc === "VP8X") {
      // 24-bit little-endian canvas size, stored as size-1 at bytes 24..29.
      if (head.length < 30) return null;
      const width = 1 + head[24] + (head[25] << 8) + (head[26] << 16);
      const height = 1 + head[27] + (head[28] << 8) + (head[29] << 16);
      if (width > 0 && height > 0) return { width, height };
      return null;
    }

    if (fourcc === "VP8L") {
      // Lossless: byte 20 is the 0x2f signature; the next 4 bytes pack 14-bit
      // width-1 and height-1 fields.
      if (head.length < 25) return null;
      if (head[20] !== 0x2f) return null;
      const bits = head[21] | (head[22] << 8) | (head[23] << 16) | (head[24] << 24);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      return { width, height };
    }

    if (fourcc === "VP8 ") {
      // Lossy frames start with a `9d 01 2a` start code followed by two 14-bit
      // little-endian dimensions. Most writers place the start code at the very
      // start of the payload, but the libwebp build inside @jsquash prefixes an
      // extra 3 bytes — so scan a couple of offsets instead of assuming one.
      for (let p = 0; p <= 6; p += 3) {
        // width/height read up to byte 26 + p
        if (head.length < 27 + p) break;
        if (head[20 + p] === 0x9d && head[21 + p] === 0x01 && head[22 + p] === 0x2a) {
          const width = (head[23 + p] | (head[24 + p] << 8)) & 0x3fff;
          const height = (head[25 + p] | (head[26 + p] << 8)) & 0x3fff;
          if (width > 0 && height > 0) return { width, height };
        }
      }
      return null;
    }

    return null;
  } catch {
    return null;
  }
}
