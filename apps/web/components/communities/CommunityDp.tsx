"use client";

import { useMemo, useState } from "react";
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
}

function decodeBase64(data: string): ArrayBuffer {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  // ArrayBuffer (not a view) — dotLottie-web routes ArrayBuffers to its
  // binary .lottie loader, while plain objects/views go down the JSON path.
  return bytes.buffer;
}

/**
 * Community display picture: loops the Lottie animation indefinitely, with a
 * static image (or the fallback icon) when no animation is set. Used
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

  return (
    <div
      className={`flex items-center justify-center rounded-full overflow-hidden shrink-0 select-none ${className}`}
      style={{ width: size, height: size }}
    >
      {hasJsonLottie ? (
        <Lottie
          animationData={lottieData as object}
          loop
          autoplay
          style={{ width: size, height: size }}
        />
      ) : hasDotLottie && dotLottieBuffer ? (
        <DotLottieReact
          data={dotLottieBuffer}
          renderConfig={{ devicePixelRatio: dpr }}
          loop
          autoplay
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
