import { BrandLogo } from "@/components/ui/BrandLogo";

/** Number of dots in the loading ring. */
const DOT_COUNT = 12;
/** Milliseconds for one full pulse cycle around the ring. */
const CYCLE_MS = 1100;
/** Distance of each dot from the ring's center, in px. */
const RING_RADIUS = 16;
/** Dot diameter, in px. */
const DOT_SIZE = 5;

/**
 * Full-screen branded loading state, Vercel-style: the brand mark in the
 * top-left corner, a ring of pulsing dots, and a centered label. Used for
 * auth transitions ("Logging in", "Logging out") while the request is in
 * flight so the user always gets clear feedback.
 */
export function BrandedLoadingScreen({ label }: { label: string }) {
  return (
    <div className="fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-[#0A0A0A]">
      <BrandLogo
        className="absolute left-6 top-6"
        iconClassName="h-8 w-8"
        wordmarkClassName="hidden"
      />

      <div className="relative h-10 w-10" role="status" aria-label={label}>
        {Array.from({ length: DOT_COUNT }).map((_, i) => (
          <span
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              left: "50%",
              top: "50%",
              width: DOT_SIZE,
              height: DOT_SIZE,
              marginLeft: -DOT_SIZE / 2,
              marginTop: -DOT_SIZE / 2,
              transform: `rotate(${(i * 360) / DOT_COUNT}deg) translateY(-${RING_RADIUS}px)`,
              animation: `logging-dot ${CYCLE_MS}ms ease-in-out ${(i * CYCLE_MS) / DOT_COUNT}ms infinite`,
            }}
          />
        ))}
      </div>

      <p className="mt-5 font-display text-sm font-semibold text-white">
        {label}
      </p>
    </div>
  );
}