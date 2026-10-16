import React, { useEffect, useState } from 'react';
import { Image, ImageStyle, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

/**
 * The company's mark: stored logo or domain favicon, with an initial tile as
 * the last-resort fallback — decoration, never proof (same rule as the web's
 * CompanyLogo; the verified domain beside the name is the trust signal).
 */
export function CompanyMark({
  name,
  logoUrl,
  size = 34,
  style,
}: {
  name: string;
  logoUrl?: string | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [logoUrl]);

  const frame = { width: size, height: size, borderRadius: Math.max(4, Math.round(size * 0.23)) };

  if (logoUrl && !failed) {
    return (
      <Image
        source={{ uri: logoUrl }}
        // Border/rounding styles callers pass are valid on both style kinds;
        // the cast bridges RN's ImageStyle/ViewStyle split.
        style={[frame, style as StyleProp<ImageStyle>]}
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
      />
    );
  }

  return (
    <View style={[styles.tile, frame, { backgroundColor: colors.surfaceRaised }, style]}>
      <Text style={[styles.initial, { color: colors.mutedForeground, fontSize: Math.max(9, Math.round(size * 0.42)) }]}>
        {name[0]?.toUpperCase() ?? '?'}
      </Text>
    </View>
  );
}

/**
 * The verified mark beside a proven domain — the web's BadgeCheck, drawn with
 * the app's Feather vocabulary. Only shown when the domain was proven by a
 * work email (the server's `domainVerified`), never for a mere hint.
 */
export function CompanyVerifiedMark({ size = 11, color }: { size?: number; color: string }) {
  return <Feather name="check-circle" size={size} color={color} />;
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center' },
  initial: { fontFamily: 'Geist_600SemiBold' },
});
