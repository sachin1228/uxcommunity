"use client";

import { memo } from "react";
import { emojiToCodepoint } from "@/lib/noto-emoji";

interface NotoEmojiSvgProps {
  /** The emoji character to render */
  emoji: string;
  /** Size in pixels (default: 22) */
  size?: number;
  /** Additional CSS classes */
  className?: string;
}

const SVG_BASE = "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/svg";

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
  if (!codepoint) return <span style={{ fontSize: size * 0.8 }}>{emoji}</span>;

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
      />
    </span>
  );
});
