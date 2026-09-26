/**
 * Image helpers — pure functions only (no native deps).
 *
 * Image compression happens client-side (see lib/image-client.ts); the server
 * stores the uploaded bytes as-is. This module keeps the shared upload-route
 * helpers: sniffing the real image type from the file signature, and mapping
 * that MIME type to a storage extension.
 */

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP_RIFF = "RIFF";
const WEBP_WEBP = "WEBP";

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

/**
 * Detect the real image type from the uploaded bytes.
 *
 * Routes check the declared `File.type` before calling this; sniffing the
 * signature on top means a renamed or mislabelled file can never be stored as
 * an image. Returns null when the bytes match none of the allowed types.
 */
export function detectImageMime(
  buffer: Buffer
): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buffer.length < 12) return null;
  if (hasPrefix(buffer, JPEG)) return "image/jpeg";
  if (hasPrefix(buffer, PNG)) return "image/png";
  if (
    buffer.subarray(0, 4).toString("ascii") === WEBP_RIFF &&
    buffer.subarray(8, 12).toString("ascii") === WEBP_WEBP
  ) {
    return "image/webp";
  }
  return null;
}

/** Map an image MIME type to a file extension (defaults to webp). */
export function extensionForMime(mime: string | null | undefined): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    default:
      return "webp";
  }
}
