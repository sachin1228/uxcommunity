"use client";

import { AvatarImg } from "@/components/ui/AvatarImg";

interface Props {
  url?: string | null;
  name: string;
}

export function AvatarThumb({ url, name }: Props) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  if (!url) {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-raised font-body text-[10px] font-medium text-foreground-muted select-none">
        {initials}
      </span>
    );
  }

  return (
    <span className="h-7 w-7 shrink-0 rounded-full overflow-hidden flex items-center justify-center bg-surface-raised">
      <AvatarImg url={url} name={name} size={28} className="h-7 w-7 rounded-full object-cover" />
    </span>
  );
}
