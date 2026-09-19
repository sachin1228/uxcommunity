"use client";

import { useEffect, useState } from "react";
import { countdownParts, formatCountdown } from "@/lib/competitions/cycle";
import { useDocumentVisible } from "@/lib/use-document-visible";

interface Props {
  /** ISO timestamp the countdown runs to. */
  target: string;
  /** "left to submit", "starts in", … */
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * The week's heartbeat: 3D 08H 42M LEFT.
 *
 * Rendered on the server at its first value (so the page never flashes empty),
 * then ticked by the client. The interval pauses while the tab is hidden: a
 * background tab does not need to re-render every second, and the countdown is
 * recomputed from the absolute target on the next tick, so it can never drift.
 */
export function Countdown({ target, label, size = "md", className = "" }: Props) {
  const isVisible = useDocumentVisible();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!isVisible) return;
    // The first tick lands within a second, which is close enough that a
    // hidden tab returning to view never shows a stale countdown for long.
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [isVisible]);

  const parts = countdownParts(target, now);
  const valueSize =
    size === "lg" ? "text-3xl sm:text-4xl" : size === "sm" ? "text-sm" : "text-xl sm:text-2xl";

  if (parts.elapsed) {
    return (
      <p className={`font-mono font-semibold tabular-nums text-foreground-subtle ${valueSize} ${className}`}>
        Closed
      </p>
    );
  }

  return (
    <p className={`flex flex-wrap items-baseline gap-x-2 ${className}`}>
      {/* A clock is legitimately different on the server and on the client
          (milliseconds apart, and the tab may have been open for a while), so
          the value is allowed to differ at hydration and then tick. */}
      <span
        suppressHydrationWarning
        className={`font-mono font-semibold tabular-nums tracking-tight text-foreground ${valueSize}`}
      >
        {formatCountdown(target, now)}
      </span>
      {label && (
        <span className="font-body text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
          {label}
        </span>
      )}
      <span className="sr-only">
        {parts.days} days, {parts.hours} hours, {parts.minutes} minutes remaining
      </span>
    </p>
  );
}
