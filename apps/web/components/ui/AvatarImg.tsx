"use client";

import { useState } from "react";
import Image from "next/image";
import { avatarBackground, nameInitials } from "@/lib/avatar";
import { isOptimizableImageUrl } from "@/lib/images/remote-image";

const GENERATED_PROFILE_PICTURE_PATTERNS = [
  /^boring:\/\//i,
  /^https:\/\/(?:[^/]+\.)?dicebear\.com\//i,
  /^https:\/\/(?:[^/]+\.)?robohash\.org\//i,
  /^https:\/\/(?:[^/]+\.)?(?:api\.)?avataaars\.io\//i,
  /^https:\/\/(?:[^/]+\.)?multiavatar\.com\//i,
  /^https:\/\/source\.boringavatars\.com\//i,
];

export function isGeneratedProfilePicture(url: string | null | undefined): boolean {
  return Boolean(url && GENERATED_PROFILE_PICTURE_PATTERNS.some((pattern) => pattern.test(url)));
}

interface AvatarImgProps {
  url: string | null | undefined;
  name?: string;
  size?: number;
  className?: string;
  /**
   * Renders the initials fallback as a circle (default). Pass false for square
   * frames (e.g. the profile polaroid) that supply their own rounding.
   */
  rounded?: boolean;
  /** Above-the-fold avatars (profile hero, topbar) load eagerly. */
  priority?: boolean;
}

/**
 * The single avatar renderer for the whole app. When there is no picture (or
 * the stored one fails to load / is a retired generated avatar) it renders the
 * member's initials on a deterministic color, so every surface — chat, cards,
 * member lists, sidebars, admin — shows the same fallback.
 */
export function AvatarImg({
  url,
  name = "User",
  size = 40,
  className,
  rounded = true,
  priority = false,
}: AvatarImgProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!url || failedUrl === url || isGeneratedProfilePicture(url)) {
    return (
      <span
        role="img"
        aria-label={`${name}'s profile picture placeholder`}
        className={`inline-flex shrink-0 select-none items-center justify-center overflow-hidden font-body font-semibold text-white ${
          rounded ? "rounded-full" : ""
        } ${className ?? ""}`}
        style={{
          width: size,
          height: size,
          backgroundColor: avatarBackground(name),
          fontSize: Math.max(10, Math.round(size * 0.38)),
        }}
      >
        {nameInitials(name)}
      </span>
    );
  }

  // `aspect-square` is load-bearing, not decoration. Preflight sets
  // `img { height: auto }`, which overrides the height *attribute*, so a
  // portrait photo rendered at a fixed width grows taller than it is wide —
  // and `rounded-full` on a non-square box draws an *ellipse*, not a circle.
  // aspect-ratio only applies while the height is otherwise auto, so callers
  // that size themselves (`h-9 w-9`, `h-full w-full`) are unaffected.
  const imageClassName = `aspect-square ${className ?? ""}`;

  // An avatar is almost always much larger than the box it is painted in.
  // Asking the optimizer for exactly this width means a 24px sidebar face
  // downloads a ~48px file instead of the full 400px upload; the variant is
  // cached at the edge. Unknown hosts keep the plain tag.
  if (isOptimizableImageUrl(url)) {
    return (
      <Image
        src={url}
        alt={`${name}'s profile picture`}
        width={size}
        height={size}
        sizes={`${size}px`}
        priority={priority}
        className={imageClassName}
        onError={() => setFailedUrl(url)}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={`${name}'s profile picture`}
      width={size}
      height={size}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      className={imageClassName}
      onError={() => setFailedUrl(url)}
    />
  );
}
