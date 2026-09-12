"use client";

import { AvatarImg } from "@/components/ui/AvatarImg";

interface Props {
  url?: string | null;
  name: string;
}

export function AvatarThumb({ url, name }: Props) {
  return (
    <AvatarImg
      url={url}
      name={name}
      size={28}
      className="h-7 w-7 shrink-0 rounded-full object-cover"
    />
  );
}
