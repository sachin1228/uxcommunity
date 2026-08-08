import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useCommunities } from '@/hooks/useCommunities';
import { CommunityRow } from '@/components/communities/CommunityRow';
import { useAuth } from '@/context/AuthContext';
import { Community } from '@/lib/communities';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function CommunitiesScreen() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [avatarError, setAvatarError] = useState(false);
  const { communities, isLoading, error, reload, markCommunityRead, getTypingLabel } =
    useCommunities();

  const handleCommunityPress = useCallback(
    (community: Community) => {
      markCommunityRead(community.id);
      const imageParam = community.image_url ? `&image=${encodeURIComponent(community.image_url)}` : '';
      router.push(`/community/${community.id}?name=${encodeURIComponent(community.name)}${imageParam}`);
    },
    [router, markCommunityRead]
  );

  const renderItem = useCallback(
    ({ item }: { item: Community }) => (
      <CommunityRow
        community={item}
        typingLabel={getTypingLabel(item.id)}
        onPress={() => handleCommunityPress(item)}
      />
    ),
    [getTypingLabel, handleCommunityPress]
  );

  const keyExtractor = useCallback((item: Community) => item.id, []);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />

      {/* Header */}
      <View
        style={[
          styles.header,
          { backgroundColor: colors.background, borderBottomColor: colors.border, paddingTop: insets.top + 8 },
        ]}
      >
        {/* Logo */}
        <Text style={[styles.headerLogo, { color: colors.foreground }]}>
          uxcommunity{' '}
          <Text style={[styles.headerLogoSlash, { color: colors.primary }]}>/</Text>
        </Text>

        {/* Right actions */}
        <View style={styles.headerRight}>
          {/* Notification bell */}
          <Pressable
            hitSlop={8}
            style={({ pressed }) => [
              styles.iconBtn,
              { backgroundColor: pressed ? colors.subtle : 'transparent' },
            ]}
          >
            <Feather name="bell" size={22} color={colors.mutedForeground} />
          </Pressable>

          {/* Profile avatar — show real photo when available.
               boring:// URLs are SVG-only (no network fetch) and can't be
               loaded by RN's Image; fall back to initials for those and any
               failed loads. */}
          {user?.avatar_url && !user.avatar_url.startsWith('boring://') && !avatarError ? (
            <Image
              source={{ uri: user.avatar_url }}
              style={[styles.avatar, styles.avatarImg]}
              onError={() => setAvatarError(true)}
            />
          ) : (
            <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
              <Text style={[styles.avatarText, { color: colors.primaryForeground }]}>
                {user?.name
                  ? user.name
                      .split(' ')
                      .slice(0, 2)
                      .map((w: string) => w[0]?.toUpperCase() ?? '')
                      .join('')
                  : '?'}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Loading */}
      {isLoading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      {/* Error */}
      {!isLoading && error && (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
          <Pressable
            onPress={reload}
            style={[styles.retryBtn, { borderColor: colors.border }]}
          >
            <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
          </Pressable>
        </View>
      )}

      {/* Empty state */}
      {!isLoading && !error && communities.length === 0 && (
        <View style={styles.center}>
          <Feather name="users" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            No communities yet
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            You haven't joined any communities.
          </Text>
        </View>
      )}

      {/* List */}
      {!isLoading && !error && communities.length > 0 && (
        <FlatList
          data={communities}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={reload}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLogo: {
    fontSize: 20,
    fontFamily: 'Geist_700Bold',
    letterSpacing: -0.5,
  },
  headerLogoSlash: {
    fontSize: 20,
    fontFamily: 'Geist_400Regular',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBtn: {
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
  avatarImg: {
    resizeMode: 'cover',
  },
  avatarText: {
    fontSize: 13,
    fontFamily: 'Geist_600SemiBold',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  errorText: {
    fontSize: 14,
    fontFamily: 'Geist_400Regular',
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  retryText: {
    fontSize: 14,
    fontFamily: 'Geist_500Medium',
  },
  emptyTitle: {
    fontSize: 17,
    fontFamily: 'Geist_600SemiBold',
    marginTop: 8,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Geist_400Regular',
    textAlign: 'center',
  },
  list: { flexGrow: 1 },
});
