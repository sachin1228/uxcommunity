"use client";

import { useEffect } from "react";

/**
 * The dashboard is an app shell: its main pane is the only scroller. Locking
 * the document prevents the page from rubber-banding the topbar and sidebar
 * away when a long page (e.g. verification) reaches its end.
 */
export function AppBodyScrollLock() {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previous = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      htmlOverscroll: html.style.overscrollBehavior,
      bodyOverscroll: body.style.overscrollBehavior,
    };

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overscrollBehavior = "none";

    return () => {
      html.style.overflow = previous.htmlOverflow;
      body.style.overflow = previous.bodyOverflow;
      html.style.overscrollBehavior = previous.htmlOverscroll;
      body.style.overscrollBehavior = previous.bodyOverscroll;
    };
  }, []);

  return null;
}
