"use client";

import { useEffect } from "react";
import { installLinkClickGuard } from "@/lib/navigation-guard";

/**
 * Mount once (in the root layout) to protect every internal `<Link>` from
 * rapid repeated clicks producing duplicate route transitions.
 */
export function NavigationGuard() {
  useEffect(() => {
    const cleanup = installLinkClickGuard();
    return cleanup;
  }, []);
  return null;
}
