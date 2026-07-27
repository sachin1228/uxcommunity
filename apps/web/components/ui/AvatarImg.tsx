"use client";

/**
 * AvatarImg — renders any stored avatar_url:
 *
 *   boring://{style}/{encodedSeed}  →  inline SVG via boring-avatars npm
 *                                      package (zero CDN dependency)
 *   https://...                     →  plain <img> tag
 *   https://source.boringavatars.com/... → local boring-avatars rendering
 *   null / undefined                →  deterministic boring-avatar from name
 *                                      (every user gets a unique avatar)
 *
 * Always use this component instead of raw <img> so the boring:// protocol
 * is handled everywhere automatically.
 */

import Avatar from "boring-avatars";

const BORING_STYLES = [
  "marble", "beam", "pixel", "sunset", "ring", "bauhaus", "geometric", "abstract",
] as const;

/**
 * DiceBear styles that are visually unmistakable even at 28 px:
 * robots, emoji faces, pixel-art characters, sketch faces, doodle heads.
 */
const DICEBEAR_STYLES = [
  "bottts", "fun-emoji", "pixel-art", "lorelei", "micah",
  "croodles", "adventurer", "notionists",
] as const;

/** Deterministic hash → index, used for both style pickers. */
function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return h;
}

function boringStyleForName(name: string): typeof BORING_STYLES[number] {
  return BORING_STYLES[hashName(name) % BORING_STYLES.length];
}

function dicebearUrlForSeed(seed: string): string {
  const style = DICEBEAR_STYLES[hashName(seed) % DICEBEAR_STYLES.length];
  return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}`;
}

interface AvatarImgProps {
  /** The avatar_url from the database. May be null/undefined. */
  url: string | null | undefined;
  /** Name used as the seed for the generated fallback avatar (and as fallback
   *  seed when the URL does not embed one). */
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
  // No URL — generate a deterministic unique avatar from the user's name.
  // Style is picked from the full set so adjacent users look clearly distinct.
  if (!url) {
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
        className={className}
      >
        <Avatar size={size} name={name} variant={boringStyleForName(name)} />
      </span>
    );
  }

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

  // Legacy k6 seeder URLs pointed at source.boringavatars.com/beam with a
  // fixed 5-color palette — all users ended up looking like the same teal
  // circle. Re-render locally as a DiceBear character instead: robots,
  // emoji faces, pixel-art, etc. are unmistakably different at any size.
  if (url.startsWith("https://source.boringavatars.com/")) {
    try {
      const parsed = new URL(url);
      const [, , , encodedSeed] = parsed.pathname.split("/");
      const seed = encodedSeed ? decodeURIComponent(encodedSeed) : name;
      if (seed) {
        // eslint-disable-next-line @next/next/no-img-element
        return (
          <img
            src={dicebearUrlForSeed(seed)}
            alt="Avatar"
            width={size}
            height={size}
            className={className}
            style={{ borderRadius: "50%", objectFit: "cover" }}
          />
        );
      }
    } catch {
      // Fall through to the normal image renderer for malformed legacy URLs.
    }
  }

  // Standard URL (DiceBear, Robohash, Avataaars, uploaded file)
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
