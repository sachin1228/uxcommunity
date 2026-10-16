import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandLogo } from '@/components/BrandLogo';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useDmUnread } from '@/hooks/useDmUnread';
import { useNotifications } from '@/hooks/useNotifications';
import { resolveProfilePictureUri } from '@/lib/profilePicture';

export function AppHeader() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [avatarError, setAvatarError] = useState(false);
  // What the badge shows: notifications new since the member last opened the
  // list (never the all-time unread total) — same rule as the web topbar.
  const { unseenCount, seenLoaded } = useNotifications();
  // The envelope badge is the DM people-count (conversations with unread),
  // again the web topbar's rule.
  const dmUnread = useDmUnread();
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

      <View style={styles.actions}>
        <Pressable
          accessibilityLabel={
            seenLoaded && unseenCount > 0 ? `${unseenCount} new notifications` : 'Notifications'
          }
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.push('/notifications')}
          style={({ pressed }) => [
            styles.iconButton,
            // The header sits on the page background, so the pressed state has
            // to lift onto the raised surface to be visible at all.
            { backgroundColor: pressed ? colors.surfaceRaised : 'transparent' },
          ]}
        >
          <Feather name="bell" size={22} color={colors.mutedForeground} />
          {seenLoaded && unseenCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {unseenCount > 99 ? '99+' : unseenCount}
              </Text>
            </View>
          )}
        </Pressable>

        <Pressable
          accessibilityLabel={dmUnread > 0 ? `${dmUnread} unread messages` : 'Messages'}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.push('/messages')}
          style={({ pressed }) => [
            styles.iconButton,
            { backgroundColor: pressed ? colors.surfaceRaised : 'transparent' },
          ]}
        >
          <Feather name="mail" size={20} color={colors.mutedForeground} />
          {dmUnread > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{dmUnread > 99 ? '99+' : dmUnread}</Text>
            </View>
          )}
        </Pressable>

        <Pressable
          accessibilityLabel="Saved"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.push('/saved')}
          style={({ pressed }) => [
            styles.iconButton,
            { backgroundColor: pressed ? colors.surfaceRaised : 'transparent' },
          ]}
        >
          <Feather name="bookmark" size={20} color={colors.mutedForeground} />
        </Pressable>

        <Pressable
          accessibilityLabel="Settings"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.push('/settings')}
        >
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
        </Pressable>
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
  // Red-500 count chip, same colours and cap as the web topbar bell.
  badge: {
    position: 'absolute',
    right: -2,
    top: -2,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: '#FFFFFF',
    fontFamily: 'Geist_700Bold',
    fontSize: 9,
    lineHeight: 12,
  },
});
