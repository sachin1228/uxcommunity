"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Logout flow shared by every "Sign out" button in the app.
 *
 * Shows the full-screen "Logging out" state (see BrandedLoadingScreen),
 * posts to /api/auth/logout, clears module-level caches so the next user on
 * this tab never sees the previous user's data, then redirects to /login.
 * If the request fails the overlay is dismissed and the user stays on the
 * page.
 */
export function useLogout() {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      // Clear all module-level caches so the next user who logs in on this
      // tab never sees data belonging to the current user.
      const { clearAllUserCaches } = await import("@/lib/communities/cache");
      clearAllUserCaches();
      router.replace("/login");
    } catch {
      // Stay on the page if the request fails — don't trap the user behind
      // the overlay.
      setLoggingOut(false);
    }
  }, [router]);

  return { loggingOut, handleLogout };
}