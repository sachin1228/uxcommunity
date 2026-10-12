"use client";

import { usePathname } from "next/navigation";

/**
 * Routes that run their own full-width shell. The DM window is a chat app:
 * the workspace sidebar — and its narrow-viewport drawer trigger — drop away
 * so the conversation list and thread take the whole width.
 */
const CHROMELESS_PATHS = ["/dashboard/messages"];

/**
 * Hides dashboard navigation chrome on routes that own their whole surface.
 * A client gate rather than a route-group layout: the sidebar lives in the
 * one dashboard layout every route shares, and only its visibility changes
 * here.
 */
export function SidebarRouteGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (CHROMELESS_PATHS.includes(pathname)) return null;
  return <>{children}</>;
}
