"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Undo2, X } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import {
  dismissUndoToast,
  getUndoToast,
  subscribeUndoToast,
  type UndoToastState,
} from "@/lib/undo-toast";

/**
 * The one undo offer (see lib/undo-toast), rendered once by the dashboard
 * shell so it outlives whatever card raised it — the member may have already
 * scrolled it away or navigated when they decide to take it back.
 *
 * Mounted below the modals (z-900 against the modal's z-1000) and above the
 * page, so confirming a dialog can raise an offer without hiding behind it.
 */
export function UndoToast() {
  const toast = useSyncExternalStore(subscribeUndoToast, getUndoToast, () => null);
  // Keyed by id: a replacement offer restarts the countdown from scratch
  // instead of inheriting the time its predecessor had left.
  return toast ? <UndoToastBody key={toast.id} toast={toast} /> : null;
}

function UndoToastBody({ toast }: { toast: UndoToastState }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The countdown starts when this offer appears. It is paused while the undo
  // is in flight — the toast must not vanish out from under the request — and
  // restarts if that request fails and leaves the offer up.
  useEffect(() => {
    if (pending) return;
    const timer = window.setTimeout(() => dismissUndoToast(toast.id), toast.durationMs);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.durationMs, pending]);

  async function handleUndo() {
    setPending(true);
    setError(null);
    try {
      await toast.onAction();
      dismissUndoToast(toast.id);
    } catch {
      // Leave the offer up rather than pretend the undo landed.
      setError("Couldn't undo that. Try again.");
      setPending(false);
    }
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[900] flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3 shadow-lg"
      >
        <div className="min-w-0 flex-1">
          <p className="text-pretty font-body text-sm text-foreground">{toast.message}</p>
          {error && <p className="mt-0.5 font-body text-xs text-red-400">{error}</p>}
        </div>

        <button
          type="button"
          onClick={() => void handleUndo()}
          disabled={pending}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 font-body text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-60"
        >
          {pending ? (
            <Spinner size={13} />
          ) : (
            <Undo2 strokeWidth={2.5} size={14} aria-hidden="true" />
          )}
          {toast.actionLabel}
        </button>

        <button
          type="button"
          onClick={() => dismissUndoToast(toast.id)}
          disabled={pending}
          aria-label="Dismiss"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-background-subtle hover:text-foreground disabled:opacity-60"
        >
          <X strokeWidth={2.5} size={15} />
        </button>
      </div>
    </div>
  );
}
