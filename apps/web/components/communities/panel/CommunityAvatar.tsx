"use client";

import { useState } from "react";
import { CommunityIcon } from "../CommunityIcon";

interface CommunityAvatarProps {
  imageUrl: string | null;
  name: string;
  type: string;
}

export function CommunityAvatar({ imageUrl, name, type }: CommunityAvatarProps) {
  const [failed, setFailed] = useState(false);

  if (imageUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={name}
        width={36}
        height={36}
        loading="lazy"
        decoding="async"
        className="size-9 shrink-0 rounded-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }

  return <CommunityIcon size={36} className="bg-surface-raised" />;
}
