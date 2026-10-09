import { ChevronDown } from "lucide-react";

/**
 * A short list of fixed choices, drawn as a field.
 *
 * The app's other short-choice controls are native selects with the shared
 * `field` skin, which leaves the browser's own mark drawn inside the app's
 * ring — a thin, system-styled chevron that reads as a rendering fault next to
 * the app's own carets, and sits differently in every browser.
 *
 * This keeps the native control and replaces only the mark. The keyboard
 * behaviour, the OS picker on touch, and the free accessibility are worth more
 * than a custom listbox costs for three or four fixed choices — nothing here
 * needs to filter or take free text, which is what SearchableSelect is for.
 */
export function SelectField<T extends string>({
  value,
  onChange,
  options,
  id,
  disabled = false,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  id?: string;
  disabled?: boolean;
}) {
  return (
    <span className="relative block">
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        disabled={disabled}
        // `appearance-none` drops the native chrome; the right padding is the
        // room the caret needs, so a long label never runs under it.
        className="field appearance-none pr-9"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        strokeWidth={2.5}
        size={15}
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-foreground-muted"
      />
    </span>
  );
}
