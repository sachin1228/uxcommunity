"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/shadcn/avatar";
import { cn } from "@/lib/utils";

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
  return (
    <Avatar className={cn("shrink-0", className)} style={{ width: size, height: size }}>
      <AvatarImage src={url && !isGeneratedProfilePicture(url) ? url : undefined} alt={`${name}'s profile picture`} className="object-cover" />
      <AvatarFallback role="img" aria-label={`${name}'s profile picture placeholder`} style={{ fontSize: Math.max(12, Math.round(size * 0.35)) }}>
        {initialsForName(name)}
      </AvatarFallback>
    </Avatar>
  );
}
