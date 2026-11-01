"use client";

import { useEffect, useId, useRef, type CSSProperties } from "react";

/**
 * The rail's pass card: a phone rising out of the dark with a community pass on
 * its screen. The fold-in, the shimmer across the pass and the hold cue are
 * ported from accessgrid.com's hero phone, retimed to the same numbers and
 * redrawn in our tokens — light device, brand-gradient pass, white ink.
 *
 * Purely decorative, so the whole block is hidden from assistive tech.
 */

/** The device's width is the unit everything else is cut from. */
const DEVICE_WIDTH = 228;

/** The phone starts below, tilted back, soft, and folds up into place. */
const DURATION = 1250;
const DELAY = 320;
const TILT = -60;
const LIFT = 104;
const SCALE = 1.1;
const BLUR = 11;
const FADE_BY = 0.6;
const PERSPECTIVE = 3800;
const PIVOT = 77;
const TAP_AT = 0.74;
const TAP_TILT = 2;
const SHIMMER_OPACITY = 0.22;
const SHIMMER_MS = 900;
const SHIMMER_LEAD = 100;
const HOLD_DELAY = 250;
const HOLD_MS = 400;

/** The pass's contour lines, generated once and shared by every render. */
const CONTOUR_LINES = (() => {
  const width = 299;
  const height = 199;
  const lines: string[] = [];
  for (let y = 8; y <= height - 6; y += 5) {
    const amplitude = 3.4 + 2.6 * Math.sin(y / 21);
    let d = `M0 ${y.toFixed(2)}`;
    for (let x = 0; x <= width; x += 14) {
      const dy =
        amplitude * Math.sin(x / 27 + y / 16) +
        amplitude * 0.55 * Math.sin(x / 11.5 - y / 8);
      d += `L${x} ${(y + dy).toFixed(2)}`;
    }
    lines.push(d);
  }
  return lines;
})();

const unit = (value: number) => `calc(var(--device-w) * ${value} / 337)`;

