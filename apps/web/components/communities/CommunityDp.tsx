"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { CommunityIcon } from "./CommunityIcon";

// Lazy-load the lottie players so they stay out of the main bundle.
const Lottie = dynamic(() => import("lottie-react"), { ssr: false });
const DotLottieReact = dynamic(
  () => import("@lottiefiles/dotlottie-react").then((m) => m.DotLottieReact),
  { ssr: false }
);

export type LottieFormat = "json" | "dotlottie";

export interface CommunityDpProps {
  imageUrl: string | null;
  /** Lottie animation URL — when set with data, the animation plays as the DP. */
  lottieUrl?: string | null;
  lottieFormat?: LottieFormat | null;
  /** Embedded payload: parsed JSON object ('json') or base64 string ('dotlottie'). */
  lottieData?: unknown;
  name: string;
  /** Container diameter in px. */
  size?: number;
  /** Extra classes for the circular container (background, etc.). */
  className?: string;
  /** Gap between animation replays in ms (default 10s). */
  replayDelayMs?: number;
}

const DEFAULT_REPLAY_DELAY_MS = 10_000;

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Community display picture: plays the Lottie animation once, waits
 * `replayDelayMs` (10s), then replays — with a static image (or the fallback
 * icon) when no animation is set. Used everywhere a community DP renders so
 * an admin-replaced picture propagates across the whole app.
 */
export function CommunityDp({
  imageUrl,
  lottieUrl,
  lottieFormat,
  lottieData,
  name,
  size = 40,
  className = "bg-surface-raised",
  replayDelayMs = DEFAULT_REPLAY_DELAY_MS,
}: CommunityDpProps) {
  const [imgFailed, setImgFailed] = useState(false);
  // Remount key for the lottie-react player — replays the animation.
  const [playId, setPlayId] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dotLottieRef = useRef<{ play?: () => void; removeEventListener?: (e: string, fn: () => void) => void } | null>(null);
  const replayDelayRef = useRef(replayDelayMs);

  useEffect(() => {
    replayDelayRef.current = replayDelayMs;
  }, [replayDelayMs]);

  const hasJsonLottie =
    Boolean(lottieUrl) &&
    lottieFormat === "json" &&
    typeof lottieData === "object" &&
    lottieData !== null;
  const hasDotLottie =
    Boolean(lottieUrl) &&
    lottieFormat === "dotlottie" &&
    typeof lottieData === "string";

  const scheduleReplay = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setPlayId((p) => p + 1), replayDelayRef.current);
  }, []);

  // dotLottie player: play once, then replay after the delay. The instance
  // persists across renders, so we attach the listener a single time.
  const handleDotLottieRef = useCallback((instance: unknown) => {
    const lottie = instance as { play?: () => void; addEventListener?: (e: string, fn: () => void) => void } | null;
    if (!lottie) return;
    dotLottieRef.current = lottie;
    lottie.addEventListener?.("complete", () => {
      const delay = replayDelayRef.current;
      setTimeout(() => lottie.play?.(), delay);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      dotLottieRef.current = null;
    };
  }, []);

  return (
    <div
      className={`flex items-center justify-center rounded-full overflow-hidden shrink-0 select-none ${className}`}
      style={{ width: size, height: size }}
    >
      {hasJsonLottie ? (
        <Lottie
          key={playId}
          animationData={lottieData as object}
          loop={false}
          autoplay
          onComplete={scheduleReplay}
          style={{ width: size, height: size }}
        />
      ) : hasDotLottie ? (
        <DotLottieReact
          data={decodeBase64(lottieData as string)}
          loop={false}
          autoplay
          dotLottieRefCallback={handleDotLottieRef}
          style={{ width: size, height: size }}
        />
      ) : imageUrl && !imgFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={name}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <CommunityIcon size={size} className="bg-transparent" />
      )}
    </div>
  );
}