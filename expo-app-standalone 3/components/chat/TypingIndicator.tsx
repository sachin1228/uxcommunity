import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { TypingUser, typingLabelFor } from '@/hooks/useTypingPresence';

function Dot({ delay, active, color }: { delay: number; active: boolean; color: string }) {
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(value, {
          toValue: 1,
          duration: 300,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(value, {
          toValue: 0,
          duration: 300,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay(300),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, delay, value]);

  return (
    <Animated.View
      style={[
        styles.dot,
        { backgroundColor: color, transform: [{ translateY: Animated.multiply(value, -4) }] },
      ]}
    />
  );
}

/**
 * Typing row above the composer — mirrors the web indicator: a bouncing-dots
 * pill, the "X is typing…" label, and stacked avatars once more than one
 * person is typing.
 */
export function TypingIndicator({ users }: { users: TypingUser[] }) {
  const colors = useColors();
  const label = typingLabelFor(users);
  if (users.length === 0 || !label) return null;

  const multiple = users.length > 1;

  return (
    <View style={styles.row} accessibilityLiveRegion="polite">
      <View style={[styles.pill, { backgroundColor: colors.surfaceRaised }]}>
        <Dot delay={0} active color={colors.foreground} />
        <Dot delay={150} active color={colors.foreground} />
        <Dot delay={300} active color={colors.foreground} />
      </View>

      <Text style={[styles.label, { color: colors.mutedForeground }]} numberOfLines={1}>
        {label}
      </Text>

      {multiple && (
        <View style={styles.avatarStack}>
          {users.slice(0, 6).map((u, i) => (
            <StackedAvatar key={u.id} user={u} index={i} borderColor={colors.subtle} />
          ))}
        </View>
      )}
    </View>
  );
}

function StackedAvatar({
  user,
  index,
  borderColor,
}: {
  user: TypingUser;
  index: number;
  borderColor: string;
}) {
  const colors = useColors();
  const letters = user.name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <View
      style={[
        styles.stackedAvatar,
        {
          backgroundColor: colors.surfaceRaised,
          borderColor,
          marginLeft: index === 0 ? 0 : -6,
          zIndex: index,
        },
      ]}
    >
      <Text style={[styles.stackedAvatarText, { color: colors.mutedForeground }]}>{letters}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 4,
    minHeight: 24,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 5,
    flexShrink: 0,
  },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  label: { fontSize: 11, fontFamily: 'Geist_400Regular', flexShrink: 1 },
  avatarStack: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  stackedAvatar: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  stackedAvatarText: { fontSize: 7, fontFamily: 'Geist_600SemiBold' },
});
