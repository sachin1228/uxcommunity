"use client";

import { useEffect, useCallback } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Max width class, default "max-w-lg" */
  maxWidth?: string;
  /** Set true when the caller renders its own close button inside children */
  hideCloseButton?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = "max-w-lg",
  hideCloseButton = false,
}: ModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className={`relative z-10 w-full ${maxWidth} rounded-xl border border-border bg-surface p-8 shadow-xl max-h-[calc(100vh-2rem)] overflow-y-auto`}
      >
        {title && (
          <div className="mb-6 flex items-start justify-between gap-4">
            <h2 className="font-display text-xl font-semibold text-foreground">
              {title}
            </h2>
            {!hideCloseButton && (
              <button
                onClick={onClose}
                className="flex-shrink-0 text-foreground-muted hover:text-foreground transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}
        {!title && !hideCloseButton && (
          <button
            onClick={onClose}
            className="absolute right-4 top-4 text-foreground-muted hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
