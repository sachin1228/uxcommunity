"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { afterDashboardPaint, FEED_READY_EVENT, markDashboardPaint } from "@/lib/login-performance";

const SecondaryReady = createContext(true);

export function DashboardStartup({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const cancelPaint = afterDashboardPaint(() => {
      markDashboardPaint("shell");
      if (pathname !== "/dashboard" || performance.getEntriesByName("dashboard-feed-ready").length) setReady(true);
    });
    const release = () => setReady(true);
    window.addEventListener(FEED_READY_EVENT, release);
    // Failed/slow feeds must not prevent navigation and notifications forever.
    const fallback = window.setTimeout(release, 3_000);
    return () => {
      cancelPaint();
      window.clearTimeout(fallback);
      window.removeEventListener(FEED_READY_EVENT, release);
    };
  }, [pathname]);
  return <SecondaryReady.Provider value={ready}>{children}</SecondaryReady.Provider>;
}

export function useDashboardSecondaryReady() { return useContext(SecondaryReady); }

export function DeferredDashboard({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  return useDashboardSecondaryReady() ? children : fallback;
}
