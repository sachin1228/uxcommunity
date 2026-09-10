"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ShowcaseAttachment } from "./types";
import { SHOWCASE_MEDIA_MAX } from "./types";
import { compressImage, compressedFile } from "@/lib/image-client";
import { VIDEO_TYPES, QUEUED_FALLBACK_AFTER_MS, cancelVideo, encodeVideo, finalizeVideo, finalizeVideoPassthrough, pollQueuedVideo, prepareVideoForPipeline, uploadVideo } from "@/lib/video/video-pipeline";
import type { VideoDecision } from "@/lib/video/video-types";

/** Client-side caps — mirror the upload route (images ≤ 8 MB, videos ≤ 25 MB). */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * Media intake for the "Share your work" composer.
 *
 * Images keep the existing flow (client-side WebP compression + moderated
 * upload). Videos flow through the CENTRALIZED video pipeline:
 *
 *   upload original → (FFmpeg wasm worker encodes) → finalize → ready
 *
 * Each attachment carries its pipeline state so the composer can show
 * Uploading… / Processing… (with progress) / Ready, and a failed encode can
 * be retried WITHOUT re-uploading — the original stays in R2 and the worker
 * simply runs again.
 */
export function useShowcaseFileUpload({
  communityId,
  initialAttachments = [],
}: {
  communityId: string | undefined;
  initialAttachments?: ShowcaseAttachment[];
}) {
  const [attachments, setAttachments] = useState<ShowcaseAttachment[]>(initialAttachments);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  /** Per-media encode progress (0–100) for the composer UI. */
  const [progress, setProgress] = useState<Record<string, number>>({});

  // Fresh copy for limit checks inside stable callbacks (a second drop lands
  // before re-render otherwise sees a stale list).
  const attachmentsRef = useRef(attachments);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  /** Original file bytes + poster held for the encode step (transcodes only). */
  const originalsRef = useRef(new Map<string, { file: File; poster: Blob | null }>());

  // dragenter/dragleave fire for every child element crossed; counting them
  // (instead of booleans) keeps the overlay steady while over nested nodes.
  const dragDepthRef = useRef(0);

  const setAttachment = useCallback((mediaId: string, patch: Partial<ShowcaseAttachment>) => {
    setAttachments((current) =>
      current.map((item) => (item.mediaId === mediaId ? { ...item, ...patch } : item)),
    );
  }, []);

  /**
   * Runs the FFmpeg worker + finalize for one transcode attachment.
   * Resumable: the original bytes live in `originalsRef` (or R2), so a failed
   * encode never requires re-uploading.
   */
  const runEncode = useCallback(
    async (attachment: ShowcaseAttachment, decision: VideoDecision) => {
      const mediaId = attachment.mediaId;
      const original = mediaId ? originalsRef.current.get(mediaId) : undefined;
      if (!mediaId || !original || !communityId) {
        if (mediaId) setAttachment(mediaId, { status: "failed" });
        return;
      }
      const startedAt = performance.now();
      setAttachment(mediaId, { status: "processing", errorMessage: undefined });
      setProgress((current) => ({ ...current, [mediaId]: 0 }));
      try {
        const result = await encodeVideo(
          mediaId,
          original.file,
          decision,
          (value) => setProgress((current) => ({ ...current, [mediaId]: value })),
        );
        const finalized = await finalizeVideo(
          communityId,
          mediaId,
          result.file,
          original.poster,
          {
            width: result.width,
            height: result.height,
            fps: result.fps,
            durationMs: result.durationMs,
            videoCodec: result.videoCodec,
            audioCodec: result.audioCodec,
          },
          performance.now() - startedAt,
        );
        if (finalized.status === "deleted") {
          // Post/media was deleted while processing — drop the attachment.
          setAttachments((current) => current.filter((item) => item.mediaId !== mediaId));
        } else if (finalized.attachment) {
          setAttachment(mediaId, { ...finalized.attachment, status: "ready" });
        }
        originalsRef.current.delete(mediaId);
        setProgress((current) => {
          const next = { ...current };
          delete next[mediaId];
          return next;
        });
      } catch (err) {
        console.error("[showcase video] encode failed:", err);
        setAttachment(mediaId, {
          status: "failed",
          errorMessage: err instanceof Error ? err.message : "Video processing failed.",
        });
        setProgress((current) => {
          const next = { ...current };
          delete next[mediaId];
          return next;
        });
      }
    },
    [communityId, setAttachment],
  );

  /**
   * Waits for the server-side transcoder; falls back to the in-browser
   * FFmpeg wasm worker when no worker completes the job within the grace period.
   */
  const awaitServerOrFallback = useCallback(
    async (attachment: ShowcaseAttachment, decision: VideoDecision) => {
      const mediaId = attachment.mediaId;
      if (!mediaId || !communityId) return;
      setAttachment(mediaId, { status: "processing" });
      const result = await pollQueuedVideo(communityId, mediaId, {
        timeoutMs: QUEUED_FALLBACK_AFTER_MS,
      });
      if (result.status === "ready" && result.attachment) {
        setAttachment(mediaId, { ...result.attachment, status: "ready" });
        originalsRef.current.delete(mediaId);
        return;
      }
      if (result.status === "failed") {
        setAttachment(mediaId, { status: "failed", errorMessage: "Processing failed on the server." });
        return;
      }
      if (result.status === "deleted") {
        setAttachments((current) => current.filter((item) => item.mediaId !== mediaId));
        return;
      }
      // Still queued/processing — no transcoder around (local dev, outage).
      // Fall back to the in-browser FFmpeg wasm worker.
      void runEncode(attachment, decision);
    },
    [communityId, runEncode, setAttachment],
  );

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (attachmentsRef.current.length + files.length > SHOWCASE_MEDIA_MAX) {
        setError(`You can add up to ${SHOWCASE_MEDIA_MAX} images or videos.`);
        return;
      }

      for (const file of files) {
        if (IMAGE_TYPES.has(file.type) && file.size > MAX_IMAGE_BYTES) {
          setError("Images must be 8 MB or smaller.");
          return;
        }
        if (VIDEO_TYPES.has(file.type) && file.size > MAX_VIDEO_BYTES) {
          setError("Videos must be 25 MB or smaller.");
          return;
        }
      }

      setUploading(true);
      setError(null);
      try {
        for (const file of files) {
          if (VIDEO_TYPES.has(file.type)) {
            // ── Centralized video pipeline ────────────────────────────────
            // Probe → decide (passthrough / lossless remux / FFmpeg transcode)
            // → upload original → server-side transcoder (async, polled) —
            // with the in-browser FFmpeg worker as automatic fallback if no
            // transcoder picks the job up in time.
            const prepared = await prepareVideoForPipeline(file);
            const response = await uploadVideo(communityId!, prepared);
            const attachment = response.attachment;
            setAttachments((current) => [...current, attachment]);
            if (attachment.mediaId) {
              originalsRef.current.set(attachment.mediaId, {
                file,
                poster: prepared.poster,
              });
              if (response.status === "queued") {
                void awaitServerOrFallback(attachment, prepared.decision);
              } else {
                originalsRef.current.delete(attachment.mediaId);
              }
            }
          } else {
            // ── Images: existing pipeline, unchanged ──────────────────────
            let payload = file;
            if (file.type !== "image/gif") {
              try {
                payload = compressedFile(await compressImage(file), file);
              } catch { /* keep original */ }
            }
            const formData = new FormData();
            formData.append("file", payload);
            const response = await fetch(
              `/api/communities/${communityId}/showcase/upload`,
              { method: "POST", body: formData },
            );
            const data = await response.json();
            if (!response.ok) throw new Error(data.error ?? "Upload failed.");
            setAttachments((current) => [...current, data.attachment as ShowcaseAttachment]);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setUploading(false);
      }
    },
    [awaitServerOrFallback, communityId],
  );

  /** Retries a failed encode — the original is still in R2, no re-upload. */
  const retryAttachment = useCallback(
    (attachment: ShowcaseAttachment) => {
      if (!attachment.mediaId) return;
      // Retry prefers the server-side transcoder again, then the wasm worker.
      void awaitServerOrFallback(attachment, {
        strategy: "transcode",
        preset: attachment.preset ?? "slow",
        copyVideo: attachment.copyVideo,
        reason: "retry",
      });
    },
    [awaitServerOrFallback],
  );

  // After an edit (initialAttachments change), resume videos that never
  // reached `ready`:
  //   - `uploaded` (client-wasm era): original bytes are gone after a reload,
  //     so the lossless passthrough promotes the stored original (zero
  //     re-encode) via finalize.
  //   - `queued` (server transcoder): the worker will complete + patch the
  //     post server-side; just poll for the terminal state to refresh the UI.
  useEffect(() => {
    for (const item of initialAttachments) {
      if (!item.type.startsWith("video/") || !item.mediaId || !communityId) continue;
      if (item.status === "uploaded") {
        void finalizeVideoPassthrough(communityId, item.mediaId).then((result) => {
          if (result.status === "ready" && result.attachment) {
            setAttachment(item.mediaId!, { ...result.attachment, status: "ready" });
          }
        }).catch(() => {
          // Keep the placeholder state — the admin sweep cleans up leftovers.
        });
      } else if (item.status === "queued") {
        void pollQueuedVideo(communityId, item.mediaId, { timeoutMs: 60_000 }).then((result) => {
          if (result.status === "ready" && result.attachment) {
            setAttachment(item.mediaId!, { ...result.attachment, status: "ready" });
          }
        }).catch(() => {
          // Still queued — keep the placeholder; the transcoder patches the
          // post itself when it completes.
        });
      }
    }
  }, [initialAttachments, communityId, setAttachment]);

  const addFiles = useCallback(
    (fileList: FileList | File[] | null) => {
      const files = Array.from(fileList ?? []);
      if (files.length) void uploadFiles(files);
    },
    [uploadFiles],
  );

  const removeAttachment = useCallback(
    (url: string, mediaId?: string) => {
      setAttachments((current) => current.filter((a) => a.url !== url && a.mediaId !== mediaId));
      if (mediaId) {
        originalsRef.current.delete(mediaId);
        if (communityId) void cancelVideo(communityId, mediaId);
      }
    },
    [communityId],
  );

  const hasFiles = (event: React.DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes("Files");

  const onDragEnter = useCallback((event: React.DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  }, []);

  const onDragOver = useCallback((event: React.DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDragLeave = useCallback((event: React.DragEvent) => {
    if (!hasFiles(event)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  }, []);

  const onDrop = useCallback((event: React.DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);
    addFiles(event.dataTransfer?.files ?? null);
  }, [addFiles]);

  const dropHandlers = { onDragEnter, onDragOver, onDragLeave, onDrop };

  return {
    attachments,
    removeAttachment,
    uploading,
    error,
    setError,
    addFiles,
    dropHandlers,
    isDragging,
    progress,
    retryAttachment,
  };
}