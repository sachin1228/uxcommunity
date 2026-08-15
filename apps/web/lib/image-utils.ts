/**
 * Image helpers — pure functions only (no native deps).
 *
 * Image compression now happens client-side (see lib/image-client.ts); the
 * server stores the moderated bytes as-is. This module keeps the shared
 * upload-route helper that derives a file extension from the detected MIME.
 */

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