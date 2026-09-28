/**
 * Client side of video uploads — DIRECT to R2.
 *
 *   1. ask the app for a one-shot presigned PUT ticket
 *   2. PUT the file straight to storage (XHR, byte-level progress — these
 *      events measure the REAL transfer, the slow hop)
 *   3. call the completion endpoint so the server verifies the object
 *
 * There is deliberately NO multipart proxy fallback: routing a 50 MB video
 * through the app would put it in Worker memory, which the upload route now
 * refuses. A failed direct PUT surfaces as an error the composer shows on the
 * video's tile, and the user can retry.
 *
 * The file itself is never re-encoded: a lossless faststart remux may have
 * happened client-side, and a first-frame poster is captured for cards.
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

interface UploadTicket {
  mediaId: string;
  key: string;
  uploadUrl: string;
  publicUrl: string;
  posterUploadUrl?: string;
  posterPublicUrl?: string;
}

/** XHR PUT with byte-level upload progress (fetch cannot report uploads). */
function putWithProgress(
  url: string,
  body: Blob,
  contentType: string,
  onProgress?: (sent: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    // Must match the signed Content-Type exactly — nothing else may be sent.
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Storage rejected the upload (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.send(body);
  });
}

async function requestTicket(communityId: string, prepared: PreparedVideoUpload): Promise<UploadTicket> {
  const res = await fetch(`/api/communities/${communityId}/showcase/upload-ticket`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: prepared.file.type,
      size: prepared.file.size,
      hasPoster: prepared.poster !== null,
    }),
  });
  const data = (await res.json()) as UploadTicket & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Could not start the upload.");
  return data;
}

/** Register the uploaded object; server HEAD-verifies and returns the attachment. */
async function completeDirectUpload(
  communityId: string,
  ticket: UploadTicket,
  prepared: PreparedVideoUpload,
): Promise<VideoUploadResponse> {
  const res = await fetch(`/api/communities/${communityId}/showcase/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mediaId: ticket.mediaId,
      key: ticket.key,
      name: prepared.file.name,
      type: prepared.file.type,
      size: prepared.file.size,
      ...(ticket.posterPublicUrl ? { posterUrl: ticket.posterPublicUrl } : {}),
    }),
  });
  const data = (await res.json()) as VideoUploadResponse & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Could not finish the upload.");
  return data;
}

/**
 * Uploads a prepared video straight to R2 and finalizes it.
 *
 * Bytes go browser→storage only; the app is asked for a ticket and, at the
 * end, to register the result. A failure at any hop rejects, and the composer
 * shows the error on that video's tile.
 */
export async function uploadVideo(
  communityId: string,
  prepared: PreparedVideoUpload,
  onProgress?: (sent: number, total: number) => void,
): Promise<VideoUploadResponse> {
  const ticket = await requestTicket(communityId, prepared);
  await putWithProgress(ticket.uploadUrl, prepared.file, prepared.file.type, onProgress);
  if (prepared.poster && ticket.posterUploadUrl) {
    // Poster is decorative — best effort, never fail the upload over it.
    try {
      await putWithProgress(ticket.posterUploadUrl, prepared.poster, "image/jpeg");
    } catch (posterError) {
      console.warn("[video-upload] poster upload failed:", posterError);
    }
  }
  return completeDirectUpload(communityId, ticket, prepared);
}
