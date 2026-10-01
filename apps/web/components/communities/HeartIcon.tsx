"use client";

import { useEffect, useRef } from "react";
import { HeartFilled, HeartRegular } from "@fluentui/react-icons";

/**
 * Shared heart icon used by like buttons across community cards
 * (threads, resources, events, showcase) and the thread image lightbox.
 *
 * Backed by the Fluent 2 heart: outline when idle, filled when liked.
 * Callers color it with a `text-*` class (the liked pink is
 * `text-[var(--like)]`) and size it with `size`.
 *
 * `active` marks the liked state:
 *  - When it flips false → true (user taps like) the heart plays a quick
 *    pop — via the Web Animations API so it never fights the Tailwind
 *    hover scale, and never fires on initial mount.
 */
export function HeartIcon({
  size = 26,
  className,
  active = false,
}: {
  size?: number;
  className?: string;
  /** Liked state; a false → true transition triggers the pop animation. */
  active?: boolean;
}) {
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const wasActive = useRef(active);

  useEffect(() => {
    const el = wrapperRef.current;
    if (active && !wasActive.current && el && typeof el.animate === "function") {
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        el.animate(
          [
            { transform: "scale(1)", easing: "cubic-bezier(0.3, 1.2, 0.5, 1)" },
            { transform: "scale(1.32)", easing: "ease-in-out" },
            { transform: "scale(0.94)", easing: "ease-out" },
            { transform: "scale(1)" },
          ],
          { duration: 420 },
        );
      }
    }
    wasActive.current = active;
  }, [active]);

  return (
    <span
      ref={wrapperRef}
      aria-hidden="true"
      style={{ display: "inline-flex" }}
      className={className}
    >
      {active ? <HeartFilled fontSize={size} /> : <HeartRegular fontSize={size} />}
    </span>
  );
}
