/**
 * Showcase video uploads — the same direct-to-R2 flow the web uses:
 *
 *   1. capture a first-frame poster and ask the app for a presigned PUT ticket
 *   2. PUT the file straight to storage (byte-level progress)
 *   3. call the completion endpoint so the server verifies the object landed
 *
 * Bytes never pass through the app. The file is uploaded as-is — mobile has no
 * client-side remux step, and the API accepts MP4, WebM and MOV.
 */

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as VideoThumbnails from 'expo-video-thumbnails';
import type { ImagePickerAsset } from 'expo-image-picker';
import { apiFetch } from './api';
import type { ThreadAttachment } from './communityContent';

/** The video types the showcase API accepts. */
export const SHOWCASE_VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

/** Mirrors the web/API cap (`MAX_VIDEO_BYTES`). */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

const TYPE_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

const EXTENSION_BY_TYPE: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

/** The picked asset's MIME type, falling back to its filename extension. */
export function videoMimeType(asset: ImagePickerAsset): string | null {
  const declared = (asset.mimeType ?? '').toLowerCase();
  if (SHOWCASE_VIDEO_MIME_TYPES.has(declared)) return declared;
  if (declared === 'video/x-m4v') return 'video/mp4';
  const extension = (asset.fileName ?? asset.uri).split('.').pop()?.toLowerCase() ?? '';
  return TYPE_BY_EXTENSION[extension] ?? null;
}

export function isVideoAsset(asset: ImagePickerAsset): boolean {
  if (asset.type === 'video' || asset.type === 'pairedVideo') return true;
  if ((asset.mimeType ?? '').startsWith('video/')) return true;
  return videoMimeType(asset) !== null;
}

async function videoFileSize(asset: ImagePickerAsset): Promise<number> {
  if (asset.fileSize && asset.fileSize > 0) return asset.fileSize;
  try {
    const info = await FileSystem.getInfoAsync(asset.uri);
    return info.exists && !info.isDirectory ? info.size ?? 0 : 0;
  } catch {
    return 0;
  }
}

/** First-frame JPEG for cards; decorative, so a failure just means no poster. */
async function videoPoster(sourceUri: string): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const thumb = await VideoThumbnails.getThumbnailAsync(sourceUri, { time: 0, quality: 0.7 });
    return thumb.uri;
  } catch {
    return null;
  }
}

interface UploadTicket {
  mediaId: string;
  key: string;
  uploadUrl: string;
  publicUrl: string;
  posterUploadUrl?: string;
  posterPublicUrl?: string;
}

/** Binary PUT straight to R2, with percent progress from the real transfer. */
function putFile(
  url: string,
  fileUri: string,
  contentType: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const task = FileSystem.createUploadTask(
      url,
      fileUri,
      {
        httpMethod: 'PUT',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        // Must match the signed Content-Type exactly.
        headers: { 'Content-Type': contentType },
      },
      (progress) => {
        if (progress.totalBytesExpectedToSend > 0) {
          onProgress?.(
            Math.min(
              100,
              Math.round((progress.totalBytesSent / progress.totalBytesExpectedToSend) * 100),
            ),
          );
        }
      },
    );
    task
      .uploadAsync()
      .then((result) => {
        if (result && result.status >= 200 && result.status < 300) resolve();
        else if (result) reject(new Error(`Storage rejected the upload (${result.status}).`));
        else reject(new Error('Network error during upload.'));
      })
      .catch(() => reject(new Error('Network error during upload.')));
  });
}

/**
 * Upload one picked video to a showcase post and return its ready attachment.
 * `onProgress` reports the byte transfer (0–100).
 */
export async function uploadShowcaseVideo(
  communityId: string,
  asset: ImagePickerAsset,
  onProgress?: (percent: number) => void,
): Promise<ThreadAttachment> {
  const type = videoMimeType(asset);
  if (!type) throw new Error('Choose an MP4, WebM, or MOV video.');

  const size = await videoFileSize(asset);
  if (!(size > 0)) throw new Error('Could not read that video. Try another one.');
  if (size > MAX_VIDEO_BYTES) throw new Error('Videos must be 50 MB or smaller.');

  const name =
    asset.fileName?.trim() ||
    `video-${Date.now()}.${EXTENSION_BY_TYPE[type] ?? 'mp4'}`;

  const posterUri = await videoPoster(asset.uri);

  const { data: ticket } = await apiFetch<UploadTicket>(
    `/api/communities/${communityId}/showcase/upload-ticket`,
    { method: 'POST', body: { type, size, hasPoster: Boolean(posterUri) } },
  );

  await putFile(ticket.uploadUrl, asset.uri, type, onProgress);

  let posterUploaded = false;
  if (posterUri && ticket.posterUploadUrl) {
    try {
      await putFile(ticket.posterUploadUrl, posterUri, 'image/jpeg');
      posterUploaded = true;
    } catch {
      // The poster is decoration — the video itself is what matters.
    }
  }

  const { data } = await apiFetch<{ attachment: ThreadAttachment }>(
    `/api/communities/${communityId}/showcase/upload`,
    {
      method: 'POST',
      body: {
        mediaId: ticket.mediaId,
        key: ticket.key,
        name,
        type,
        size,
        ...(posterUploaded && ticket.posterPublicUrl
          ? { posterUrl: ticket.posterPublicUrl }
          : {}),
      },
    },
  );
  return data.attachment;
}
