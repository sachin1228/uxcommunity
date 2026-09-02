"use client";

import { useState, useEffect, useCallback, memo } from "react";
import Lottie from "lottie-react";
import { emojiToCodepoint, getEmojiPngUrl } from "@/lib/noto-emoji";

interface AnimatedEmojiProps {
  /** The emoji character to render */
  emoji: string;
  /** Size in pixels (default: 22) */
  size?: number;
  /** Additional CSS classes */
  className?: string;
  /** Whether to play animation on hover only */
  hoverOnly?: boolean;
  /** Whether to disable animation (show static PNG) */
  disableAnimation?: boolean;
}

// Cache for Lottie animation data
const lottieCache = new Map<string, unknown>();

/**
 * Renders an animated Noto emoji using Lottie animations.
 * Falls back to PNG if Lottie fails to load.
 */
export const AnimatedEmoji = memo(function AnimatedEmoji({
  emoji,
  size = 22,
  className = "",
  hoverOnly = false,
  disableAnimation = false,
}: AnimatedEmojiProps) {
  const [animationData, setAnimationData] = useState<unknown | null>(null);
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);

  const codepoint = emojiToCodepoint(emoji);

  // Load animation data
  const loadAnimation = useCallback(async () => {
    if (!codepoint || disableAnimation) return;
    
    // Check cache first
    if (lottieCache.has(codepoint)) {
      setAnimationData(lottieCache.get(codepoint));
      return;
    }

    setIsLoading(true);
    try {
      const url = `https://fonts.gstatic.com/s/e/notoemoji/latest/${codepoint}/lottie.json`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch Lottie animation: ${response.status}`);
      }
      
      const data = await response.json();
      lottieCache.set(codepoint, data);
      setAnimationData(data);
    } catch (err) {
      console.warn(`Failed to load Lottie animation for ${emoji}:`, err);
      setError(true);
      // Fallback to PNG
      try {
        const url = await getEmojiPngUrl(emoji);
        if (url) setPngUrl(url);
      } catch {
        // PNG fallback also failed
      }
    } finally {
      setIsLoading(false);
    }
  }, [codepoint, emoji, disableAnimation]);

  // Load PNG for fallback or initial state
  const loadPng = useCallback(async () => {
    if (!codepoint) return;
    
    try {
      const url = await getEmojiPngUrl(emoji);
      if (url) setPngUrl(url);
    } catch {
      // PNG load failed
    }
  }, [codepoint, emoji]);

  useEffect(() => {
    loadPng();
    
    if (!hoverOnly || disableAnimation) {
      loadAnimation();
    }
  }, [loadPng, loadAnimation, hoverOnly, disableAnimation]);

  const handleMouseEnter = () => {
    setIsHovered(true);
    if (hoverOnly && !animationData && !isLoading) {
      loadAnimation();
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  // Show loading state
  if (isLoading && !animationData && !pngUrl) {
    return (
      <span
        className={`inline-flex items-center justify-center ${className}`}
        style={{ width: size, height: size }}
      >
        <span className="text-foreground-muted animate-pulse" style={{ fontSize: size * 0.8 }}>
          {emoji}
        </span>
      </span>
    );
  }

  // Show error state - just render the emoji text
  if (error && !animationData && !pngUrl) {
    return (
      <span
        className={`inline-flex items-center justify-center ${className}`}
        style={{ width: size, height: size }}
      >
        <span style={{ fontSize: size * 0.8 }}>{emoji}</span>
      </span>
    );
  }

  // Show Lottie animation if available and not in hover-only mode (or if hovered)
  if (animationData && (!hoverOnly || isHovered)) {
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
          loop={isHovered}
          autoplay={isHovered}
        />
      </span>
    );
  }

  // Show PNG fallback if available
  if (pngUrl) {
    return (
      <span
        className={`inline-flex items-center justify-center ${className}`}
        style={{ width: size, height: size }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={pngUrl}
          alt={emoji}
          style={{ width: size, height: size }}
          loading="lazy"
        />
      </span>
    );
  }

  // Final fallback - just render the emoji text
  return (
    <span
      className={`inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span style={{ fontSize: size * 0.8 }}>{emoji}</span>
    </span>
  );
});
