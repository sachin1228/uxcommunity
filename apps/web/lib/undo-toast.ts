/**
 * A single transient "you can undo that" offer, shown by the app shell.
 *
 * Some actions undo themselves badly: withdrawing an RSVP also takes the member
 * out of the event's group chat and off their sidebar, which is a handful of
 * taps to rebuild by hand. Those actions offer one-tap undo while the decision
 * is still fresh.
 *
 * The toast is owned by the dashboard shell (`UndoToast`), but it is raised
 * from wherever the action happened, so this is a module-level store rather
 * than a context or a prop — the same shape as create-community-dialog. The
 * countdown lives in the component, not here, which keeps this file pure state
 * (and testable without a clock).
 */

export interface UndoToastRequest {
  message: string;
  /** Label for the action button. Defaults to "Undo". */
  actionLabel?: string;
  /** How long the offer stays up. Defaults to UNDO_TOAST_MS. */
  durationMs?: number;
  /** What taking the offer does. A rejected promise keeps the toast up. */
  onAction: () => void | Promise<void>;
}

export interface UndoToastState {
  /** Distinguishes this offer from whatever it replaced (see dismiss). */
  id: number;
  message: string;
  actionLabel: string;
  durationMs: number;
  onAction: () => void | Promise<void>;
}

/** Long enough to notice and decide, short enough to still be an "after" message. */
export const UNDO_TOAST_MS = 6000;

const DEFAULT_ACTION_LABEL = "Undo";

let current: UndoToastState | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/**
 * Put an undo offer on screen, replacing whatever was there. Returns its id,
 * which the caller's own countdown should pass back to `dismissUndoToast`.
 */
export function showUndoToast(request: UndoToastRequest): number {
  const toast: UndoToastState = {
    id: nextId++,
    message: request.message,
    actionLabel: request.actionLabel ?? DEFAULT_ACTION_LABEL,
    durationMs: request.durationMs ?? UNDO_TOAST_MS,
    onAction: request.onAction,
  };
  current = toast;
  emit();
  return toast.id;
}

/**
 * Take the offer off screen.
 *
 * With an id, only if that exact toast is still the one showing: a toast's own
 * countdown must never dismiss a newer offer that replaced it (or the member
 * would lose an undo they never got to read).
 */
export function dismissUndoToast(id?: number): void {
  if (!current) return;
  if (id !== undefined && current.id !== id) return;
  current = null;
  emit();
}

/** The offer on screen, or null — the snapshot `useSyncExternalStore` reads. */
export function getUndoToast(): UndoToastState | null {
  return current;
}

export function subscribeUndoToast(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
