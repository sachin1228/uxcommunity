"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/ui/BrandLogo";

/** Number of dots in the "Logging out" ring loader. */
const DOT_COUNT = 12;
/** Milliseconds for one full pulse cycle around the ring. */
const CYCLE_MS = 1100;
/** Distance of each dot from the ring's center, in px. */
const RING_RADIUS = 16;
/** Dot diameter, in px. */
const DOT_SIZE = 5;

/**
 * Full-screen "Logging out" state, Vercel-style: the brand mark in the
 * top-left corner, a ring of pulsing dots, and the "Logging out" label.
 * Rendered while the logout request is in flight so the user always gets
 * clear feedback regardless of how slow the network is.
 */
export function LoggingOutScreen() {
  return (
    <div className="fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-[#0A0A0A]">
      <BrandLogo
        className="absolute left-6 top-6"
        iconClassName="h-8 w-8"
        wordmarkClassName="hidden"
      />

      <div className="relative h-10 w-10" role="status" aria-label="Logging out">
        {Array.from({ length: DOT_COUNT }).map((_, i) => (
          <span
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              left: "50%",
              top: "50%",
              width: DOT_SIZE,
              height: DOT_SIZE,
              marginLeft: -DOT_SIZE / 2,
              marginTop: -DOT_SIZE / 2,
              transform: `rotate(${(i * 360) / DOT_COUNT}deg) translateY(-${RING_RADIUS}px)`,
              animation: `logging-dot ${CYCLE_MS}ms ease-in-out ${(i * CYCLE_MS) / DOT_COUNT}ms infinite`,
            }}
          />
        ))}
      </div>

      <p className="mt-5 font-display text-sm font-semibold text-white">
        Logging out
      </p>
    </div>
  );
}

/**
 * Logout flow shared by every "Sign out" button in the app.
 *
 * Shows the full-screen "Logging out" state, posts to /api/auth/logout,
 * clears module-level caches so the next user on this tab never sees the
 * previous user's data, then redirects to /login. If the request fails the
 * overlay is dismissed and the user stays on the page.
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