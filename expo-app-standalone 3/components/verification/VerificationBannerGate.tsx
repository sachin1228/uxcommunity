import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  SafeAreaInsetsContext,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

/**
 * The persistent read-only notice, above every screen.
 *
 * The banner owns the status-bar inset: while it is visible the nested
 * `SafeAreaInsetsContext` reports `top: 0`, so each screen's own header does
 * not add the inset a second time.
 */
export function VerificationBannerGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const router = useRouter();

  const show = user?.role === 'user' && user.verificationBannerVisible === true;

  if (!show) return <>{children}</>;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={{
          paddingTop: insets.top,
          backgroundColor: colors.card,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        }}
      >
        <View style={styles.row}>
          <Feather name="lock" size={15} color={colors.mutedForeground} />
          <Text style={[styles.message, { color: colors.foreground }]}>
            Your account is currently read-only. Verify your profile to unlock all features.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/settings/verification')}
            style={({ pressed }) => [
              styles.cta,
              { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={[styles.ctaText, { color: colors.primaryForeground }]}>
              Verify yourself
            </Text>
          </Pressable>
        </View>
      </View>

      <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
        <View style={{ flex: 1 }}>{children}</View>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  message: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: 'Geist_400Regular',
  },
  cta: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  ctaText: {
    fontSize: 11,
    fontFamily: 'Geist_500Medium',
  },
});
