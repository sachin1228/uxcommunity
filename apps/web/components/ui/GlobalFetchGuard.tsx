"use client";

import { useEffect } from "react";
import { installGlobalFetchGuard } from "@/lib/global-fetch";

/**
 * Mount once (in the root layout) to route every same-origin `/api/*` fetch
 * through the global dedupe layer. The module also self-installs at import
 * time, so this is a safety net that also restores the original fetch on
 * unmount (dev/HMR only).
 */
export function GlobalFetchGuard() {
  useEffect(() => {
    return installGlobalFetchGuard();
  }, []);
  return null;
}