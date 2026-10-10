"use client";

import { useEffect, useRef, useState } from "react";
import {
  Calendar,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  Check,
  Layers,
  MapPin,
  SlidersHorizontal,
  Video,
} from "lucide-react";
import {
  EVENT_DATE_OPTIONS,
  EVENT_TYPE_OPTIONS,
  type EventDateFilter,
  type EventTypeFilter,
} from "./event-filters";

const TYPE_ICONS: Record<EventTypeFilter, typeof Layers> = {
  all: Layers,
  online: Video,
  "in-person": MapPin,
};

const DATE_ICONS: Record<EventDateFilter, typeof CalendarDays> = {
  any: CalendarDays,
  today: CalendarCheck,
  week: CalendarRange,
  month: Calendar,
};

interface EventFiltersMenuProps {
  type: EventTypeFilter;
  date: EventDateFilter;
  /** True while any filter is set — tints the trigger so a narrowed list is never a mystery. */
  active: boolean;
  onSelect: (type: EventTypeFilter, date: EventDateFilter) => void;
}

/**
 * The Events page's filter dropdown — a bordered button opening one panel
 * with the two filter groups (same trigger/panel/outside-click shape as the
 * event options menu; the rows carry the check of the option in force).
 * Picking a row applies it and leaves the panel open, since the two groups
 * are normally set together; outside click or Escape closes it.
 */
export function EventFiltersMenu({ type, date, active, onSelect }: EventFiltersMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  function renderGroup(
    label: string,
    options: Array<{ value: string; label: string }>,
    icons: Record<string, typeof Layers>,
    selected: string,
    onPick: (value: string) => void,
  ) {
    return (
      <div className="p-1.5">
        <p className="px-2.5 py-1.5 font-body text-xs text-foreground-muted">{label}</p>
        {options.map((option) => {
          const Icon = icons[option.value];
          const isSelected = selected === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onPick(option.value)}
              aria-pressed={isSelected}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 font-body text-sm text-foreground transition-colors hover:bg-surface-raised"
            >
              <Icon strokeWidth={2.5} size={15} className="shrink-0 text-foreground-muted" aria-hidden="true" />
              <span className="flex-1 text-left">{option.label}</span>
              {isSelected && <Check strokeWidth={2.5} size={15} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="Filter events"
        title="Filter events"
        aria-expanded={open}
        className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
          active
            ? "border-accent/60 bg-accent/10 text-accent"
            : "border-border text-foreground-muted hover:bg-surface-raised hover:text-foreground"
        }`}
      >
        <SlidersHorizontal strokeWidth={2.5} size={15} />
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-20 w-56 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
          {renderGroup(
            "Type",
            EVENT_TYPE_OPTIONS,
            TYPE_ICONS,
            type,
            (value) => onSelect(value as EventTypeFilter, date),
          )}
          <div className="border-t border-border">
            {renderGroup(
              "Date",
              EVENT_DATE_OPTIONS,
              DATE_ICONS,
              date,
              (value) => onSelect(type, value as EventDateFilter),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
