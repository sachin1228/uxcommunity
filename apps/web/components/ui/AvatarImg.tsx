"use client";

import { useState } from "react";
import { avatarBackground, nameInitials } from "@/lib/avatar";

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

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={`${name}'s profile picture`}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => setFailedUrl(url)}
    />
  );
}
