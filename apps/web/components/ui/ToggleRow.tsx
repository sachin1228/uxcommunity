"use client";

/**
 * The house toggle switch, extracted from ThreadComposerControls into the
 * shared UI layer so every surface that needs a switch (thread/showcase/event
 * forms, Settings) imports the same one from `components/ui/` instead of a
 * feature folder. Rendering and behavior are unchanged: an sr-only checkbox in
 * front of a styled track/knob, so it stays keyboard-operable and the
 * focus-visible ring lands on the track.
 */
export function ToggleRow({
  title,
  description,
  checked,
  onChange,
  icon,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  icon?: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3">
      <span className="flex items-center gap-2.5">
        {icon && <span className="shrink-0 text-foreground-muted">{icon}</span>}
        <span>
          <span className="block font-body text-sm font-medium text-foreground">{title}</span>
          <span className="block font-body text-xs text-foreground-muted">{description}</span>
        </span>
      </span>
      <span className="relative h-6 w-11 shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={`block h-6 w-11 rounded-full transition-colors duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-accent/25 ${
            checked ? "bg-[var(--ds-blue-800)]" : "bg-border"
          }`}
        />
        <span
          aria-hidden="true"
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-[0_0_2px_rgba(0,0,0,0.25),0_1px_2px_rgba(0,0,0,0.15)] transition-transform duration-150 ${
            checked ? "translate-x-5" : ""
          }`}
        />
      </span>
    </label>
  );
}
