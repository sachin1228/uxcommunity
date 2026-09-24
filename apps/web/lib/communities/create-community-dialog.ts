"use client";

/**
 * Open/closed state for the Create Community dialog.
 *
 * The dialog is owned by the app shell (`GlobalSidebar`), but it is opened from
 * more than one place — the sidebar's "+" and the homepage rail's create card.
 * A tiny external store keeps those triggers from each mounting their own copy
 * of the modal (and from drift between two copies), and lets any surface open it
 * without threading a prop or a context through the dashboard tree.
 */

let open = false;

const listeners = new Set<() => void>();

function setOpen(next: boolean) {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
}

/** Open the dialog from anywhere. */
export function openCreateCommunityDialog(): void {
  setOpen(true);
}

export function closeCreateCommunityDialog(): void {
  setOpen(false);
}

/** True while the dialog is open — the snapshot `useSyncExternalStore` reads. */
export function isCreateCommunityDialogOpen(): boolean {
  return open;
}

export function subscribeCreateCommunityDialog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
