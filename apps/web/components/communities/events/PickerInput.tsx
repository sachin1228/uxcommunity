"use client";

import type { ComponentProps } from "react";
import { CalendarDays, Timer } from "lucide-react";

/**
 * A native date/time field whose whole surface opens the browser's picker.
 *
 * The browser's own indicator is hidden by `.picker-input` (see globals.css)
 * and redrawn here in the app's icon style, so the field reads the same in
 * every browser and a click anywhere in the box — not just the tiny glyph at
 * its edge — opens the calendar/clock dropdown. `showPicker` is guarded:
 * where it is missing, or the field is disabled, the normal focus-and-type
 * behaviour is left untouched.
 */
export function PickerInput({
  type,
  className,
  onClick,
  ...props
}: ComponentProps<"input"> & { type: "date" | "time" }) {
  const Icon = type === "date" ? CalendarDays : Timer;

  return (
    <div className="relative">
      <input
        {...props}
        type={type}
        onClick={(event) => {
          onClick?.(event);
          const input = event.currentTarget;
          if (input.disabled) return;
          try {
            input.showPicker();
          } catch {
            // The browser refused (no user activation, or no picker here) —
            // the field still takes a typed value.
          }
        }}
        className={`picker-input field w-full cursor-pointer pr-9 ${className ?? ""}`}
      />
      <Icon
        aria-hidden="true"
        strokeWidth={2}
        size={14}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-foreground-subtle"
      />
    </div>
  );
}
