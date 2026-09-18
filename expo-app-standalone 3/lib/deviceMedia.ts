/**
 * Saving chat media to the device.
 *
 * The chat images live on the R2/CDN host, so saving is a two-step: download
 * the file into the app cache, then hand the local file to the photo library.
 * `saveToLibraryAsync` is used rather than `createAssetAsync` because it
 * copies the file first — an asset created from a cache URI is invalidated
 * when the OS clears the cache directory.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';

export type SaveResult =
  | { ok: true }
  | { ok: false; reason: 'permission' | 'download' | 'failed' };

/** Derive a sane filename (keeping the extension) from a CDN/object URL. */
export function fileNameForUrl(url: string): string {
  try {
    const name = (url.split('?')[0].split('/').pop() ?? '')
      .replace(/[^\w.-]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!name) return 'chat-image.jpg';
    return /\.\w{2,5}$/.test(name) ? name : `${name}.jpg`;
  } catch {
    return 'chat-image.jpg';
  }
}

/** True when the caller already has permission to add to the gallery. */
async function ensureGalleryPermission(): Promise<boolean> {
  // writeOnly requests add-only access, which is all saving needs — it avoids
  // asking for the member's whole photo library.
  const existing = await MediaLibrary.getPermissionsAsync(true);
  if (existing.granted) return true;

  const requested = await MediaLibrary.requestPermissionsAsync(true);
  return requested.granted;
}

/** Downloads `url` and saves it to the photo gallery. */
export async function saveImageToGallery(url: string): Promise<SaveResult> {
  try {
    if (!(await ensureGalleryPermission())) return { ok: false, reason: 'permission' };

    const cacheDir = FileSystem.cacheDirectory;
    if (!cacheDir) return { ok: false, reason: 'failed' };

    const target = `${cacheDir}${Date.now()}-${fileNameForUrl(url)}`;
    const download = await FileSystem.downloadAsync(url, target);
    if (download.status !== 200) return { ok: false, reason: 'download' };

    await MediaLibrary.saveToLibraryAsync(download.uri);

    // Best-effort cache cleanup; the library keeps its own copy.
    await FileSystem.deleteAsync(download.uri, { idempotent: true }).catch(() => {});

    return { ok: true };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
