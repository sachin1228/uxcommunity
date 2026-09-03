"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { LottieRefCurrentProps } from "lottie-react";
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
}

type Playable = { play?: () => void; pause?: () => void };

function decodeBase64(data: string): ArrayBuffer {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  // ArrayBuffer (not a view) — dotLottie-web routes ArrayBuffers to its
  // binary .lottie loader, while plain objects/views go down the JSON path.
  return bytes.buffer;
}

/**
 * Community display picture: loops the Lottie animation indefinitely while the
 * avatar is on screen, with a static image (or the fallback icon) when no
 * animation is set. Playback pauses when the avatar scrolls out of the
 * viewport so long lists of animated rows don't burn CPU off-screen — used
 * everywhere a community DP renders so an admin-replaced picture propagates
 * across the whole app.
 */
export function CommunityDp({
  imageUrl,
  lottieUrl,
  lottieFormat,
  lottieData,
  name,
  size = 40,
  className = "bg-surface-raised",
}: CommunityDpProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const jsonLottieRef = useRef<LottieRefCurrentProps | null>(null);
  const dotLottieRef = useRef<Playable | null>(null);
  // Mirrors "currently intersecting" so load callbacks (which fire later) can
  // decide whether the freshly-loaded player should stay paused.
  const inViewRef = useRef(true);
  // dotLottie's built-in resolution is capped at ~1.75x on 2x screens, which
  // makes the canvas look soft when the browser stretches it to full Retina
  // sharpness. Render at the display's real pixel ratio instead (capped at 2x
  // — crisp small avatars without 4K backing stores). The dotLottie player is
  // client-only (dynamic, ssr:false), so reading window here never reaches the
  // server HTML and cannot cause a hydration mismatch.
  const [dpr] = useState(() =>
    typeof window === "undefined"
      ? 1
      : Math.min(window.devicePixelRatio || 1, 2)
  );

  const hasJsonLottie =
    Boolean(lottieUrl) &&
    lottieFormat === "json" &&
    typeof lottieData === "object" &&
    lottieData !== null;
  const hasDotLottie =
    Boolean(lottieUrl) &&
    lottieFormat === "dotlottie" &&
    typeof lottieData === "string";

  // Decode once per payload instead of on every render (some files are big).
  const dotLottieBuffer = useMemo(
    () => (typeof lottieData === "string" ? decodeBase64(lottieData) : null),
    [lottieData]
  );

  const hasAnimation =
    hasJsonLottie || (hasDotLottie && Boolean(dotLottieBuffer));

  // Pause playback while the avatar is off-screen. The observer fires its
  // initial callback immediately, so a player that mounts inside a hidden or
  // scrolled-out container is paused right away.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !hasAnimation || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        inViewRef.current = entry.isIntersecting;
        // Visible for debugging/instrumentation (no styling depends on it).
        el.dataset.playing = String(entry.isIntersecting);
        if (entry.isIntersecting) {
          jsonLottieRef.current?.play?.();
          dotLottieRef.current?.play?.();
        } else {
          jsonLottieRef.current?.pause?.();
          dotLottieRef.current?.pause?.();
        }
      },
      { threshold: 0.01 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasAnimation]);

  // A player that finishes loading while the avatar is off-screen must not
  // autoplay invisibly — pause it as soon as its DOM is ready.
  const handleJsonDomLoaded = () => {
    if (!inViewRef.current) jsonLottieRef.current?.pause?.();
  };

  const handleDotLottieRef = useCallback((instance: unknown) => {
    const lottie = instance as Playable | null;
    if (!lottie) return;
    dotLottieRef.current = lottie;
    if (!inViewRef.current) lottie.pause?.();
  }, []);

  return (
    <div
      ref={containerRef}
      className={`flex items-center justify-center rounded-full overflow-hidden shrink-0 select-none ${className}`}
      style={{ width: size, height: size }}
    >
      {hasJsonLottie ? (
        <Lottie
          animationData={lottieData as object}
          lottieRef={jsonLottieRef}
          loop
          autoplay
          onDOMLoaded={handleJsonDomLoaded}
          onLoadedImages={handleJsonDomLoaded}
          style={{ width: size, height: size }}
        />
      ) : hasDotLottie && dotLottieBuffer ? (
        <DotLottieReact
          data={dotLottieBuffer}
          renderConfig={{ devicePixelRatio: dpr }}
          loop
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
