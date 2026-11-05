"use client";

import { useEffect, useRef } from "react";
import { Camera, X } from "lucide-react";
import { ModalPortal } from "./Modal";

interface PhotoViewerProps {
  open: boolean;
  /** The photo to show; nothing renders while this is empty. */
  src: string | null | undefined;
  /** The community or member the photo belongs to. */
  name: string;
  /** The line under the name — "Community photo" / "Profile picture". */
  subtitle?: string;
  /**
   * The owner's own photo only: opens the change-photo flow. Closing the
   * viewer first keeps the picker from stacking underneath it.
   */
  onEdit?: () => void;
  onClose: () => void;
}

/**
 * The full-screen photo viewer — a click on a display picture opens it, the
 * way it does in a chat app: the picture alone, centred on a dark canvas,
 * with the name it belongs to above and a way back out. The page behind it
 * keeps its scroll, focus returns to the trigger, and Escape or a click on
 * the canvas closes it.
 *
 * Deliberately not the chat's `ImageLightbox`: that one is a paged gallery
 * that downloads and steps through a conversation's images. This one shows
 * one identity photo and, on the owner's own picture, the edit shortcut.
 */
export function PhotoViewer({
  open,
  src,
  name,
  subtitle,
  onEdit,
  onClose,
}: PhotoViewerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Restore whatever was there — another dialog's lock may own the value.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open || !src) return null;

  return (
    <ModalPortal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${name} photo`}
        className="fixed inset-0 z-[1200] flex flex-col bg-[#1e1e1e] animate-in fade-in duration-150"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-body text-sm font-semibold text-white">{name}</p>
            {subtitle ? (
              <p className="font-body text-[11px] text-white/55">{subtitle}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onEdit ? (
              <button
                type="button"
                onClick={onEdit}
                className="flex h-9 items-center gap-1.5 rounded-full px-3 text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                aria-label="Change photo"
              >
                <Camera strokeWidth={2.5} size={15} />
                <span className="font-body text-xs font-medium">Change photo</span>
              </button>
            ) : null}
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              aria-label="Close photo"
              title="Close"
            >
              <X strokeWidth={2.5} size={18} />
            </button>
          </div>
        </div>

        {/* Clicking the canvas (never the photo itself) is the way out. */}
        <div
          className="relative flex min-h-0 flex-1 items-center justify-center p-4 sm:p-8"
          onClick={onClose}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={`${name} photo`}
            className="h-full w-full select-none object-contain drop-shadow-2xl"
            draggable={false}
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      </div>
    </ModalPortal>
  );
}
