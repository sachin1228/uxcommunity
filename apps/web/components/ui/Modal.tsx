"use client";

import { createPortal } from "react-dom";
import { useRef, useSyncExternalStore } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/shadcn/dialog";
import { cn } from "@/lib/utils";

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

export function Modal({ open, onClose, title, children, maxWidth = "max-w-lg", hideCloseButton = false, panelClassName }: ModalProps) {
  const previousFocus = useRef<HTMLElement | null>(null);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent
        aria-describedby={undefined}
        showCloseButton={!hideCloseButton}
        className={cn("flex w-[calc(100%-2rem)] max-h-[min(800px,calc(100dvh-2rem))] flex-col overflow-y-auto rounded-lg", maxWidth, panelClassName)}
        onOpenAutoFocus={() => { previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={(event) => {
          if (previousFocus.current?.isConnected) {
            event.preventDefault();
            previousFocus.current.focus();
          }
        }}
      >
        <DialogHeader className={title ? "pr-8" : "sr-only"}>
          <DialogTitle>{title ?? "Dialog"}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
