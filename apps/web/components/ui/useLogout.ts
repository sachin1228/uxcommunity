"use client";

import { useCallback, useState } from "react";

/**
 * Logout flow shared by every "Sign out" button in the app.
 *
 * Shows the full-screen "Logging out" state (see BrandedLoadingScreen), posts
 * to /api/auth/logout, drops every module-level cache that holds the current
 * member's data, then leaves for /login with a full document navigation.
 *
 * The navigation is deliberately NOT `router.replace`: Next's client Router
 * Cache is keyed by URL (pathname + search) and never sees the session cookie,
 * so a client-side navigation is served the previous session's server-rendered
 * payload. A full document load is the only navigation that is guaranteed to
 * render the page for the cookie the browser now holds. The same applies to the
 * login page — see the hard navigation there.
 *
 * If the request fails the overlay is dismissed and the user stays on the page.
 */
export function useLogout() {
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      const { resetClientSessionCaches } = await import("@/lib/session-cache");
      resetClientSessionCaches();
      window.location.replace("/login");
    } catch {
      // Stay on the page if the request fails — don't trap the user behind
      // the overlay.
      setLoggingOut(false);
    }
  }, []);

  return { loggingOut, handleLogout };
}
