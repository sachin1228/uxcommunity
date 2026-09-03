"use client";

import { memo } from "react";
// import { useState, useEffect } from "react"; // Commented out - activate later if needed
// import Lottie from "lottie-react"; // Commented out - activate later if needed
import { emojiToCodepoint } from "@/lib/noto-emoji";
import { NotoEmojiSvg } from "./NotoEmojiSvg";

interface AnimatedEmojiProps {
  /** The emoji character to render */
  emoji: string;
  /** Size in pixels (default: 22) */
  size?: number;
  /** Additional CSS classes */
  className?: string;
  /** Whether to play animation on hover only */
  hoverOnly?: boolean;
}

// Cache for Lottie animation data (shared across all instances) - commented out
// const lottieCache = new Map<string, unknown>();
// Track failed codepoints to avoid retrying - commented out
// const failedCodepoints = new Set<string>();

/**
 * Renders an animated Noto emoji using Lottie animations.
 * Falls back to SVG image if Lottie fails to load.
 */
export const AnimatedEmoji = memo(function AnimatedEmoji({
  emoji,
  size = 22,
  className = "",
  hoverOnly = false,
}: AnimatedEmojiProps) {
  // Lottie commented out - just show SVG directly
  // const [animationData, setAnimationData] = useState<unknown | null>(null);
  // const [isHovered, setIsHovered] = useState(false);

  const codepoint = emojiToCodepoint(emoji);

  // Lottie fetch commented out - activate later if needed
  // useEffect(() => {
  //   if (!codepoint) return;
  //   if (failedCodepoints.has(codepoint)) return;
  //   if (lottieCache.has(codepoint)) {
  //     setAnimationData(lottieCache.get(codepoint));
  //     return;
  //   }
  //   if (hoverOnly && !isHovered) return;
  //   const loadAnimation = async () => {
  //     try {
  //       const url = `https://fonts.gstatic.com/s/e/notoemoji/latest/${codepoint}/lottie.json`;
  //       const response = await fetch(url);
  //       if (!response.ok) {
  //         failedCodepoints.add(codepoint);
  //         return;
  //       }
  //       const data = await response.json();
  //       lottieCache.set(codepoint, data);
  //       setAnimationData(data);
  //     } catch {
  //       failedCodepoints.add(codepoint);
  //     }
  //   };
  //   loadAnimation();
  // }, [codepoint, hoverOnly, isHovered]);

  // Lottie commented out - show SVG directly
  // if (animationData) {
  //   return (
  //     <span
  //       className={`inline-flex items-center justify-center ${className}`}
  //       style={{ width: size, height: size }}
  //       onMouseEnter={() => setIsHovered(true)}
  //       onMouseLeave={() => setIsHovered(false)}
  //     >
  //       <Lottie
  //         animationData={animationData}
  //         style={{ width: size, height: size }}
  //         loop={hoverOnly ? isHovered : true}
  //         autoplay={hoverOnly ? isHovered : true}
  //       />
  //     </span>
  //   );
  // }

  // SVG image (not system font)
  return (
    <NotoEmojiSvg
      emoji={emoji}
      size={size}
      className={className}
    />
  );
});
