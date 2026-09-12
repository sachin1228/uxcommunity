"use client";

/**
 * Dismissal state for the sidebar beta notice, persisted per member in
 * localStorage.
 *
 * Exposed through `useSyncExternalStore` because the server cannot know about
 * localStorage: the server snapshot shows the notice and the client swaps in
 * the stored choice right after hydration, so reading the flag never causes a
 * hydration mismatch (and never needs a setState inside an effect).
 */

const STORAGE_PREFIX = "uxcommunity:beta-whatsapp-notice-dismissed";

const listeners = new Set<() => void>();

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

/** True when this member dismissed the notice on this browser. */
export function isBetaNoticeDismissed(userId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(storageKey(userId)) === "1";
  } catch {
    // Storage unavailable (private mode) — treat as not dismissed.
    return false;
  }
}

/** Hide the notice for good, then re-render every subscribed surface. */
export function dismissBetaNotice(userId: string): void {
  try {
    window.localStorage.setItem(storageKey(userId), "1");
  } catch {
    // Storage unavailable — hide it for this session anyway.
  }
  for (const listener of listeners) listener();
}

/**
 * Subscribe to dismissal changes. A `storage` listener keeps other tabs of the
 * same browser in sync when the notice is dismissed somewhere else.
 */
export function subscribeBetaNotice(listener: () => void): () => void {
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(STORAGE_PREFIX)) listener();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