export function CommunityPhoneCard() {
  const panelRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const phoneRef = useRef<HTMLDivElement | null>(null);
  const bandRef = useRef<HTMLSpanElement | null>(null);
  const holdRef = useRef<HTMLDivElement | null>(null);
  const playedRef = useRef(false);
  const gridId = useId().replace(/:/g, "");

  useEffect(() => {
    const panel = panelRef.current;
    const stage = stageRef.current;
    const phone = phoneRef.current;
    if (!panel || !stage || !phone) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const animations: Animation[] = [];

    const play = () => {
      if (playedRef.current) return;
      playedRef.current = true;
      phone.style.opacity = "1";

      if (reduce.matches) {
        animations.push(
          phone.animate([{ opacity: 0 }, { opacity: 1 }], {
            delay: DELAY,
            duration: 300,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            fill: "backwards",
          }),
        );
        if (holdRef.current) holdRef.current.style.opacity = "1";
        return;
      }

      stage.style.perspective = `${PERSPECTIVE}px`;
      phone.style.transformOrigin = `50% ${PIVOT}%`;
      phone.style.willChange = "transform, opacity, filter";

      const fold = phone.animate(
        [
          {
            offset: 0,
            opacity: 0,
            filter: `blur(${BLUR}px)`,
            transform: `translateY(${LIFT}px) rotateX(${TILT}deg) scale(${SCALE})`,
            easing: "cubic-bezier(0.65, 0, 0.35, 1)",
          },
          { offset: FADE_BY, opacity: 1, filter: "blur(0px)" },
          {
            offset: TAP_AT,
            transform: `translateY(0px) rotateX(${TAP_TILT}deg) scale(1)`,
            easing: "cubic-bezier(0.3, 0, 0.2, 1)",
          },
          {
            offset: 1,
            opacity: 1,
            filter: "blur(0px)",
            transform: "translateY(0px) rotateX(0deg) scale(1)",
          },
        ],
        { delay: DELAY, duration: DURATION, fill: "backwards" },
      );
      animations.push(fold);
      fold.finished.then(
        () => {
          phone.style.willChange = "";
        },
        () => {},
      );

      const screenAt = Math.max(0, DELAY + DURATION - SHIMMER_LEAD);

      if (bandRef.current) {
        const band = bandRef.current;
        band.style.willChange = "transform";
        const sweep = band.animate(
          [
            { opacity: SHIMMER_OPACITY, transform: "translateY(160%) rotate(-7deg)" },
            { opacity: SHIMMER_OPACITY, transform: "translateY(-115%) rotate(-7deg)" },
          ],
          {
            delay: screenAt,
            duration: SHIMMER_MS,
            easing: "cubic-bezier(0.4, 0, 0.2, 1)",
          },
        );
        animations.push(sweep);
        sweep.finished.then(
          () => {
            band.style.willChange = "";
          },
          () => {},
        );
      }

      if (holdRef.current) {
        const wait = screenAt + HOLD_DELAY;
        const total = wait + HOLD_MS;
        animations.push(
          holdRef.current.animate(
            [
              { offset: 0, opacity: 0, transform: "translateY(4px)" },
              {
                offset: wait / total,
                opacity: 0,
                transform: "translateY(4px)",
                easing: "cubic-bezier(0.2, 0.7, 0.2, 1)",
              },
              { offset: 1, opacity: 1, transform: "translateY(0)" },
            ],
            { duration: total, fill: "backwards" },
          ),
        );
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          play();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(panel);

    return () => {
      observer.disconnect();
      animations.forEach((animation) => animation.cancel());
    };
  }, []);

  return (
    <section
      ref={panelRef}
      aria-hidden="true"
      className="relative h-[340px] overflow-hidden rounded-xl border border-white/10 bg-overlay"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(255,255,255,0.10),transparent_72%)]" />

      <svg
        className="pointer-events-none absolute inset-0 h-full w-full text-white/[0.09] [mask-image:linear-gradient(to_bottom,transparent,#000_18%,#000_70%,transparent)]"
        aria-hidden="true"
      >
        <defs>
          <pattern
            id={gridId}
            width="48"
            height="48"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M48 0H0V48"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              strokeDasharray="3 4"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${gridId})`} />
      </svg>

      <div
        ref={stageRef}
        className="pointer-events-none absolute left-1/2 top-[18px] h-[322px] w-[calc(var(--device-w)_+_8px)] -translate-x-1/2 [mask-image:linear-gradient(to_bottom,#000_calc(100%_-_52px),transparent)]"
        style={{ "--device-w": `${DEVICE_WIDTH}px` } as CSSProperties}
      >
        <div
          ref={phoneRef}
          className="relative mx-auto select-none opacity-0"
          style={{ width: "var(--device-w)", height: unit(618.25) }}
        >
          {/* side buttons, just proud of the frame */}
          <span
            className="absolute left-[-2px] w-[3px] rounded-full bg-[#CFCFD5]"
            style={{ top: unit(144), height: unit(33) }}
          />
          <span
            className="absolute left-[-2px] w-[3px] rounded-full bg-[#CFCFD5]"
            style={{ top: unit(201), height: unit(51) }}
          />
          <span
            className="absolute left-[-2px] w-[3px] rounded-full bg-[#CFCFD5]"
            style={{ top: unit(268), height: unit(51) }}
          />
          <span
            className="absolute right-[-2px] w-[3px] rounded-full bg-[#CFCFD5]"
            style={{ top: unit(219), height: unit(84) }}
          />

          {/* frame */}
          <div
            className="absolute inset-0 bg-[linear-gradient(180deg,#F5F5F6_0%,#E9E9EB_48%,#CFCFD5_100%)] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.75),0_0_0_1px_rgba(255,255,255,0.14),inset_0_0_0_1px_rgba(255,255,255,0.7)]"
            style={{ borderRadius: unit(60) }}
          >
            <div
              className="absolute overflow-hidden bg-[#F4F4F5] ring-1 ring-inset ring-black/[0.07]"
              style={{ inset: unit(8), borderRadius: unit(52) }}
            >
              {/* status bar */}
              <div
                className="absolute inset-x-0 flex items-start justify-between font-body font-semibold text-[#B8B9C1]"
                style={{
                  top: unit(21),
                  paddingInline: unit(24),
                  fontSize: unit(11),
                }}
              >
                <span className="leading-none tracking-tight">9:41</span>
                <span className="flex items-center gap-[2px]">
                  <svg width="13" height="8" viewBox="0 0 16 10" fill="currentColor">
                    <rect x="0" y="6" width="2.5" height="4" rx="0.7" />
                    <rect x="4" y="4" width="2.5" height="6" rx="0.7" />
                    <rect x="8" y="2" width="2.5" height="8" rx="0.7" />
                    <rect x="12" y="0" width="2.5" height="10" rx="0.7" />
                  </svg>
                  <svg width="18" height="8" viewBox="0 0 22 10" fill="none">
                    <rect
                      x="0.5"
                      y="0.5"
                      width="18"
                      height="9"
                      rx="2.5"
                      stroke="currentColor"
                    />
                    <rect
                      x="2.5"
                      y="2.5"
                      width="14"
                      height="5"
                      rx="1.3"
                      fill="currentColor"
                    />
                    <path
                      d="M20.5 3.5V6.5C21.3 6.3 21.7 5.7 21.7 5C21.7 4.3 21.3 3.7 20.5 3.5Z"
                      fill="currentColor"
                    />
                  </svg>
                </span>
              </div>

              {/* dynamic island */}
              <span
                className="absolute left-1/2 -translate-x-1/2 rounded-full bg-[#D9D9DE]"
                style={{
                  top: unit(14),
                  width: unit(96),
                  height: unit(28),
                  borderRadius: unit(14),
                }}
              />

              {/* the pass */}
              <div
                className="absolute overflow-hidden shadow-[0_2px_5px_rgba(0,0,0,0.10)]"
                style={{
                  left: unit(11),
                  top: unit(79),
                  width: unit(299),
                  height: unit(199),
                  borderRadius: unit(16),
                }}
              >
                <div className="absolute inset-0 bg-[linear-gradient(180deg,#30323A_0%,#24262D_38%,#1D1F26_100%)]" />
                <svg
                  className="absolute inset-0 h-full w-full [mask-image:linear-gradient(to_bottom,#000_58%,transparent_96%)]"
                  viewBox="0 0 299 199"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  {CONTOUR_LINES.map((d, index) => (
                    <path
                      key={index}
                      d={d}
                      fill="none"
                      stroke="rgba(255,255,255,0.16)"
                      strokeWidth="0.9"
                    />
                  ))}
                </svg>
                <span
                  className="absolute block size-[14px] text-white"
                  style={{ left: unit(11), top: unit(11) }}
                >
                  <svg viewBox="0 0 16 16" fill="none" className="size-full">
                    <path
                      fill="currentColor"
                      fillRule="evenodd"
                      clipRule="evenodd"
                      transform="translate(-0.8 -0.8) scale(1.1)"
                      d="M14.666 7C14.666 3.667 11.999 2 7.999 2C3.999 2 1.332 3.667 1.332 7C1.332 10.333 3.999 12 7.999 12V14C7.999 14 14.666 12 14.666 7Z M4.583 7a.75.75 0 1 0 1.5 0a.75.75 0 1 0-1.5 0Z M7.25 7a.75.75 0 1 0 1.5 0a.75.75 0 1 0-1.5 0Z M9.917 7a.75.75 0 1 0 1.5 0a.75.75 0 1 0-1.5 0Z"
                    />
                  </svg>
                </span>
                <div
                  className="absolute inset-x-0 bottom-0 font-body"
                  style={{ padding: unit(11) }}
                >
                  <p
                    className="font-medium leading-none tracking-[0.04em] text-white/60"
                    style={{ fontSize: unit(9) }}
                  >
                    Community
                  </p>
                  <p
                    className="mt-[2px] font-display font-semibold leading-none tracking-tight text-white"
                    style={{ fontSize: unit(15) }}
                  >
                    uxcommunity
                  </p>
                </div>

                <span
                  ref={bandRef}
                  className="pointer-events-none absolute -left-[20%] -right-[20%] top-0 h-[70%] bg-[linear-gradient(to_top,transparent,#fff_50%,transparent)] opacity-0"
                />
                <span className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/10" />
              </div>

              {/* the hold cue */}
              <div
                ref={holdRef}
                className="absolute left-1/2 flex -translate-x-1/2 flex-col items-center"
                style={{ top: unit(312), gap: unit(16) }}
              >
                <span
                  className="flex items-center justify-center rounded-full border-[1.5px] border-[#0A0A0A] text-[#0A0A0A]"
                  style={{ width: unit(46), height: unit(46) }}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M2 6.2 4.8 9 10 3.4"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span
                  className="font-body font-medium leading-none text-[#525252]"
                  style={{ fontSize: unit(14) }}
                >
                  You&rsquo;re in.
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
