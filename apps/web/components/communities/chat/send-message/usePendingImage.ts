"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** The image attached in the composer, with its blob-URL preview lifecycle. */
export function usePendingImage() {
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [pendingImagePreview, setPendingImagePreview] = useState<string | null>(null);

  const prevPreviewRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevPreviewRef.current && prevPreviewRef.current !== pendingImagePreview) {
      URL.revokeObjectURL(prevPreviewRef.current);
    }

    prevPreviewRef.current = pendingImagePreview;

    return () => {
      if (pendingImagePreview) {
        URL.revokeObjectURL(pendingImagePreview);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleImageSelect = useCallback((file: File) => {
    setPendingImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setPendingImageFile(file);
  }, []);

  const handleImageClear = useCallback(() => {
    setPendingImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPendingImageFile(null);
  }, []);

  /**
   * Clear the attachment WITHOUT revoking its blob URL — the send pipeline
   * keeps showing it in the optimistic bubble and revokes it when done.
   */
  const detachPendingImage = useCallback(() => {
    setPendingImagePreview(null);
    setPendingImageFile(null);
  }, []);

  return {
    pendingImageFile,
    pendingImagePreview,
    handleImageSelect,
    handleImageClear,
    detachPendingImage,
  };
}
