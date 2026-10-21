"use client";

import { useState } from "react";
import { CommunityIcon } from "./CommunityIcon";
import { VerifiedDpBadge } from "./CommunityBadges";

/**
 * Community display picture: a static image (or the fallback icon), wearing
 * the verified seal at its bottom-right corner when the community carries one.
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
  /** Glyph size inside the no-image fallback; defaults to half the container. */
  iconSize?: number;
  /** Extra classes for the rounded-square container (background, etc.). */
  className?: string;
  /** Draws the verified seal over the face's bottom-right corner. */
  verified?: boolean;
}

export function CommunityDp({
  imageUrl,
  name,
  size = 40,
  iconSize,
  className = "bg-surface-raised",
  verified = false,
}: CommunityDpProps) {
  const [imgFailed, setImgFailed] = useState(false);
  // One proportion on every face: a quarter of the side, floored so the
  // smallest label DP still reads as a tile rather than a circle.
  const radius = Math.max(4, Math.round(size / 4));

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className={`flex h-full w-full items-center justify-center overflow-hidden select-none ${className}`}
        style={{ borderRadius: radius, boxShadow: "var(--shadow-sm)" }}
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
          <CommunityIcon size={size} iconSize={iconSize} />
        )}
      </div>
      {verified ? <VerifiedDpBadge dpSize={size} /> : null}
    </div>
  );
}
