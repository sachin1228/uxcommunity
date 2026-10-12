"use client";

import { createPortal } from "react-dom";
import { useEffect, useCallback, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";

/**
 * The open dialogs, oldest first.
 *
 * Nested dialogs are a real case — the community preview's Join action opens
 * the join dialog on top of it — so two things have to be shared between the
 * instances rather than owned by each: Escape closes only the topmost layer,
 * and the page keeps its scroll lock until the last one unmounts. A
 * module-level stack is what lets one modal know whether it is the top.
 */
const openModals: symbol[] = [];
let scrollLocked = false;

function lockBodyScroll() {
  if (scrollLocked || typeof document === "undefined") return;
  scrollLocked = true;
  document.body.style.overflow = "hidden";
}

function unlockBodyScroll() {
  if (!scrollLocked || typeof document === "undefined") return;
  scrollLocked = false;
  document.body.style.overflow = "";
}

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

interface ModalPortalProps {
  children: React.ReactNode;
}

export function ModalPortal({ children }: ModalPortalProps) {
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  if (!mounted) return null;
  return createPortal(children, document.body);
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
  // Stable identity for the whole life of this instance, used to order it in
  // `openModals` and to tell whether it is the dialog currently on top.
  const [modalId] = useState(() => Symbol("modal"));

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Only the topmost open dialog reacts, so Escape peels one layer at a time.
      if (openModals[openModals.length - 1] !== modalId) return;
      onClose();
    },
    [modalId, onClose]
  );

  useEffect(() => {
    if (!open) return;
    openModals.push(modalId);
    lockBodyScroll();
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      const index = openModals.lastIndexOf(modalId);
      if (index !== -1) openModals.splice(index, 1);
      if (openModals.length === 0) unlockBodyScroll();
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, modalId, handleKeyDown]);

  if (!open) return null;

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
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
        className={`relative z-10 w-full ${maxWidth} modal-panel max-h-[min(800px,calc(100vh-2rem))] overflow-y-auto ${panelClassName ?? "p-6"}`}
      >
        {title && (
          <div className="mb-6 flex items-start justify-between gap-4">
            <h2 className="font-display text-xl font-semibold tracking-[-0.01em] text-foreground">
              {title}
            </h2>
            {!hideCloseButton && (
              <button
                onClick={onClose}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                aria-label="Close"
              >
                <X strokeWidth={2.5} size={16} />
              </button>
            )}
          </div>
        )}
        {!title && !hideCloseButton && (
          <button
            onClick={onClose}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
            aria-label="Close"
          >
            <X strokeWidth={2.5} size={16} />
          </button>
        )}
        {children}
      </div>
    </div>
    </ModalPortal>
  );
}
