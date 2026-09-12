"use client";

import { useState } from "react";
import { Check } from "lucide-react";

/**
 * Accent color picker shared by the Create and Edit event modals.
 * The chosen hex becomes the main color of that event's ticket card.
 */

export const DEFAULT_EVENT_ACCENT = "#e8e14a";

export const EVENT_ACCENT_PRESETS = [
  { value: DEFAULT_EVENT_ACCENT, label: "Citron" },
  { value: "#a78bfa", label: "Violet" },
  { value: "#38bdf8", label: "Sky" },
  { value: "#34d399", label: "Mint" },
  { value: "#fb923c", label: "Orange" },
  { value: "#f472b6", label: "Pink" },
  { value: "#f87171", label: "Red" },
  { value: "#e2e8f0", label: "Silver" },
];

export function AccentColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const [customMode, setCustomMode] = useState(
    !EVENT_ACCENT_PRESETS.some((preset) => preset.value === value),
  );

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {EVENT_ACCENT_PRESETS.map((preset) => {
          const active = !customMode && value.toLowerCase() === preset.value;
          return (
            <button
              key={preset.value}
              type="button"
              onClick={() => {
                setCustomMode(false);
                onChange(preset.value);
              }}
              aria-label={preset.label}
              aria-pressed={active}
              title={preset.label}
              className={`relative flex size-8 items-center justify-center rounded-full border transition-transform hover:scale-105 ${
                active ? "border-foreground ring-2 ring-accent/40" : "border-white/15"
              }`}
              style={{ backgroundColor: preset.value }}
            >
              {active && <Check strokeWidth={3} size={14} className="text-stone-900" />}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setCustomMode((current) => !current)}
          aria-pressed={customMode}
          className={`flex h-8 items-center gap-1.5 rounded-full border px-3 font-body text-[11px] font-medium transition-colors ${
            customMode
              ? "border-foreground text-foreground"
              : "border-white/15 text-foreground-muted hover:text-foreground"
          }`}
        >
          Custom
        </button>
      </div>

      {customMode && (
        <label className="flex items-center gap-2.5">
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-9 w-12 cursor-pointer rounded-md border border-white/15 bg-transparent p-0.5"
            aria-label="Pick a custom accent color"
          />
          <span className="font-mono text-xs uppercase text-foreground-muted">{value}</span>
        </label>
      )}
    </div>
  );
}
