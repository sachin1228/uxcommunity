"use client";

import { useState } from "react";
import { CommunityIcon } from "../CommunityIcon";

interface CommunityAvatarProps {
  imageUrl: string | null;
  name: string;
  type: string;
  active: boolean;
}

export function CommunityAvatar({ imageUrl, name, type, active }: CommunityAvatarProps) {
  const [failed, setFailed] = useState(false);

  if (imageUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={name}
        width={40}
        height={40}
        loading="lazy"
        decoding="async"
        className="h-11 w-11 rounded-full object-cover shrink-0"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <CommunityIcon
      size={40}
      className={active ? "bg-accent/20" : "bg-surface-raised"}
    />
  );
}
