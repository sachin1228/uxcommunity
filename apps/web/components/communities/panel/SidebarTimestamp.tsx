"use client";

import { useEffect, useState } from "react";
import { formatSidebarTime } from "@/lib/communities/sidebar-time";

export function SidebarTimestamp({ iso }: { iso: string }) {
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
      className="ml-auto shrink-0 whitespace-nowrap font-body text-[11px] tabular-nums text-foreground-muted"
    >
      {timestamp.label}
    </time>
  );
}
