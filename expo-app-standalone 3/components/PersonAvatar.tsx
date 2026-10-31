import React, { useEffect, useState } from 'react';
import { ImageStyle, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { avatarBackground, nameInitials } from '@/lib/avatar';
import { resolveProfilePictureUri } from '@/lib/profilePicture';

interface Props {
  name: string | null | undefined;
  url: string | null | undefined;
  size: number;
  /**
   * Renders the initials fallback as a circle (default). Pass false for square
   * frames that supply their own rounding.
   */
  rounded?: boolean;
  /** Extra frame styles (borders, shadows); callers may also override the bg. */
  style?: StyleProp<ViewStyle>;
}

/**
 * The single person-avatar renderer for the app — a port of the web's
 * `AvatarImg`: when there is no picture (or the stored one fails to load / is
 * a retired generated avatar) it renders the member's initials on the
 * deterministic design-system palette color, so every surface — header, chat,
 * cards, member lists, profile — shows the same fallback the web shows.
 */
export function PersonAvatar({ name, url, size, rounded = true, style }: Props) {
  const resolved = resolveProfilePictureUri(url);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [resolved]);

  const frame = { width: size, height: size, borderRadius: rounded ? size / 2 : 0 };

  if (resolved && !failed) {
    return (
      <Image
        source={{ uri: resolved }}
        // The frame props callers pass (borders) are valid on both style
        // kinds; the cast bridges RN's ImageStyle/ViewStyle split.
        style={[frame, style as StyleProp<ImageStyle>]}
        contentFit="cover"
        onError={() => setFailed(true)}
        accessibilityLabel={`${name ?? 'User'} profile picture`}
      />
    );
  }

  return (
    <View
      style={[styles.fallback, frame, { backgroundColor: avatarBackground(name) }, style]}
      accessibilityLabel={`${name ?? 'User'} profile picture placeholder`}
      accessibilityRole="image"
    >
      <Text style={[styles.initials, { fontSize: Math.max(10, Math.round(size * 0.38)) }]}>
        {nameInitials(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  // White on every palette color — the web's `text-white`, kept literal.
  initials: { color: '#FFFFFF', fontFamily: 'Geist_600SemiBold' },
});
