/**
 * Container sniffing — byte-level inspection shared by the web app client
 * so it identifies sources without ever trusting the browser MIME type or
 * filename.
 */

/** True when the bytes start with an MP4/MOV signature (`ftyp` box). */
export function looksLikeMp4(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxSize = view.getUint32(0);
  if (boxSize < 8) return false;
  return bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70; // "ftyp"
}

/**
 * Sniffs the container family from the file's own bytes. Returns null for
 * anything that is not an MP4/MOV/WebM.
 */
export function sniffVideoContainer(bytes: Uint8Array): "mp4" | "mov" | "webm" | null {
  if (bytes.length < 12) return null;
  if (looksLikeMp4(bytes)) {
    const major = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    return /^qt\s\s/i.test(major) ? "mov" : "mp4";
  }
  const isEbml =
    bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  return isEbml ? "webm" : null;
}

/** Box type (FourCC) at the given byte offset, or null when out of range. */
function boxType(bytes: Uint8Array, offset: number): string | null {
  if (offset + 8 > bytes.length) return null;
  return String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
}

/**
 * True when the MP4 `moov` atom (the playback index browsers need before
 * drawing a frame) appears within the first 1 KB of the file — the practical
 * definition of "faststart". `moov` at the end forces whole-file buffering.
 */
export function isFaststart(bytes: Uint8Array): boolean {
  if (!looksLikeMp4(bytes)) return false;
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