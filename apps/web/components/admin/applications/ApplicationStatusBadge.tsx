"use client";

import { STATUS_COLORS } from "./types";

export function ApplicationStatusBadge({ status }: { status: string }) {
  const cls =
    STATUS_COLORS[status as keyof typeof STATUS_COLORS] ??
    "bg-surface-raised text-foreground-muted";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 font-mono text-[10px] font-medium capitalize ${cls}`}
    >
      {status}
    </span>
  );
}
