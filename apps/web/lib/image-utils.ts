/**
 * Avatar image compression — server-side only.
 *
 * Resizes uploaded avatars to a max of 400×400 and converts to WebP at
 * quality 85 before storing in Supabase.  This cuts storage size by ~70–85%
 * vs raw JPEG/PNG and reduces egress every time the avatar is served.
 *
 * Sharp is already a dependency; this is a thin wrapper so both avatar routes
 * share the same compression settings.
 */

import sharp from "sharp";

export interface CompressedImage {
  data: Buffer;
  contentType: "image/webp";
  ext: "webp";
}

/**
 * Compress an arbitrary image buffer (JPEG / PNG / WebP) to WebP.
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
