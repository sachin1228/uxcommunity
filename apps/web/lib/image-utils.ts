/**
 * Image compression helpers — server-side only.
 *
 * Resizes and converts images to WebP before storing in R2.
 * This cuts storage and egress by 70–85 % vs raw JPEG/PNG.
 *
 * Sharp is already a dependency; these are thin wrappers so every
 * upload route shares consistent compression settings.
 */

import sharp from "sharp";

export interface CompressedImage {
  data: Buffer;
  contentType: "image/webp";
  ext: "webp";
}

/**
 * Compress an avatar image buffer (JPEG / PNG / WebP) to WebP.
 * - Shrinks to at most 400×400, preserving aspect ratio.
 * - Never upscales images smaller than 400×400.
 * - Quality 85 — good visual fidelity at ~60% smaller file size.
 */
export async function compressAvatar(input: Buffer): Promise<CompressedImage> {
  const data = await sharp(input)
    .resize(400, 400, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
  return { data, contentType: "image/webp", ext: "webp" };
}

/**
 * Compress a chat image (JPEG / PNG / WebP / GIF / HEIC) to WebP.
 * More aggressive than avatar compression — chat images don't need
 * pixel-perfect quality; bandwidth and storage matter more.
 *
 * Settings:
 * - Shrinks to at most 1200 px on the longest edge, preserving aspect ratio.
 * - Never upscales.
 * - Quality 65 — visually acceptable at ≈ 80 % smaller than raw JPEG.
 * - Strips all EXIF/metadata (sharp does this by default).
 */
export async function compressChatImage(input: Buffer): Promise<CompressedImage> {
  const data = await sharp(input)
    .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 65 })
    .toBuffer();
  return { data, contentType: "image/webp", ext: "webp" };
}
