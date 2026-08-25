"use client";

import { useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
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

/**
 * Reusable destructive-action confirmation modal. Replaces the browser's
 * native `confirm()` — Escape, backdrop click and the Cancel button all
 * dismiss it; the confirm button shows a spinner while the action runs.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Delete",
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={pending ? () => undefined : onClose}
      title={title}
      maxWidth="max-w-sm"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-500">
          <AlertTriangle size={18} />
        </div>
        <p className="font-body text-sm leading-6 text-foreground-muted">{message}</p>
      </div>
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="flex-1 rounded-lg border border-border py-2.5 font-body text-sm font-medium text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleConfirm()}
          disabled={pending}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 py-2.5 font-body text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
        >
          {pending ? <Spinner size={15} className="text-white" /> : <Trash2 size={14} />}
          {pending ? "Deleting…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
