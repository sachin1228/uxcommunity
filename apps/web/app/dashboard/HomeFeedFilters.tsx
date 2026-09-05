"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";

const FILTERS = ["Newest", "Trending", "Following"] as const;

type Filter = (typeof FILTERS)[number];

/** Shared classes that pull from the reference palette (see globals.css). */
const SWITCHER_TRACK = "fb-filter-track";
const SWITCHER_PILL = "fb-filter-pill";
const SWITCHER_GLOW = "fb-filter-glow";
const TEXT_ACTIVE = "fb-filter-text-active";
const TEXT_MUTED = "fb-filter-text-muted";

/**
 * Fluid switcher — a sliding pill (with a soft trailing glow) that eases
 * between the active filter, sized to whichever button is selected.
 * Geometry is measured against the live DOM (like the reference switcher) so
 * the pill always tracks the buttons exactly, including across font loads.
 */

const MOTION_DURATION = "450ms";
const MOTION_EASING = "cubic-bezier(.22, 1, .36, 1)";

export function HomeFeedFilters() {
  const [active, setActive] = useState<Filter>("Newest");

  const trackRef = useRef<HTMLDivElement | null>(null);
  const buttonsRef = useRef<Partial<Record<Filter, HTMLButtonElement | null>>>({});
  const pillRef = useRef<HTMLDivElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);
  const activeButtonRef = useRef<HTMLButtonElement | null>(null);
  const firstMeasureRef = useRef(true);

  /** Slide the pill + glow over `button`. `instant` skips the motion. */
  const positionIndicator = useCallback((instant = false) => {
    const track = trackRef.current;
    const button = activeButtonRef.current;
    const pill = pillRef.current;
    const glow = glowRef.current;
    if (!track || !button || !pill || !glow) return;

    const trackRect = track.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const left = Math.round(buttonRect.left - trackRect.left);
    const width = Math.round(buttonRect.width);

    const motion = `left ${MOTION_DURATION} ${MOTION_EASING}, width ${MOTION_DURATION} ${MOTION_EASING}`;
    for (const el of [pill, glow]) {
      el.style.transition = instant ? "none" : motion;
      el.style.left = `${left}px`;
      el.style.width = `${width}px`;
    }

    // Drop the transition override on the next frame so later moves animate.
    if (instant) {
      requestAnimationFrame(() => {
        if (pill.isConnected) pill.style.transition = "";
        if (glow.isConnected) glow.style.transition = "";
      });
    }
  }, []);

  // Place the pill on the active button. First run happens before first paint;
  // later runs (filter clicks) glide from the previous position.
  useLayoutEffect(() => {
    activeButtonRef.current = buttonsRef.current[active] ?? null;
    positionIndicator(firstMeasureRef.current);
    firstMeasureRef.current = false;
  }, [active, positionIndicator]);

  // Keep the pill glued to the active button when the layout shifts.
  useEffect(() => {
    const reposition = () => positionIndicator(true);
    window.addEventListener("resize", reposition);
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(reposition).catch(() => {});
    }
    return () => window.removeEventListener("resize", reposition);
  }, [positionIndicator]);

  return (
    <section className="my-2" aria-label="Feed filters">
      <div className="flex items-center justify-center px-4 py-3 md:px-5 md:py-4">
        <div className="flex items-center gap-2">
          {/* Fluid switcher */}
          <div
            ref={trackRef}
            role="group"
            aria-label="Feed sorting"
            className={`relative flex items-center gap-0.5 rounded-full p-1 ${SWITCHER_TRACK}`}
          >
            {/* Soft glow that trails the sliding pill */}
            <div
              ref={glowRef}
              aria-hidden="true"
              className={`pointer-events-none absolute top-[4px] h-9 rounded-full blur-2xl ${SWITCHER_GLOW}`}
            />
            {/* Sliding pill */}
            <div
              ref={pillRef}
              aria-hidden="true"
              className={`pointer-events-none absolute top-[4px] h-9 rounded-full ${SWITCHER_PILL}`}
            />

            {FILTERS.map((filter) => {
              const isActive = filter === active;
              return (
                <button
                  key={filter}
                  type="button"
                  ref={(el) => {
                    buttonsRef.current[filter] = el;
                  }}
                  onClick={() => setActive(filter)}
                  aria-pressed={isActive}
                  className={`fb-filter-button relative z-10 h-9 rounded-full px-4 font-body text-xs font-semibold uppercase tracking-wide whitespace-nowrap transition-colors duration-150 sm:px-5 ${
                    isActive ? TEXT_ACTIVE : TEXT_MUTED
                  }`}
                >
                  {filter}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
