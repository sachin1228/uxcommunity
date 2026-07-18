"use client";

/**
 * AvatarImg — renders any stored avatar_url:
 *
 *   boring://{style}/{encodedSeed}  →  inline SVG via boring-avatars npm
 *                                      package (zero CDN dependency)
 *   https://...                     →  plain <img> tag
 *
 * Always use this component instead of raw <img> so the boring:// protocol
 * is handled everywhere automatically.
 */

import Avatar from "boring-avatars";

interface AvatarImgProps {
  /** The avatar_url from the database. May be null/undefined. */
  url: string | null | undefined;
  /** Fallback name used to seed the boring-avatars component if the seed
   *  is not embedded in the URL (rare edge case). */
  name?: string;
  size?: number;
  className?: string;
}

export function AvatarImg({
  url,
  name = "designer",
  size = 40,
  className,
}: AvatarImgProps) {
  if (!url) return null;

  if (url.startsWith("boring://")) {
    const rest = url.slice("boring://".length);
    const slashIdx = rest.indexOf("/");
    const style = slashIdx >= 0 ? rest.slice(0, slashIdx) : rest;
    const seed =
      slashIdx >= 0 ? decodeURIComponent(rest.slice(slashIdx + 1)) : name;

    return (
      <span
        style={{
          width: size,
          height: size,
          display: "inline-flex",
          borderRadius: "50%",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <Avatar size={size} name={seed} variant={style as "marble"} />
      </span>
    );
  }

  // Standard URL (DiceBear, Robohash, uploaded file)
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={url}
      alt="Avatar"
      width={size}
      height={size}
      className={className}
    />
  );
}
