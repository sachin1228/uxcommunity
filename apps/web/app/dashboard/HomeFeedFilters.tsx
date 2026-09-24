"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

/** Labels for the feed source selector. */
const SCOPES = [
  { value: "all", label: "For You" },
  { value: "communities", label: "Your Communities" },
] as const;

/** Shared classes that pull from the reference palette (see globals.css). */
const SWITCHER_TRACK = "fb-filter-track";
const SWITCHER_PILL = "fb-filter-pill";
const TEXT_ACTIVE = "fb-filter-text-active";
const TEXT_MUTED = "fb-filter-text-muted";

/**
 * Fluid switcher — a sliding pill that eases between the active option, sized
 * to whichever button is selected. Geometry is measured against the live DOM
 * (like the reference switcher) so the pill always tracks the buttons exactly,
 * including across font loads.
 */

const MOTION_DURATION = "450ms";
const MOTION_EASING = "cubic-bezier(.22, 1, .36, 1)";

interface Option {
  value: string;
  label: string;
}

interface SwitcherProps {
  label: string;
  options: readonly Option[];
  active: string;
  onSelect: (value: string) => void;
}

function Switcher({ label, options, active, onSelect }: SwitcherProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const buttonsRef = useRef<Partial<Record<string, HTMLButtonElement | null>>>({});
  const pillRef = useRef<HTMLDivElement | null>(null);
  const activeButtonRef = useRef<HTMLButtonElement | null>(null);
  const firstMeasureRef = useRef(true);

  /** Slide the pill over `button`. `instant` skips the motion. */
  const positionIndicator = useCallback((instant = false) => {
    const track = trackRef.current;
    const button = activeButtonRef.current;
    const pill = pillRef.current;
    if (!track || !button || !pill) return;

    const trackRect = track.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const left = Math.round(buttonRect.left - trackRect.left);
    const width = Math.round(buttonRect.width);

    const motion = `left ${MOTION_DURATION} ${MOTION_EASING}, width ${MOTION_DURATION} ${MOTION_EASING}`;
    pill.style.transition = instant ? "none" : motion;
    pill.style.left = `${left}px`;
    pill.style.width = `${width}px`;

    // Drop the transition override on the next frame so later moves animate.
    if (instant) {
      requestAnimationFrame(() => {
        if (pill.isConnected) pill.style.transition = "";
      });
    }
  }, []);

  // Place the pill on the active button. First run happens before first paint;
  // later runs (option clicks) glide from the previous position.
  useLayoutEffect(() => {
    activeButtonRef.current = buttonsRef.current[active] ?? null;
    positionIndicator(firstMeasureRef.current);
    firstMeasureRef.current = false;
  }, [active, positionIndicator]);

  return (
    <div>
      <div
        ref={trackRef}
        role="group"
        aria-label={label}
        className={`relative flex items-center gap-0.5 rounded-full p-1 ${SWITCHER_TRACK}`}
      >
        {/* Sliding pill */}
        <div
          ref={pillRef}
          aria-hidden="true"
          className={`pointer-events-none absolute top-[4px] h-9 rounded-full ${SWITCHER_PILL}`}
        />

        {options.map((option) => {
          const isActive = option.value === active;
          return (
            <button
              key={option.value}
              type="button"
              ref={(el) => {
                buttonsRef.current[option.value] = el;
              }}
              onClick={() => onSelect(option.value)}
              aria-pressed={isActive}
              className={`fb-filter-button relative z-10 h-9 rounded-full px-4 font-body text-xs font-semibold uppercase tracking-wide whitespace-nowrap transition-colors duration-150 sm:px-5 ${
                isActive ? TEXT_ACTIVE : TEXT_MUTED
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface HomeFeedFiltersProps {
  scope: string;
  onScopeChange: (scope: string) => void;
}

export function HomeFeedFilters({ scope, onScopeChange }: HomeFeedFiltersProps) {
  return (
    <section className="my-2" aria-label="Feed filters">
      <div className="flex items-center justify-center px-4 py-3 md:px-5 md:py-4">
        <Switcher
          label="Feed source"
          options={SCOPES}
          active={scope}
          onSelect={onScopeChange}
        />
      </div>
    </section>
  );
}
