import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { BrandLogo } from '@/components/BrandLogo';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { resolveProfilePictureUri } from '@/lib/profilePicture';

export function AppHeader() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const router = useRouter();
  const [avatarError, setAvatarError] = useState(false);
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
          backgroundColor: colors.subtle,
          borderBottomColor: colors.border,
          paddingTop: insets.top + 8,
        },
      ]}
    >
      <View style={styles.brand}>
        <BrandLogo size={30} />
        <Text style={[styles.logo, { color: colors.foreground }]}>uxcommunity</Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityLabel="Explore"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.push('/(tabs)/explore')}
          style={({ pressed }) => [
            styles.iconButton,
            { backgroundColor: pressed ? colors.background : 'transparent' },
          ]}
        >
          <Feather name="compass" size={22} color={colors.mutedForeground} />
        </Pressable>

        {avatarUrl ? (
          <Image
            accessibilityLabel={`${user?.name ?? 'User'} profile photo`}
            source={{ uri: avatarUrl }}
            style={[styles.avatar, styles.avatarImage]}
            onError={() => setAvatarError(true)}
          />
        ) : (
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Text style={[styles.avatarText, { color: colors.primaryForeground }]}>
              {initials}
            </Text>
          </View>
        )}
      </View>
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
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    resizeMode: 'cover',
  },
  avatarText: {
    fontSize: 13,
    fontFamily: 'Geist_600SemiBold',
  },
});
