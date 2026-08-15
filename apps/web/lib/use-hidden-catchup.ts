"use client";

import { useEffect, useRef } from "react";

/**
 * How long the tab must have been hidden before a regain triggers a catch-up.
 * Short alt-tab gaps (sub-second to a few seconds) are common during normal
 * browsing and shouldn't each fire a request — only a real absence means
 * events were likely missed while the realtime socket was suspended.
 */
const DEFAULT_HIDDEN_THRESHOLD_MS = 5_000;

/**
 * Fires `onReturn` when the tab becomes visible/focused again after being
 * hidden for at least `thresholdMs`.
 *
 * Realtime channels are suspended while the tab is hidden (see
 * useDocumentVisible) and the Cloudflare rooms don't replay missed events on
 * reconnect, so components need a refetch to catch up after an absence. This
 * hook throttles that to genuine away periods instead of firing a request on
 * every focus event, collapsing rapid alt-tab storms into nothing.
 */
export function useHiddenCatchUp(
  onReturn: () => void,
  thresholdMs: number = DEFAULT_HIDDEN_THRESHOLD_MS,
): void {
  const onReturnRef = useRef(onReturn);
  const hiddenAtRef = useRef<number | null>(null);

  // Keep the ref in sync after render (writing refs during render is
  // disallowed by react-hooks/refs).
  useEffect(() => {
    onReturnRef.current = onReturn;
  });

  useEffect(() => {
    const check = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        return;
      }
      const hiddenFor =
        hiddenAtRef.current === null ? 0 : Date.now() - hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (hiddenFor >= thresholdMs) onReturnRef.current();
    };

    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [thresholdMs]);
}
