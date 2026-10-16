import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppHeader } from '@/components/AppHeader';
import { CommunityRow } from '@/components/communities/CommunityRow';
import { useColors } from '@/hooks/useColors';
import { useCommunities } from '@/hooks/useCommunities';
import { Community } from '@/lib/communities';

export default function CommunitiesScreen() {
  const colors = useColors();
  const router = useRouter();
  const { communities, isLoading, error, nowMs, reload, markCommunityRead, getTypingLabel } =
    useCommunities();
  const [query, setQuery] = useState('');

  /**
   * The joined list filtered by name — the same rule the web browse page
   * searches by (case-insensitive substring of the name), applied locally:
   * the list is already in hand, and a round trip would only add latency.
   */
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return communities;
    return communities.filter((c) => c.name.toLowerCase().includes(term));
  }, [communities, query]);

  const handleCommunityPress = useCallback(
    (community: Community) => {
      markCommunityRead(community.id);
      const imageParam = community.image_url
        ? `&image=${encodeURIComponent(community.image_url)}`
        : '';
      const tabsParam = `&tabs=${encodeURIComponent(community.enabled_tabs.join(','))}`;
      // Showcase keeps its own flag (defaults to on) — see lib/communities/areas.ts on the web.
      const showcaseParam = `&showcase=${community.showcase_enabled === false ? '0' : '1'}`;
      // Ownership only gates the "delete anyone's message" affordance in chat;
      // the server still authorizes every delete.
      const ownerParam = community.owner_id
        ? `&owner=${encodeURIComponent(community.owner_id)}`
        : '';
      // Snapshot the unread state *before* markCommunityRead zeroes the badge so
      // the chat can draw its "N unread messages" divider in the right place.
      const unreadParam = `&unread=${community.unread_count ?? 0}`;
      const readParam = community.last_read_at
        ? `&read=${encodeURIComponent(community.last_read_at)}`
        : '';
      router.push(
        `/community/${community.id}?name=${encodeURIComponent(community.name)}${imageParam}${tabsParam}${showcaseParam}${ownerParam}${unreadParam}${readParam}`
      );
    },
    [router, markCommunityRead]
  );

  const renderItem = useCallback(
    ({ item }: { item: Community }) => (
      <CommunityRow
        community={item}
        typingLabel={getTypingLabel(item.id)}
        nowMs={nowMs}
        onPress={() => handleCommunityPress(item)}
      />
    ),
    [getTypingLabel, handleCommunityPress, nowMs]
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      <AppHeader />

      {/* Search + create — the list's two verbs, on one line under the app
          header. Search filters the joined list locally; the + opens the
          create-community flow (the web sidebar's "Your Community" plus). */}
      <View style={styles.searchRow}>
        <View
          style={[
            styles.searchField,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Feather name="search" size={15} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search communities…"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search communities"
            style={[styles.searchInput, { color: colors.foreground }]}
          />
          {query.length > 0 && (
            <Pressable
              onPress={() => setQuery('')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Feather name="x" size={14} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
        <Pressable
          onPress={() => router.push('/create-community')}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel="Create community"
          style={({ pressed }) => [
            styles.createBtn,
            {
              backgroundColor: pressed ? colors.border : colors.surfaceRaised,
              borderColor: colors.border,
            },
          ]}
        >
          <Feather name="plus" size={18} color={colors.foreground} />
        </Pressable>
      </View>

      {isLoading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      {!isLoading && error && (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
          <Pressable onPress={reload} style={[styles.retryButton, { borderColor: colors.border }]}>
            <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
          </Pressable>
        </View>
      )}

      {!isLoading && !error && communities.length === 0 && (
        <View style={styles.center}>
          <Feather name="users" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No communities yet</Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            You haven&apos;t joined any communities. Create one with the + above.
          </Text>
        </View>
      )}

      {!isLoading && !error && communities.length > 0 && (
        <FlatList
          data={visible}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.noResults}>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No communities found
              </Text>
            </View>
          }
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
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  searchField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 40,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Geist_400Regular',
    paddingVertical: 0,
  },
  createBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noResults: {
    alignItems: 'center',
    paddingVertical: 48,
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
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  retryText: { fontSize: 14, fontFamily: 'Geist_500Medium' },
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
