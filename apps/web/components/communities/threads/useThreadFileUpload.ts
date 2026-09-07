"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ThreadAttachment } from "./types";
import { THREAD_IMAGE_MAX } from "./ThreadComposerControls";
import { compressImage, compressedFile } from "@/lib/image-client";

/** Total attachments (images + files) a thread may carry. */
const THREAD_ATTACHMENTS_MAX = 5;

/**
 * Attachment intake shared by the Create and Edit thread modals so the file
 * picker and drag-and-drop follow one path: the same limits, the same
 * client-side image compression (animated GIFs pass through untouched), the
 * same upload endpoint.
 *
 * The hook owns the attachment list: feed `addFiles` from both the hidden
 * <input type="file"> and drop events, spread `dropHandlers` onto the modal
 * form, and render `attachments` via `ComposerMedia`. `isDragging` is true
 * while files are dragged over the form so callers can highlight the zone.
 */
export function useThreadFileUpload({
  communityId,
  initialAttachments = [],
}: {
  communityId: string | undefined;
  initialAttachments?: ThreadAttachment[];
}) {
  const [attachments, setAttachments] = useState<ThreadAttachment[]>(initialAttachments);
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
    const imageCount = attachmentsRef.current.filter((a) => a.type.startsWith("image/")).length;
    const newImages = files.filter((file) => file.type.startsWith("image/"));
    if (newImages.length > 0 && imageCount + newImages.length > THREAD_IMAGE_MAX) {
      setError(`You can add up to ${THREAD_IMAGE_MAX} images.`);
      return;
    }
    if (attachmentsRef.current.length + files.length > THREAD_ATTACHMENTS_MAX) {
      setError(`You can add up to ${THREAD_ATTACHMENTS_MAX} attachments.`);
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const uploaded: ThreadAttachment[] = [];
      for (const file of files) {
        const formData = new FormData();
        let payload = file;
        // Animated GIFs pass through untouched — compressing them would flatten
        // the animation into a static frame.
        if (file.type.startsWith("image/") && file.type !== "image/gif") {
          try { payload = compressedFile(await compressImage(file), file); } catch { /* keep original */ }
        }
        formData.append("file", payload);
        const response = await fetch(
          `/api/communities/${communityId}/threads/upload`,
          {
            method: "POST",
            body: formData,
          },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Upload failed.");
        uploaded.push(data.attachment as ThreadAttachment);
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
