"use client";

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/shadcn/alert-dialog";
import { Button } from "@/components/ui/shadcn/button";
import { Spinner } from "@/components/ui/Spinner";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: React.ReactNode;
  /** Label for the confirm button. Defaults to "Delete". */
  confirmLabel?: string;
}

/** Keeps the confirmation open until the asynchronous action succeeds. */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = "Delete" }: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const previousFocus = useRef<HTMLElement | null>(null);

  async function handleConfirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch {
      setError("The action could not be completed. Please try again.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !inFlight.current) onClose(); }}>
      <AlertDialogContent
        className="w-[calc(100%-2rem)] max-w-sm rounded-lg"
        onOpenAutoFocus={() => { setError(null); previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={(event) => { if (previousFocus.current?.isConnected) { event.preventDefault(); previousFocus.current.focus(); } }}
        onEscapeKeyDown={(event) => { if (inFlight.current) event.preventDefault(); }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild><div>{message}</div></AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button type="button" variant="destructive" onClick={() => void handleConfirm()} disabled={pending} aria-busy={pending}>
            {pending ? <Spinner size={14} /> : <Trash2 data-icon="inline-start" />}
            {pending ? "Working…" : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
