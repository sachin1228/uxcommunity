"use client";

import { useState, useEffect, useCallback, memo } from "react";
import Lottie from "lottie-react";
import { emojiToCodepoint } from "@/lib/noto-emoji";

interface AnimatedEmojiProps {
  /** The emoji character to render */
  emoji: string;
  /** Size in pixels (default: 22) */
  size?: number;
  /** Additional CSS classes */
  className?: string;
  /** Whether to play animation on hover only */
  hoverOnly?: boolean;
  /** Whether to disable animation (show static emoji) */
  disableAnimation?: boolean;
}

// Cache for Lottie animation data (shared across all instances)
const lottieCache = new Map<string, unknown>();
// Track failed codepoints to avoid retrying
const failedCodepoints = new Set<string>();

/**
 * Renders an animated Noto emoji using Lottie animations.
 * Lottie JSON (~37KB) is 10x smaller than animated WebP (~369KB).
 */
export const AnimatedEmoji = memo(function AnimatedEmoji({
  emoji,
  size = 22,
  className = "",
  hoverOnly = false,
  disableAnimation = false,
}: AnimatedEmojiProps) {
  const [animationData, setAnimationData] = useState<unknown | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const codepoint = emojiToCodepoint(emoji);

  // Load animation data
  useEffect(() => {
    if (!codepoint || disableAnimation) return;
    if (failedCodepoints.has(codepoint)) return;
    
    // Check cache first
    if (lottieCache.has(codepoint)) {
      setAnimationData(lottieCache.get(codepoint));
      return;
    }

    // Don't fetch if hoverOnly and not hovered
    if (hoverOnly && !isHovered) return;

    const loadAnimation = async () => {
      setIsLoading(true);
      try {
        const url = `https://fonts.gstatic.com/s/e/notoemoji/latest/${codepoint}/lottie.json`;
        const response = await fetch(url);
        
        if (!response.ok) {
          failedCodepoints.add(codepoint);
          return;
        }
        
        const data = await response.json();
        lottieCache.set(codepoint, data);
        setAnimationData(data);
      } catch {
        failedCodepoints.add(codepoint);
      } finally {
        setIsLoading(false);
      }
    };

    loadAnimation();
  }, [codepoint, disableAnimation, hoverOnly, isHovered]);

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  // Show Lottie animation if loaded
  if (animationData) {
    return (
      <span
        className={`inline-flex items-center justify-center ${className}`}
        style={{ width: size, height: size }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <Lottie
          animationData={animationData}
          style={{ width: size, height: size }}
          loop={hoverOnly ? isHovered : true}
          autoplay={hoverOnly ? isHovered : true}
        />
      </span>
    );
  }

  // Fallback to emoji character (no image fetching needed)
  return (
    <span
      className={`inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.8 }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {emoji}
    </span>
  );
});
