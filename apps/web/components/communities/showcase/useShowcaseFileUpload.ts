"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ShowcaseAttachment } from "./types";
import { SHOWCASE_MEDIA_MAX } from "./types";
import { compressImage, compressedFile } from "@/lib/image-client";
import { processVideoForUpload } from "@/lib/video-client";

/** Client-side caps — mirror the upload route (images ≤ 8 MB, videos ≤ 25 MB). */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

/**
 * Media intake for the "Share your work" composer. Mirrors the thread upload
 * hook (one path for the file picker and drag-and-drop, same client-side image
 * compression — animated GIFs pass through untouched) and extends it with
 * video support so a showcase can mix images and clips in one carousel.
 *
 * The hook owns the attachment list: feed `addFiles` from both the hidden
 * <input type="file"> and drop events, spread `dropHandlers` onto the modal
 * form, and render `attachments` via the composer's media row.
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

  // Fresh copy for limit checks inside stable callbacks (a second drop lands
  // before re-render otherwise sees a stale list).
  const attachmentsRef = useRef(attachments);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  // dragenter/dragleave fire for every child element crossed; counting them
  // (instead of booleans) keeps the overlay steady while over nested nodes.
  const dragDepthRef = useRef(0);

  const uploadFiles = useCallback(async (files: File[]) => {
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
      const uploaded: ShowcaseAttachment[] = [];
      for (const file of files) {
        // Videos are made stream-friendly before upload: MOV→MP4, moov atom
        // moved to the front (faststart, no re-encode), plus a first-frame
        // poster so feed cards render instantly while the video streams in.
        // Fails soft — falls back to the original file.
        const prepared = VIDEO_TYPES.has(file.type) ? await processVideoForUpload(file) : null;
        const payload = prepared?.file ?? file;

        // Size caps apply to what actually gets uploaded (the processed file).
        const capBytes = VIDEO_TYPES.has(file.type) ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
        if (payload.size > capBytes) {
          setError(
            VIDEO_TYPES.has(file.type)
              ? "Videos must be 25 MB or smaller."
              : "Images must be 8 MB or smaller.",
          );
          return;
        }

        const formData = new FormData();
        if (IMAGE_TYPES.has(file.type) && file.type !== "image/gif") {
          let compressed = file;
          try { compressed = compressedFile(await compressImage(file), file); } catch { /* keep original */ }
          formData.append("file", compressed);
        } else {
          formData.append("file", payload);
        }
        if (prepared?.poster) formData.append("poster", prepared.poster, "poster.jpg");

        const response = await fetch(
          `/api/communities/${communityId}/showcase/upload`,
          {
            method: "POST",
            body: formData,
          },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Upload failed.");
        uploaded.push(data.attachment as ShowcaseAttachment);
      }
      setAttachments((current) => [...current, ...uploaded]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }, [communityId]);

  const addFiles = useCallback(
    (fileList: FileList | File[] | null) => {
      const files = Array.from(fileList ?? []);
      if (files.length) void uploadFiles(files);
    },
    [uploadFiles],
  );

  const removeAttachment = useCallback((url: string) => {
    setAttachments((current) => current.filter((a) => a.url !== url));
  }, []);

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

  return { attachments, removeAttachment, uploading, error, setError, addFiles, dropHandlers, isDragging };
}