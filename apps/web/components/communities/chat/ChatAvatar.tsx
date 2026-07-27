"use client";

import { AvatarImg } from "@/components/ui/AvatarImg";

interface ChatAvatarProps {
  name: string;
  url: string | null;
  size?: number;
}

export function ChatAvatar({ name, url, size = 8 }: ChatAvatarProps) {
  const px = size * 4;

  // AvatarImg always renders something — either the stored avatar or a
  // deterministic boring-avatar generated from the user's name.
  return (
    <AvatarImg
      url={url}
      name={name}
      size={px}
      className={`rounded-full object-cover h-${size} w-${size} shrink-0`}
    />
  );
}
