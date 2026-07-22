"use client";

import { useState } from "react";

const TYPE_EMOJI: Record<string, string> = {
  city:             "📍",
  sector:           "🏢",
  interest:         "✦",
  company:          "🏬",
  experience_level: "🎯",
};

interface CommunityAvatarProps {
  imageUrl: string | null;
  name: string;
  type: string;
  active: boolean;
}

export function CommunityAvatar({ imageUrl, name, type, active }: CommunityAvatarProps) {
  const [failed, setFailed] = useState(false);
  const fallback = TYPE_EMOJI[type] ?? "💬";

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
        className="h-10 w-10 rounded-full object-cover shrink-0"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 text-lg font-medium select-none ${
        active ? "bg-accent/20" : "bg-surface-raised"
      }`}
    >
      {fallback}
    </div>
  );
}
