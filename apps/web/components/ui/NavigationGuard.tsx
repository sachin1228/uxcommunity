"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { installLinkClickGuard, settleNavigation } from "@/lib/navigation-guard";

/**
 * Mount once (in the root layout) to:
 *   - protect every internal `<Link>` from rapid repeated clicks producing
 *     duplicate route transitions, and
 *   - observe the current route so a pending navigation lock is released the
 *     moment the navigation actually settles.
 */
export function NavigationGuard() {
  const pathname = usePathname();

  useEffect(() => {
    const cleanup = installLinkClickGuard();
    return cleanup;
  }, []);

  useEffect(() => {
    settleNavigation(pathname);
  }, [pathname]);

  return null;
}