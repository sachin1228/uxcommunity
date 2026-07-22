"use client";

import Avatar from "boring-avatars";
import type { AvatarOption } from "@/lib/avatar";

/**
 * Renders a single avatar option — inline SVG for boring-avatars, <img> for
 * all URL-based sources (DiceBear, Robohash, Avataaars, Multiavatar).
 */
export function AvatarPreview({
  option,
  size = 56,
}: {
  option: AvatarOption;
  size?: number;
}) {
  if (option.source === "boring-avatars") {
    return (
      <span
        style={{
          width: size,
          height: size,
          display: "inline-flex",
          borderRadius: "50%",
          overflow: "hidden",
        }}
      >
        <Avatar size={size} name={option.seed} variant={option.style as "marble"} />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={option.dbUrl}
      alt={option.label}
      width={size}
      height={size}
      className="rounded-full object-cover bg-overlay-elevated"
      loading="lazy"
    />
  );
}
