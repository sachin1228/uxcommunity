import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AccountMenuSheet } from '@/components/AccountMenuSheet';
import { BrandLogo } from '@/components/BrandLogo';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { resolveProfilePictureUri } from '@/lib/profilePicture';

export function AppHeader() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [avatarError, setAvatarError] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const avatarUrl = avatarError ? null : resolveProfilePictureUri(user?.avatar_url);
  const initials = user?.name
    ? user.name
        .split(' ')
        .slice(0, 2)
        .map((word: string) => word[0]?.toUpperCase() ?? '')
        .join('')
    : '?';

  return (
    <View
      style={[
        styles.header,
        {
          backgroundColor: colors.background,
          borderBottomColor: colors.border,
          paddingTop: insets.top + 8,
        },
      ]}
    >
      <View style={styles.brand}>
        <BrandLogo size={30} />
        <Text style={[styles.logo, { color: colors.foreground }]}>uxcommunity</Text>
      </View>

      {/* The avatar is the account menu's trigger — the touch version of the
          web topbar's profile dropdown (identity, View profile, Settings,
          Sign out). Notifications live in Settings; the header carries no
          duplicate shortcut. */}
      <View style={styles.actions}>
        <Pressable
          accessibilityLabel="Profile menu"
          accessibilityRole="button"
          hitSlop={6}
          onPress={() => setMenuOpen(true)}
          style={({ pressed }) => [
            styles.avatarButton,
            { borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          {avatarUrl ? (
            <Image
              accessibilityLabel={`${user?.name ?? 'User'} profile photo`}
              source={{ uri: avatarUrl }}
              style={[styles.avatarImage]}
              onError={() => setAvatarError(true)}
            />
          ) : (
            <View style={[styles.avatarFallback, { backgroundColor: colors.primary }]}>
              <Text style={[styles.avatarText, { color: colors.primaryForeground }]}>
                {initials}
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      <AccountMenuSheet open={menuOpen} onClose={() => setMenuOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logo: {
    fontSize: 18,
    fontFamily: 'Geist_700Bold',
    letterSpacing: -0.4,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 34,
    height: 34,
    borderRadius: 17,
    resizeMode: 'cover',
  },
  avatarFallback: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 13,
    fontFamily: 'Geist_600SemiBold',
  },
});
