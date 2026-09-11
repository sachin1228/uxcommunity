/**
 * Client side of video uploads — DIRECT to R2.
 *
 *   1. ask the app for a one-shot presigned PUT ticket
 *   2. PUT the file straight to storage (XHR, byte-level progress — these
 *      events now measure the REAL transfer, the slow hop)
 *   3. call the completion endpoint so the server verifies the object
 *
 * If the ticket step fails, falls back to the classic multipart proxy
 * upload (progress then only measures the fast browser→app hop).
 *
 * The file itself is never re-encoded: a lossless faststart remux may have
 * happened client-side, and a first-frame poster is captured for cards.
 */

import { IMMUTABLE_CACHE_CONTROL, VIDEO_MIME_TYPES as VIDEO_MIME_TYPES_SET } from "@uxcommunity/shared";
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
    // Echo the Cache-Control that was signed into the presigned URL so the
    // object is stored immutable and the CDN edge can cache it. The value
    // must match the server's presign exactly or the signature check fails.
    xhr.setRequestHeader("Cache-Control", IMMUTABLE_CACHE_CONTROL);
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

/** Classic multipart proxy upload (fallback when ticketing is unavailable). */
function proxyUpload(
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

/**
 * Uploads a prepared video: direct browser→R2 with real transfer progress,
 * falling back to the proxy path if the ticket cannot be issued.
 */
export async function uploadVideo(
  communityId: string,
  prepared: PreparedVideoUpload,
  onProgress?: (sent: number, total: number) => void,
): Promise<VideoUploadResponse> {
  let ticket: UploadTicket;
  try {
    ticket = await requestTicket(communityId, prepared);
  } catch {
    // Presigning unavailable (e.g. older deploy) — proxy path still works.
    return proxyUpload(communityId, prepared, onProgress);
  }

  try {
    await putWithProgress(ticket.uploadUrl, prepared.file, prepared.file.type, onProgress);
    if (prepared.poster && ticket.posterUploadUrl) {
      // Poster is decorative — best effort, never fail the upload over it.
      try {
        await putWithProgress(ticket.posterUploadUrl, prepared.poster, "image/jpeg");
      } catch (posterError) {
        console.warn("[video-upload] poster upload failed:", posterError);
      }
    }
  } catch (directError) {
    // Most common cause: the bucket's CORS policy does not (yet) allow
    // browser PUTs — the request never leaves the browser. The proxy path
    // still works, so uploads must not break while CORS is being configured.
    console.warn("[video-upload] direct PUT failed, using proxy fallback:", directError);
    return proxyUpload(communityId, prepared, onProgress);
  }
  return completeDirectUpload(communityId, ticket, prepared);
}
