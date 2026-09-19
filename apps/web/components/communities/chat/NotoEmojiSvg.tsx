"use client";

import { memo, useState } from "react";
import { emojiToCodepoint } from "@/lib/noto-emoji";

interface NotoEmojiSvgProps {
  /** The emoji character to render */
  emoji: string;
  /** Size in pixels (default: 22) */
  size?: number;
  /** Additional CSS classes */
  className?: string;
}

// Self-hosted SVGs vendored into public/emoji/svg (see lib/noto-emoji.ts).
const SVG_BASE = "/emoji/svg";

/**
 * Lightweight SVG-only emoji renderer.
 * Used in places where Lottie animation is not needed (sidebar, picker tabs, etc.)
 */
export const NotoEmojiSvg = memo(function NotoEmojiSvg({
  emoji,
  size = 22,
  className = "",
}: NotoEmojiSvgProps) {
  const codepoint = emojiToCodepoint(emoji);
  // Falls back to the system emoji glyph when the CDN SVG fails (blocked
  // network, GitHub rate limits) — previously the <img> just stayed broken
  // and left an empty gap where the emoji should be.
  const [failed, setFailed] = useState(false);
  if (!codepoint || failed) {
    return <span style={{ fontSize: size * 0.8 }}>{emoji}</span>;
  }

  return (
    <span
      className={`inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`${SVG_BASE}/emoji_u${codepoint}.svg`}
        alt={emoji}
        style={{ width: size, height: size }}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </span>
  );
});
