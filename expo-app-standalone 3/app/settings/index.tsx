/**
 * Settings — the account's front door on mobile.
 *
 * The header avatar opens this screen. It carries the account summary, the
 * notifications preferences screen, and sign-out — which the app previously
 * had no UI for at all (see the parity audit: the auth teardown existed but
 * nothing called it).
 */

import React, { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { Redirect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { resolveProfilePictureUri } from '@/lib/profilePicture';

function initialsFor(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(' ')
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

export default function SettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, isLoading, logout } = useAuth();
  const [avatarError, setAvatarError] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const avatarUrl = avatarError ? null : resolveProfilePictureUri(user?.avatar_url);

  const performSignOut = async () => {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      setSigningOut(false);
    }
    router.replace('/(auth)/login');
  };

  const confirmSignOut = () => {
    Alert.alert('Sign out?', 'You will need to sign in again to use the app.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => void performSignOut(),
      },
    ]);
  };

  if (!isLoading && !user) return <Redirect href="/(auth)/login" />;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />

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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.foreground }]}>Settings</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.account, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {avatarUrl ? (
            <Image
              source={{ uri: avatarUrl }}
              style={[styles.avatar, styles.avatarImage]}
              onError={() => setAvatarError(true)}
            />
          ) : (
            <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
              <Text style={[styles.avatarText, { color: colors.primaryForeground }]}>
                {initialsFor(user?.name)}
              </Text>
            </View>
          )}
          <View style={styles.accountText}>
            <Text style={[styles.accountName, { color: colors.foreground }]} numberOfLines={1}>
              {user?.name ?? 'Member'}
            </Text>
            <Text style={[styles.accountEmail, { color: colors.mutedForeground }]} numberOfLines={1}>
              {user?.email ?? ''}
            </Text>
          </View>
        </View>

        <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/settings/notifications')}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: pressed ? colors.surfaceRaised : 'transparent' },
            ]}
          >
            <Feather name="bell" size={18} color={colors.mutedForeground} />
            <Text style={[styles.rowLabel, { color: colors.foreground }]}>Notifications</Text>
            <Feather name="chevron-right" size={18} color={colors.foregroundSubtle} />
          </Pressable>
        </View>

        <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Pressable
            accessibilityRole="button"
            disabled={signingOut}
            onPress={confirmSignOut}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: pressed ? colors.surfaceRaised : 'transparent' },
              signingOut && { opacity: 0.5 },
            ]}
          >
            <Feather name="log-out" size={18} color={colors.destructive} />
            <Text style={[styles.rowLabel, { color: colors.destructive }]}>
              {signingOut ? 'Signing out…' : 'Sign out'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: { padding: 2 },
  headerText: { flex: 1 },
  title: { fontFamily: 'Geist_600SemiBold', fontSize: 17 },
  content: { padding: 16, gap: 12 },
  account: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: { resizeMode: 'cover' },
  avatarText: { fontFamily: 'Geist_600SemiBold', fontSize: 15 },
  accountText: { flex: 1, minWidth: 0 },
  accountName: { fontFamily: 'Geist_600SemiBold', fontSize: 15 },
  accountEmail: { fontFamily: 'Geist_400Regular', fontSize: 12.5, marginTop: 2 },
  group: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  rowLabel: { flex: 1, fontFamily: 'Geist_500Medium', fontSize: 14.5 },
});
