"use client";

import { useMemo } from "react";
import { Globe } from "lucide-react";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { timeZoneChoices, timeZoneName } from "@/lib/communities/timezone";
import { formatEventTime } from "@/lib/communities/event-display";
import { noonUtcForDateInput, todayDateInput } from "@/lib/communities/event-time";

interface HostTimeZoneFieldProps {
  /**
   * The zone the typed times are read in — the device's own unless the host
   * said otherwise. Null only where the runtime cannot name a zone at all, in
   * which case the picker is the host's only way to say one.
   */
  value: string | null;
  onChange: (next: string) => void;
  /** The zone this device reports, offered back as a one-click reset. */
  deviceZone: string | null;
  /** The start instant, once a date and a time are both set. */
  startIso: string | null;
  /** The day the host picked, to say when the two clocks disagree about it. */
  dateInput: string;
}

/**
 * Which clock the typed start and end times belong to.
 *
 * It defaults to the device's own zone, because that is what a wall clock the
 * member just typed almost always means. The override exists for the two cases
 * where it doesn't: a device set to the wrong zone, and a host scheduling for
 * somewhere they aren't — typing 3 PM for an event in New York while sitting
 * in Lisbon. Choosing a zone does not move the event to keep the instant; it
 * says which clock the numbers on screen are on, and the hint beneath spells
 * out what that lands on in the host's own time so the swap is never silent.
 */
export function HostTimeZoneField({
  value,
  onChange,
  deviceZone,
  startIso,
  dateInput,
}: HostTimeZoneFieldProps) {
  // Labelled for noon of the chosen day rather than for now, so a list opened
  // while planning a January event shows January's offsets. Anchoring on the
  // day (not the typed time) keeps the list from re-sorting on every keystroke.
  const at = noonUtcForDateInput(dateInput).getTime();
  // The current selection and the device's zone are offered even when the
  // curated table doesn't cover them, so a selection can always be found again.
  const options = useMemo(
    () => timeZoneChoices(new Date(at), [value, deviceZone]),
    [at, value, deviceZone],
  );

  const chosen = value ?? deviceZone;
  const overriding = !!chosen && chosen !== deviceZone;

  // What the same moment reads as on the host's own clock, which is the check
  // that catches a mistaken change of zone. Mentioned only when the two clocks
  // disagree, and mentioning the day only when they disagree about that too.
  const reading = startIso ? formatEventTime(startIso) : "";
  const sameDay = !startIso || todayDateInput(new Date(startIso)) === dateInput;
  const day = startIso && !sameDay
    ? new Date(startIso).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
    : "";

  return (
    <div>
      <span className="mb-1.5 flex items-center gap-1.5 font-body text-xs font-medium text-foreground-muted">
        <Globe strokeWidth={2.5} size={11} /> Timezone
        {overriding && deviceZone && (
          <button
            type="button"
            onClick={() => onChange(deviceZone)}
            title={`Go back to the timezone this device is set to (${timeZoneName(deviceZone)})`}
            className="ml-auto font-body font-normal text-foreground-subtle underline decoration-dotted underline-offset-2 transition-colors hover:text-accent"
          >
            Use my device timezone
          </button>
        )}
      </span>
      <SearchableSelect
        options={options}
        value={chosen ?? ""}
        onChange={onChange}
        placeholder="Pick a timezone…"
      />
      <div className="mt-1.5 font-body text-[11px] leading-snug text-foreground-subtle">
        {/* The trigger above already carries the zone's offset — naming it
            again here would be the third place on screen it appears. */}
        <p>
          {overriding && chosen
            ? `Times are read in ${timeZoneName(chosen)} time.`
            : "Times are read in your own timezone."}
        </p>
        {overriding && reading && (
          <p className="mt-0.5">
            {sameDay ? `That's ${reading} your own clock.` : `That's ${reading} on ${day} your own clock.`}
          </p>
        )}
        <p className="mt-0.5">Everyone else sees the same moment on their own clock.</p>
      </div>
    </div>
  );
}
