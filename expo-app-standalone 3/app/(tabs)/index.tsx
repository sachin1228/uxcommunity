import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
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
  const { user, logout } = useAuth();
  const { communities, isLoading, error, reload, markCommunityRead, getTypingLabel } =
    useCommunities();

  const handleCommunityPress = useCallback(
    (community: Community) => {
      markCommunityRead(community.id);
      router.push(`/community/${community.id}?name=${encodeURIComponent(community.name)}`);
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
        <View>
          <Text style={[styles.headerBrand, { color: colors.primary }]}>
            drafthub <Text style={[styles.headerSlash, { color: colors.mutedForeground }]}>/</Text>
          </Text>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Communities</Text>
          {user && (
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
              {user.name}
            </Text>
          )}
        </View>
        <Pressable
          onPress={logout}
          hitSlop={8}
          style={({ pressed }) => [
            styles.logoutBtn,
            { backgroundColor: pressed ? colors.subtle : 'transparent' },
          ]}
        >
          <Feather name="log-out" size={20} color={colors.mutedForeground} />
        </Pressable>
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
  headerBrand: {
    fontSize: 13,
    fontFamily: 'Geist_500Medium',
    letterSpacing: -0.1,
    marginBottom: 2,
  },
  headerSlash: {
    fontSize: 13,
    fontFamily: 'Geist_400Regular',
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: 'Geist_700Bold',
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 13,
    fontFamily: 'Geist_400Regular',
    marginTop: 1,
  },
  logoutBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
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
