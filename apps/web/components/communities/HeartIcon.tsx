"use client";

import { useEffect, useRef } from "react";

/**
 * Shared heart icon used by like buttons across community cards
 * (threads, resources, events, showcase) and the thread image lightbox.
 *
 * Drop-in replacement for the lucide `Heart` in those like buttons:
 * accepts `size`, `strokeWidth`, `fill` and `className` with the same
 * semantics, so call-site styling (fill classes, scale hover, etc.) keeps
 * working unchanged.
 *
 * `active` marks the liked state:
 *  - When it flips false → true (user taps like) the heart plays a quick
 *    pop — via the Web Animations API so it never fights the Tailwind
 *    hover scale, and never fires on initial mount.
 *  - The liked heart is filled with the design system's Geist blue
 *    (--ds-blue-700, theme-aware). It's applied via inline style because
 *    `var()` is not valid inside SVG presentation attributes.
 */
export function HeartIcon({
  size = 24,
  strokeWidth = 1.5,
  fill = "none",
  className,
  active = false,
}: {
  size?: number;
  strokeWidth?: number;
  fill?: string;
  className?: string;
  /** Liked state; a false → true transition triggers the pop animation. */
  active?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const wasActive = useRef(active);

  useEffect(() => {
    const svg = svgRef.current;
    if (active && !wasActive.current && svg && typeof svg.animate === "function") {
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        svg.animate(
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
    <svg
      ref={svgRef}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill={fill}
      className={className}
      aria-hidden="true"
      style={active ? { display: "block", fill: "var(--ds-blue-700)" } : { display: "block" }}
    >
      <path
        d="M 4.706 1.75 C 6.455 1.75 7.681 2.984 8 4.645 C 8.319 2.984 9.545 1.75 11.294 1.75 C 13.341 1.75 15 3.44 15 5.524 C 15 11.802 8 14.75 8 14.75 L 8 14.75 L 8 14.75 C 8 14.75 1 11.802 1 5.524 C 1 3.44 2.659 1.75 4.706 1.75 Z"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
