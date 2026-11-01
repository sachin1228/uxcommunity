"use client";

import { useEffect, useId, useRef, type CSSProperties } from "react";

/**
 * The rail's phone: the app's chat list rising out of the dark. The fold-in and
 * the shimmer across the glass are ported from accessgrid.com's hero phone,
 * retimed to the same numbers and rebuilt with our overlay surface and Geist
 * type — a dark device, a real screen, no invented content.
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
const SHIMMER_OPACITY = 0.1;
const SHIMMER_MS = 900;
const SHIMMER_LEAD = 100;

const unit = (value: number) => `calc(var(--device-w) * ${value} / 337)`;

export function CommunityPhoneCard() {
  const panelRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const phoneRef = useRef<HTMLDivElement | null>(null);
  const bandRef = useRef<HTMLSpanElement | null>(null);
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
            className="absolute left-[-2px] w-[3px] rounded-full bg-[#2D2D34]"
            style={{ top: unit(144), height: unit(33) }}
          />
          <span
            className="absolute left-[-2px] w-[3px] rounded-full bg-[#2D2D34]"
            style={{ top: unit(201), height: unit(51) }}
          />
          <span
            className="absolute left-[-2px] w-[3px] rounded-full bg-[#2D2D34]"
            style={{ top: unit(268), height: unit(51) }}
          />
          <span
            className="absolute right-[-2px] w-[3px] rounded-full bg-[#2D2D34]"
            style={{ top: unit(219), height: unit(84) }}
          />

          {/* frame */}
          <div
            className="absolute inset-0 bg-[linear-gradient(155deg,#3A3A42_0%,#26262C_26%,#17171A_62%,#24242A_100%)] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.16),inset_0_1px_0_rgba(255,255,255,0.18)]"
            style={{ borderRadius: unit(60) }}
          >
            <div
              className="absolute overflow-hidden bg-background ring-1 ring-inset ring-white/[0.06]"
              style={{
                inset: unit(8),
                borderRadius: unit(52),
                // The device always shows the app's dark theme, whatever the
                // page theme is behind it.
                "--color-background": "#09090B",
              } as CSSProperties}
            >
              {/* status bar */}
              <div
                className="absolute inset-x-0 flex items-start justify-between font-body font-semibold text-[#737373]"
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
                className="absolute left-1/2 -translate-x-1/2 rounded-full bg-[#1B1B1F] ring-1 ring-white/[0.06]"
                style={{
                  top: unit(14),
                  width: unit(96),
                  height: unit(28),
                  borderRadius: unit(14),
                }}
              />

              {/* the app screen, clipped by the device */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/home/illustrations/app-chat-preview.webp"
                alt=""
                width={604}
                height={1212}
                loading="eager"
                decoding="async"
                className="absolute inset-x-0 h-auto w-full"
                style={{ top: unit(42) }}
              />

              <span
                ref={bandRef}
                className="pointer-events-none absolute -left-[20%] -right-[20%] top-0 h-[55%] bg-[linear-gradient(to_top,transparent,#fff_50%,transparent)] opacity-0"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
