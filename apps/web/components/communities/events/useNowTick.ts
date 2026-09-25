"use client";

import { useEffect, useState } from "react";

/**
 * A clock the form can read while it stays open.
 *
 * The "starts in 42 minutes" hint is only worth showing if it keeps counting —
 * a value captured at mount would still claim 42 minutes an hour later. The
 * tick re-renders the caller on an interval; it stops with the component, so
 * it costs nothing outside an open modal.
 */
export function useNowTick(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
