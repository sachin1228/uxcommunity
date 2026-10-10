"use client";

import { useRef, useState } from "react";
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
import { DropdownMenu } from "@/components/ui/DropdownMenu";
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
 * with the two filter groups (icon rows, a check on the option in force).
 * The panel renders through the shared DropdownMenu portal, so the page's
 * scroll container can never clip it. Picking applies the option and leaves
 * the panel open, since the groups are normally set together.
 */
export function EventFiltersMenu({ type, date, active, onSelect }: EventFiltersMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

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
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 font-body text-sm text-foreground transition-colors hover:bg-white/[0.08]"
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
    <div className="shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="Filter events"
        title="Filter events"
        aria-expanded={open}
        className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
          active
            ? "border-accent/60 bg-accent/10 text-accent"
            : "border-[color:var(--color-field-ring)] text-foreground-muted hover:bg-surface-raised hover:text-foreground"
        }`}
      >
        <SlidersHorizontal strokeWidth={2.5} size={15} />
      </button>
      <DropdownMenu
        triggerRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        className="w-56"
      >
        {renderGroup(
          "Type",
          EVENT_TYPE_OPTIONS,
          TYPE_ICONS,
          type,
          (value) => onSelect(value as EventTypeFilter, date),
        )}
        <div className="border-t border-white/[0.1]">
          {renderGroup(
            "Date",
            EVENT_DATE_OPTIONS,
            DATE_ICONS,
            date,
            (value) => onSelect(type, value as EventDateFilter),
          )}
        </div>
      </DropdownMenu>
    </div>
  );
}
