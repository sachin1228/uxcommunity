"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  window.addEventListener("focus", onChange);
  return () => {
    document.removeEventListener("visibilitychange", onChange);
    window.removeEventListener("focus", onChange);
  };
}

function getSnapshot() {
  return document.visibilityState === "visible";
}

/**
 * Tracks whether the browser tab is visible and focused.
 *
 * Realtime hooks depend on this so they can tear their room subscriptions down
 * when the tab is hidden. A background tab otherwise keeps its WebSocket to the
 * Cloudflare Durable Object open, consuming broadcasts and Durable Object time
 * for zero user value. Dropping the subscriptions while hidden frees both, and
 * the catch-up hooks refetch what was missed on return.
 */
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}