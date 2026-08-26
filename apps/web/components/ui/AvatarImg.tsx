"use client";

import { useState } from "react";

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

function initialsForName(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return initials || "U";
}

interface AvatarImgProps {
  url: string | null | undefined;
  name?: string;
  size?: number;
  className?: string;
}

export function AvatarImg({
  url,
  name = "User",
  size = 40,
  className,
}: AvatarImgProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!url || failedUrl === url || isGeneratedProfilePicture(url)) {
    return (
      <span
        role="img"
        aria-label={`${name}'s profile picture placeholder`}
        className={`inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-body font-semibold text-accent ${className ?? ""}`}
        style={{ width: size, height: size, fontSize: Math.max(12, Math.round(size * 0.35)) }}
      >
        {initialsForName(name)}
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
      className={className}
      onError={() => setFailedUrl(url)}
    />
  );
}
