"use client";

import { useEffect } from "react";

/**
 * The dashboard is an app shell: its main pane is the only scroller. Locking
 * the document prevents the page from rubber-banding the topbar and sidebar
 * away when a long page (e.g. verification) reaches its end.
 */
export function AppBodyScrollLock() {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return null;
}
