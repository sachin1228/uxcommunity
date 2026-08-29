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
import { StatusBar } from 'expo-status-bar';
import { AppHeader } from '@/components/AppHeader';
import { FeedCard } from '@/components/feed/FeedCard';
import { useColors } from '@/hooks/useColors';
import { useFeed } from '@/hooks/useFeed';
import type { FeedItem } from '@/lib/feed';

export default function FeedTab() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const { items, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, refetch, error } = useFeed();

  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) => (
      <View style={styles.cardWrap}>
        <FeedCard item={item} />
      </View>
    ),
    [],
  );

  const renderFooter = useCallback(() => {
    if (!hasNextPage) return null;
    return (
      <Pressable
        onPress={() => fetchNextPage()}
        disabled={isFetchingNextPage}
        style={[styles.loadMore, { borderColor: colors.border }]}
      >
        {isFetchingNextPage ? (
          <ActivityIndicator color={colors.primary} size="small" />
        ) : (
          <Text style={[styles.loadMoreText, { color: colors.primary }]}>Load more</Text>
        )}
      </Pressable>
    );
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, colors]);

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
          <Feather name="alert-circle" size={36} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
          <Pressable onPress={refetch} style={[styles.retryButton, { borderColor: colors.border }]}>
            <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
          </Pressable>
        </View>
      )}

      {!isLoading && !error && items.length === 0 && (
        <View style={styles.center}>
          <Feather name="globe" size={36} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Nothing public yet</Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            When community members share threads, events, resources, or showcase work publicly, they&apos;ll appear here.
          </Text>
        </View>
      )}

      {!isLoading && !error && items.length > 0 && (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListFooterComponent={renderFooter}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={refetch}
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
    marginTop: 4,
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
  list: {
    flexGrow: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 10,
  },
  cardWrap: {},
  loadMore: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 10,
  },
  loadMoreText: { fontSize: 14, fontFamily: 'Geist_500Medium' },
});
