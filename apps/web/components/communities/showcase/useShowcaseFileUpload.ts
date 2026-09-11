"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ShowcaseAttachment } from "./types";
import { SHOWCASE_MEDIA_MAX } from "./types";
import { compressImage, compressedFile } from "@/lib/image-client";
import { VIDEO_TYPES, prepareVideoForPipeline, uploadVideo } from "@/lib/video/video-upload";
import { MAX_VIDEO_BYTES } from "@uxcommunity/shared";

/** Client-side caps — mirror the upload route (images ≤ 8 MB, videos ≤ 50 MB). */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * Every stage a video goes through after being picked. Rendered as a
 * human-readable feed below the media tiles, so the user always knows what
 * is happening (and what failed, with the error).
 */
export type VideoActivityState =
  | "analyzing" // probing / lossless remux before any bytes flow
  | "uploading" // XHR upload of the original to R2 (percent + clock)
  | "ready"
  | "failed";

/**
 * One entry in the per-video activity feed. Keyed by a client-generated id
 * until the upload completes, then rebound to the mediaId.
 */
export interface VideoActivity {
  key: string;
  name: string;
  state: VideoActivityState;
  /** 0–100 where the stage reports progress (upload). */
  percent: number;
  startedAt: number;
  /** Seconds since the upload started (refreshed by the clock tick). */
  elapsedSec: number;
  /** Projected seconds remaining, when a progress rate is known. */
  etaSec: number | null;
  /** Human-readable failure detail (failed state only). */
  error?: string;
}

/**
 * Media intake for the "Share your work" composer.
 *
 * Images keep the existing flow (client-side WebP compression + moderated
 * upload). Videos are PLAIN FILE UPLOADS:
 *
 *   analyzing → uploading → ready
 *
 * (The file ships as-is; a lossless remux may happen client-side during
 * "analyzing". Nothing is ever queued or transcoded.)
 *
 * Each video drives one `VideoActivity` feed entry (plus its attachment
 * tile), so failures surface with their exact error.
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
  /** Per-video feed shown below the media tiles. */
  const [activity, setActivity] = useState<VideoActivity[]>([]);
  /** Validation failures (count/size) shown under the media input. */
  const [mediaError, setMediaError] = useState<string | null>(null);

  // Fresh copy for limit checks inside stable callbacks (a second drop lands
  // before re-render otherwise sees a stale list).
  const attachmentsRef = useRef(attachments);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  // activityRef is mutated synchronously (not via effect) so a second drop
  // mid-upload sees the in-flight count immediately for the media cap check.
  const activityRef = useRef<VideoActivity[]>([]);
  const uploadSeqRef = useRef(0);

  const upsertActivity = useCallback((key: string, patch: Partial<VideoActivity>) => {
    const existing = activityRef.current.find((item) => item.key === key);
    let next: VideoActivity[];
    if (existing) {
      next = activityRef.current.map((item) => (item.key === key ? { ...item, ...patch } : item));
    } else {
      const base: VideoActivity = {
        key,
        name: patch.name ?? "Video",
        state: "analyzing",
        percent: 0,
        startedAt: Date.now(),
        elapsedSec: 0,
        etaSec: null,
      };
      next = [...activityRef.current, { ...base, ...patch }];
    }
    activityRef.current = next;
    setActivity(next);
  }, []);

  const removeActivity = useCallback((key: string) => {
    activityRef.current = activityRef.current.filter((item) => item.key !== key);
    setActivity(activityRef.current);
  }, []);

  /** Pre-attachment uploads (analyzing/uploading) — these count toward the cap. */
  const pendingUploadCount = () =>
    activityRef.current.filter(
      (item) => item.state === "analyzing" || item.state === "uploading",
    ).length;

  // While a video is uploading, refresh the elapsed/ETA clocks every second
  // (even when no new progress event has arrived) and re-render the feed.
  // NOTE: the effect depends on a BOOLEAN, not the activity array — every
  // tick replaces the array, so an array dependency would re-run this effect
  // each second (React "maximum update depth exceeded"). The boolean only
  // flips when a clock-running item appears or all of them finish.
  const hasClockingUpload = activity.some(
    (item) => item.state === "analyzing" || item.state === "uploading",
  );
  useEffect(() => {
    if (!hasClockingUpload) return;
    const tick = () => {
      const now = Date.now();
      activityRef.current = activityRef.current.map((item) => {
        if (item.state !== "analyzing" && item.state !== "uploading") return item;
        const elapsedSec = Math.max(0, (now - item.startedAt) / 1000);
        return {
          ...item,
          elapsedSec,
          etaSec: item.percent > 0 ? (elapsedSec * (100 - item.percent)) / item.percent : null,
        };
      });
      setActivity(activityRef.current);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [hasClockingUpload]);

  // dragenter/dragleave fire for every child element crossed; counting them
  // (instead of booleans) keeps the overlay steady while over nested nodes.
  const dragDepthRef = useRef(0);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (
        attachmentsRef.current.length + pendingUploadCount() + files.length >
        SHOWCASE_MEDIA_MAX
      ) {
        setMediaError(`You can add up to ${SHOWCASE_MEDIA_MAX} images or videos.`);
        return;
      }

      for (const file of files) {
        if (IMAGE_TYPES.has(file.type) && file.size > MAX_IMAGE_BYTES) {
          setMediaError("Images must be 8 MB or smaller.");
          return;
        }
        if (VIDEO_TYPES.has(file.type) && file.size > MAX_VIDEO_BYTES) {
          setMediaError("Videos must be 50 MB or smaller.");
          return;
        }
      }

      setUploading(true);
      setError(null);
      setMediaError(null);
      try {
        for (const file of files) {
          if (VIDEO_TYPES.has(file.type)) {
            // ── Plain video upload ─────────────────────────────────────────
            // Probe → (lossless remux) → upload as-is → ready immediately.
            const activityKey = `video-${Date.now()}-${uploadSeqRef.current++}`;
            upsertActivity(activityKey, { name: file.name, state: "analyzing", percent: 0 });
            try {
              const prepared = await prepareVideoForPipeline(file);
              upsertActivity(activityKey, { state: "uploading" });
              const response = await uploadVideo(communityId!, prepared, (sent, total) => {
                const percent = total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0;
                upsertActivity(activityKey, { state: "uploading", percent });
              });
              const attachment = response.attachment;
              setAttachments((current) => [...current, attachment]);
              upsertActivity(attachment.mediaId ?? activityKey, {
                name: file.name,
                state: "ready",
                percent: 100,
              });
              removeActivity(activityKey);
            } catch (uploadErr) {
              // Per-video failure — surfaced in the feed with the real error.
              upsertActivity(activityKey, {
                state: "failed",
                error: uploadErr instanceof Error ? uploadErr.message : "Upload failed.",
              });
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
    [upsertActivity, removeActivity, communityId],
  );

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
      if (mediaId) removeActivity(mediaId);
    },
    [removeActivity],
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
    activity,
    mediaError,
  };
}
