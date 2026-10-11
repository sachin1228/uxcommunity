"use client";

import { useEffect, useState } from "react";
import { formatSidebarTime } from "@/lib/communities/sidebar-time";

/**
 * The row's timestamp. `highlight` is set while the row carries unread
 * activity, which prints the time in the app's blue — the same "something new
 * here" the messenger this row imitates says in green. The pair of tokens is
 * the one the rest of the app uses to write blue on either theme (the
 * light-mode blue, then the lighter one for dark panels), so an 11px stamp
 * stays readable on the near-black sidebar.
 */
export function SidebarTimestamp({ iso, highlight }: { iso: string; highlight?: boolean }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const current = new Date();
      setNow(current);
      const midnight = new Date(current);
      midnight.setHours(24, 0, 0, 0);
      timer = setTimeout(refresh, midnight.getTime() - current.getTime() + 100);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  // Format after hydration so dates always reflect the viewer's local timezone.
  const timestamp = now ? formatSidebarTime(iso, now) : null;
  if (!timestamp) return null;

  return (
    <time
      dateTime={timestamp.dateTime}
      title={timestamp.full}
      aria-label={`Last message: ${timestamp.full}`}
      className={`ml-auto shrink-0 whitespace-nowrap font-body text-[11px] tabular-nums ${
        highlight
          ? "text-[var(--ds-blue-800)] dark:text-[var(--ds-blue-900)]"
          : "text-foreground-muted"
      }`}
    >
      {timestamp.label}
    </time>
  );
}
