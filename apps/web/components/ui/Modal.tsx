"use client";

import { useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/shadcn/dialog";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  titleHidden?: boolean;
  onOpenAutoFocus?: (event: Event) => void;
  children: React.ReactNode;
  /** Max width class, default "max-w-lg" */
  maxWidth?: string;
  /** Set true when the caller renders its own close button inside children */
  hideCloseButton?: boolean;
  /** Extra classes applied to the panel div (e.g. "p-0" to remove default padding) */
  panelClassName?: string;
}

export function Modal({ open, onClose, title, titleHidden = false, onOpenAutoFocus, children, maxWidth = "max-w-lg", hideCloseButton = false, panelClassName }: ModalProps) {
  const previousFocus = useRef<HTMLElement | null>(null);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent
        aria-describedby={undefined}
        showCloseButton={!hideCloseButton}
        className={cn("flex w-[calc(100%-2rem)] max-h-[min(800px,calc(100dvh-2rem))] flex-col overflow-y-auto rounded-lg", maxWidth, panelClassName)}
        onOpenAutoFocus={(event) => { previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; onOpenAutoFocus?.(event); }}
        onCloseAutoFocus={(event) => {
          if (previousFocus.current?.isConnected) {
            event.preventDefault();
            previousFocus.current.focus();
          }
        }}
      >
        <DialogHeader className={title && !titleHidden ? "pr-8" : "sr-only"}>
          <DialogTitle>{title ?? "Dialog"}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
