/**
 * Client side of plain video uploads.
 *
 * Videos are stored exactly as the user picked them (no transcoding, no
 * queue): the file is optionally remuxed losslessly for fast streaming
 * (faststart) and a first-frame poster is captured, then the bytes ship to
 * the showcase upload route which lands them in R2 and returns the URL.
 */

import { VIDEO_MIME_TYPES as VIDEO_MIME_TYPES_SET } from "@uxcommunity/shared";
import { processVideoForUpload } from "@/lib/video-client";

export { VIDEO_MIME_TYPES_SET as VIDEO_TYPES };

export interface PreparedVideoUpload {
  file: File;
  poster: Blob | null;
}

/**
 * Prepares a picked video file for upload:
 *   1. lossless faststart remux when needed (MP4/MOV with the index at the
 *      end — streamable immediately otherwise),
 *   2. first-frame poster capture (JPEG) for feed cards.
 * The bytes themselves are NEVER re-encoded.
 */
export async function prepareVideoForPipeline(file: File): Promise<PreparedVideoUpload> {
  const result = await processVideoForUpload(file);
  return { file: result.file, poster: result.poster };
}

export interface VideoUploadResponse {
  mediaId: string;
  status: "ready";
  attachment: {
    name: string;
    url: string;
    type: string;
    size: number;
    poster?: string;
    mediaId: string;
    status: "ready";
  };
}

/** XHR upload with byte-level progress (fetch cannot report upload progress). */
export function uploadVideo(
  communityId: string,
  prepared: PreparedVideoUpload,
  onProgress?: (sent: number, total: number) => void,
): Promise<VideoUploadResponse> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", prepared.file);
    if (prepared.poster) form.append("poster", prepared.poster, "poster.jpg");

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/communities/${communityId}/showcase/upload`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total);
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText) as VideoUploadResponse & { error?: string };
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error ?? `Upload failed (${xhr.status}).`));
      } catch {
        reject(new Error(`Upload failed (${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.send(form);
  });
}
