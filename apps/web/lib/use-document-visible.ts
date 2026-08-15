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
 * Realtime hooks depend on this so they can tear their channels down when the
 * tab is hidden. A background tab still holds a Supabase Realtime websocket
 * connection and keeps consuming postgres_changes events for zero user value —
 * on the free tier that wastes one of the 200 concurrent connections and burns
 * the 2M message/month quota. Suspending channels while hidden frees both.
 */
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}