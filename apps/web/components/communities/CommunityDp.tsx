"use client";

import { useState } from "react";
import { CommunityIcon } from "./CommunityIcon";

/**
 * Community display picture: a static image (or the fallback icon).
 *
 * Historical note: this component used to loop a Lottie animation as the DP
 * (JSON and dotLottie players, viewport-gated playback). Animated community
 * DPs were removed from the product, so the animation plumbing is gone —
 * `lottie*` props are still accepted and ignored so old cached data and call
 * sites keep working while they are migrated out.
 */
export interface CommunityDpProps {
  imageUrl: string | null;
  /** Accepted for backward compatibility; ignored (animations removed). */
  lottieUrl?: string | null;
  lottieFormat?: unknown;
  /** Accepted for backward compatibility; ignored (animations removed). */
  lottieData?: unknown;
  name: string;
  /** Container diameter in px. */
  size?: number;
  /** Extra classes for the circular container (background, etc.). */
  className?: string;
}

export function CommunityDp({
  imageUrl,
  name,
  size = 40,
  className = "bg-surface-raised",
}: CommunityDpProps) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div
      className={`flex items-center justify-center rounded-full overflow-hidden shrink-0 select-none ${className}`}
      style={{ width: size, height: size }}
    >
      {imageUrl && !imgFailed ? (
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
