/**
 * Native image preparation for uploads (Expo / React Native).
 *
 * Mirrors the web compression contract so Android/iOS uploads produce images
 * compatible with the web pipeline:
 *
 *   WebP (or JPEG fallback) · quality 0.90 · longest edge ≤ 2560px ·
 *   never upscaled · aspect ratio preserved · alpha preserved
 *
 * The actual work is done by expo-image-manipulator's contextual API, which
 * renders on the platform's native codecs (libwebp/Bitmap on Android) off the
 * JS thread — no WASM and no server-side image processing.
 */

import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { ImagePickerAsset } from "expo-image-picker";

/** Universal lossy quality — matches IMAGE_QUALITY in the web app (0–1 scale). */
export const IMAGE_QUALITY = 0.9;

/** Universal longest-edge cap in pixels — matches MAX_DIMENSION in the web app. */
export const MAX_DIMENSION = 2560;

export interface PreparedImage {
  uri: string;
  mimeType: "image/webp" | "image/jpeg" | "image/png";
  /** Output filename including extension (always agrees with mimeType). */
  name: string;
  width: number;
  height: number;
}

function baseNameOf(fileName: string | null | undefined, fallback: string): string {
  if (!fileName) return fallback;
  return fileName.replace(/\.[^./]+$/, "") || fallback;
}

function normaliseMimeType(raw: string | null | undefined): string {
  const lower = (raw ?? "").toLowerCase();
  if (lower === "image/jpg" || lower === "image/jfif" || lower === "image/pjpeg") return "image/jpeg";
  if (lower === "image/x-png") return "image/png";
  return lower;
}

/**
 * Downscale (single dimension → aspect ratio preserved) and re-encode `asset`.
 * Throws when the platform encoder rejects the requested format, so the caller
 * can decide on a fallback.
 */
async function renderAs(asset: ImagePickerAsset, format: SaveFormat): Promise<{ uri: string; width: number; height: number }> {
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  const longest = Math.max(width, height);

  const context = ImageManipulator.manipulate(asset.uri);
  if (longest > MAX_DIMENSION) {
    // One dimension only — the other is computed to preserve the aspect ratio.
    // Never upscale, never distort.
    if (width >= height) context.resize({ width: MAX_DIMENSION });
    else context.resize({ height: MAX_DIMENSION });
  }

  const image = await context.renderAsync();
  const result = await image.saveAsync({ compress: IMAGE_QUALITY, format });
  return { uri: result.uri, width: result.width, height: result.height };
}

/**
 * Prepare a picked image for upload, preferring WebP at quality 0.90 (alpha is
 * preserved). Falls back to JPEG at the same quality when the platform encoder
 * cannot produce WebP, and finally to the original picked asset so uploads
 * never silently break.
 */
export async function prepareImageForUpload(
  asset: ImagePickerAsset,
  fallbackName: string,
): Promise<PreparedImage> {
  const baseName = baseNameOf(asset.fileName, fallbackName);

  try {
    const webp = await renderAs(asset, SaveFormat.WEBP);
    return { uri: webp.uri, mimeType: "image/webp", name: `${baseName}.webp`, width: webp.width, height: webp.height };
  } catch (webpError) {
    console.warn("[prepareImage] WebP encode unavailable, falling back to JPEG.", webpError);
  }

  try {
    const jpeg = await renderAs(asset, SaveFormat.JPEG);
    return { uri: jpeg.uri, mimeType: "image/jpeg", name: `${baseName}.jpg`, width: jpeg.width, height: jpeg.height };
  } catch (jpegError) {
    console.warn("[prepareImage] Re-encode failed, uploading the original picked image.", jpegError);
  }

  const mime = normaliseMimeType(asset.mimeType);
  const originalMime =
    mime === "image/jpeg" || mime === "image/png" || mime === "image/webp" ? mime : "image/jpeg";
  const ext = originalMime === "image/jpeg" ? "jpg" : originalMime === "image/png" ? "png" : "webp";
  return {
    uri: asset.uri,
    mimeType: originalMime,
    name: `${baseName}.${ext}`,
    width: asset.width ?? 0,
    height: asset.height ?? 0,
  };
}
