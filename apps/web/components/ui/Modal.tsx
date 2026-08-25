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
  /** Extra classes applied to the panel div (e.g. "p-0" to remove default padding) */
  panelClassName?: string;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = "max-w-lg",
  hideCloseButton = false,
  panelClassName,
}: ModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
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
        className="absolute inset-0 bg-overlay/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className={`linear-modal relative z-10 max-h-[calc(100vh-2rem)] w-full overflow-y-auto ${maxWidth} ${panelClassName ?? ""}`}
      >
        {title && (
          <div className="linear-modal-header justify-between">
            <h2 className="font-display text-sm font-semibold text-foreground">
              {title}
            </h2>
            {!hideCloseButton && (
              <button
                type="button"
                onClick={onClose}
                className="linear-icon-button shrink-0"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            )}
          </div>
        )}
        {!title && !hideCloseButton && (
          <button
            type="button"
            onClick={onClose}
            className="linear-icon-button absolute right-3 top-3"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        )}
        <div className={panelClassName ? undefined : "linear-modal-body"}>
          {children}
        </div>
      </div>
    </div>
  );
}
