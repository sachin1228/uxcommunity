import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';

/**
 * The shared heart used by every like button (threads, resources, events,
 * showcase) — a React Native port of `apps/web/components/communities/HeartIcon.tsx`.
 *
 * Same 16×16 path, same semantics: the outline is `currentColor`, and the liked
 * heart is filled with the design system's like pink (`--like`, #F91880) —
 * stroke and fill both — which is what makes a liked card read the same on both
 * clients. Feather has no filled heart, so the SVG is drawn directly
 * (`react-native-svg` is already a dependency).
 *
 * A false → true flip plays the web's quick pop (1 → 1.32 → 0.94 → 1); it never
 * fires on mount, and it is skipped when the OS asks for reduced motion.
 */

export const LIKE_PINK = '#F91880';

export function HeartIcon({
  size = 16,
  active = false,
  color,
  strokeWidth = 1.5,
}: {
  size?: number;
  /** Liked state — fills the heart with the like pink and pops it. */
  active?: boolean;
  /** Outline colour when not liked (defaults to the muted foreground). */
  color?: string;
  strokeWidth?: number;
}) {
  const colors = useColors();
  const tint = active ? colors.like ?? LIKE_PINK : color ?? colors.foregroundSubtle;
  const scale = useRef(new Animated.Value(1)).current;
  const wasActive = useRef(active);
  const reduceMotion = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => { reduceMotion.current = enabled; })
      .catch(() => { /* assume motion is fine */ });
  }, []);

  useEffect(() => {
    // Only on a real false → true transition, never on first render.
    if (!active || wasActive.current || reduceMotion.current) {
      wasActive.current = active;
      return;
    }
    wasActive.current = active;
    scale.setValue(1);
    Animated.sequence([
      Animated.timing(scale, { toValue: 1.32, duration: 140, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 0.94, duration: 140, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 140, useNativeDriver: true }),
    ]).start();
  }, [active, scale]);

  return (
    <Animated.View style={[styles.wrap, { width: size, height: size, transform: [{ scale }] }]}>
      <Svg width={size} height={size} viewBox="0 0 16 16">
        <Path
          d="M 4.706 1.75 C 6.455 1.75 7.681 2.984 8 4.645 C 8.319 2.984 9.545 1.75 11.294 1.75 C 13.341 1.75 15 3.44 15 5.524 C 15 11.802 8 14.75 8 14.75 L 8 14.75 L 8 14.75 C 8 14.75 1 11.802 1 5.524 C 1 3.44 2.659 1.75 4.706 1.75 Z"
          stroke={tint}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={active ? tint : 'none'}
        />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});
