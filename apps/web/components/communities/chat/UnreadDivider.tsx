"use client";

import { forwardRef } from "react";

interface UnreadDividerProps {
  count: number;
}

export const UnreadDivider = forwardRef<HTMLDivElement, UnreadDividerProps>(
  function UnreadDivider({ count }, ref) {
    return (
      <div ref={ref} className="flex items-center gap-3 py-3 my-3 w-full">
        <div className="flex-1 border-t border-border" />
        <span
          className="
            rounded-full
            border border-border
            bg-surface-raised
            px-3 py-1
            font-body text-[11px] font-medium
            text-foreground-muted
            whitespace-nowrap
            shadow-sm
            select-none
          "
        >
          {count > 0
            ? `${count} unread message${count !== 1 ? "s" : ""}`
            : "New messages"}
        </span>
        <div className="flex-1 border-t border-border" />
      </div>
    );
  }
);
