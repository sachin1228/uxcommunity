import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  useColorScheme,
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
  const colorScheme = useColorScheme();
  const router = useRouter();
  const { communities, isLoading, error, reload, markCommunityRead, getTypingLabel } =
    useCommunities();

  const handleCommunityPress = useCallback(
    (community: Community) => {
      markCommunityRead(community.id);
      const imageParam = community.image_url
        ? `&image=${encodeURIComponent(community.image_url)}`
        : '';
      const tabsParam = `&tabs=${encodeURIComponent(community.enabled_tabs.join(','))}`;
      router.push(
        `/community/${community.id}?name=${encodeURIComponent(community.name)}${imageParam}${tabsParam}`
      );
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

  return (
    <View style={[styles.root, { backgroundColor: colors.subtle }]}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <AppHeader />

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
            You haven&apos;t joined any communities.
          </Text>
        </View>
      )}

      {!isLoading && !error && communities.length > 0 && (
        <FlatList
          data={communities}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
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
