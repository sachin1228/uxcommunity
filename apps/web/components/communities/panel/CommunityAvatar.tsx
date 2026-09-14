"use client";

import { CommunityDp } from "../CommunityDp";

interface CommunityAvatarProps {
  imageUrl: string | null;
  name: string;
  type: string;
  lottieUrl?: string | null;
  lottieFormat?: unknown;
  lottieData?: unknown;
}

export function CommunityAvatar({
  imageUrl,
  name,
  type,
}: CommunityAvatarProps) {
  return (
    <CommunityDp
      imageUrl={imageUrl}
      name={name}
      size={36}
      className="bg-surface-raised"
    />
  );
}