"use client";

import { CommunityDp, type LottieFormat } from "../CommunityDp";

interface CommunityAvatarProps {
  imageUrl: string | null;
  name: string;
  type: string;
  lottieUrl?: string | null;
  lottieFormat?: LottieFormat | null;
  lottieData?: unknown;
}

export function CommunityAvatar({
  imageUrl,
  name,
  type,
  lottieUrl,
  lottieFormat,
  lottieData,
}: CommunityAvatarProps) {
  return (
    <CommunityDp
      imageUrl={imageUrl}
      lottieUrl={lottieUrl}
      lottieFormat={lottieFormat}
      lottieData={lottieData}
      name={name}
      size={36}
      className="bg-surface-raised"
    />
  );
}