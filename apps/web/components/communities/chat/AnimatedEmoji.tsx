"use client";

import { useState, useEffect, useRef, memo } from "react";
import Lottie, { type LottieRefCurrentProps } from "lottie-react";
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

// Cache for Lottie animation data (shared across all instances)
const lottieCache = new Map<string, unknown>();
// Track failed codepoints to avoid retrying
const failedCodepoints = new Set<string>();

/** Extra pixels around the viewport where an emoji counts as "visible". */
const VISIBILITY_ROOT_MARGIN = "200px";

/**
 * Renders an animated Noto emoji using Lottie animations.
 * Falls back to SVG image if Lottie fails to load.
 *
 * Animations only run while the emoji is (near) the viewport. Offscreen
 * instances are paused instead of playing 60fps forever — in a message list
 * only a handful of bubbles are on screen at once, and pausing the rest drops
 * the constant CPU/battery cost of dozens of looping Lottie animations. The
 * Lottie JSON for an offscreen emoji is also not fetched until it scrolls
 * into view (the static SVG fallback renders meanwhile), matching the
 * existing hoverOnly deferral pattern.
 */
export const AnimatedEmoji = memo(function AnimatedEmoji({
  emoji,
  size = 22,
  className = "",
  hoverOnly = false,
}: AnimatedEmojiProps) {
  const [animationData, setAnimationData] = useState<unknown | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  // Default to visible so the first paint isn't frozen waiting for the
  // observer; the observer corrects this immediately after mount.
  const [isVisible, setIsVisible] = useState(true);
  const spanRef = useRef<HTMLSpanElement>(null);
  const lottieRef = useRef<LottieRefCurrentProps | null>(null);

  const codepoint = emojiToCodepoint(emoji);

  // Track viewport visibility so offscreen animations can be paused.
  useEffect(() => {
    const el = spanRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        setIsVisible(entries[0]?.isIntersecting ?? true);
      },
      { rootMargin: VISIBILITY_ROOT_MARGIN },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Load animation data (only when it would actually play: hoverOnly gates on
  // hover, everything else gates on viewport visibility).
  useEffect(() => {
    if (!codepoint) return;
    if (failedCodepoints.has(codepoint)) return;
    if (!isVisible) return;
    if (hoverOnly && !isHovered) return;

    // Check cache first
    if (lottieCache.has(codepoint)) {
      setAnimationData(lottieCache.get(codepoint));
      return;
    }

    const loadAnimation = async () => {
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
      }
    };

    loadAnimation();
  }, [codepoint, hoverOnly, isHovered, isVisible]);

  const shouldPlay = hoverOnly ? isHovered : isVisible;

  // Pause/resume playback when visibility (or hover) changes. The autoplay
  // prop only controls the initial state — a running animation needs an
  // explicit pause() to stop it, and loop is kept constant so toggling
  // visibility never destroys/recreates the animation instance.
  useEffect(() => {
    const lottie = lottieRef.current;
    if (!lottie) return;
    if (shouldPlay) {
      lottie.play();
    } else {
      lottie.pause();
    }
  }, [shouldPlay]);

  return (
    <span
      ref={spanRef}
      className={`inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {animationData ? (
        <Lottie
          lottieRef={lottieRef}
          animationData={animationData}
          style={{ width: size, height: size }}
          loop
          autoplay={shouldPlay}
        />
      ) : (
        // Fallback to SVG image (not system font)
        <NotoEmojiSvg
          emoji={emoji}
          size={size}
          className={className}
        />
      )}
    </span>
  );
});