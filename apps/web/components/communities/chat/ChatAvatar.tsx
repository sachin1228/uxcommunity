"use client";

import { AvatarImg } from "@/components/ui/AvatarImg";

interface ChatAvatarProps {
  name: string;
  url: string | null;
  size?: number;
}

export function ChatAvatar({ name, url, size = 8 }: ChatAvatarProps) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const px = size * 4;

  if (url) {
    return (
      <AvatarImg
        url={url}
        name={name}
        size={px}
        className={`rounded-full object-cover h-${size} w-${size} shrink-0`}
      />
    );
  }

  return (
    <div
      className={`h-${size} w-${size} shrink-0 rounded-full bg-accent/20 flex items-center justify-center font-body text-xs font-semibold text-accent select-none`}
    >
      {initials}
    </div>
  );
}
