import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/AppHeader';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { CommentsSheet } from '@/components/community/CommentsSheet';
import { ContentDetail, ContentCard, useContentActions } from '@/components/community/contentView';
import { CommunityContent } from '@/lib/communityContent';
import { feedItemKey, feedItemKind, getHomeFeed, type FeedItem } from '@/lib/homeFeed';

/**
 * Home — the cross-community feed.
 *
 * Renders the same cards as the community tabs (likes, saves, RSVPs and the
 * comment sheet all work identically), with a chip naming the community each
 * post came from. Posts are read-only here: editing and deleting stay on the
 * post's own community tab, where membership is known.
 */
export default function HomeTab() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const actions = useContentActions();

  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FeedItem | null>(null);
  const [commentTarget, setCommentTarget] = useState<FeedItem | null>(null);

  const resetActions = actions.reset;

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'initial') setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const page = await getHomeFeed();
        setItems(page.items);
        setHasMore(page.hasMore);
        resetActions();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load your feed.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [resetActions],
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || items.length === 0) return;
    const last = items[items.length - 1];
    setLoadingMore(true);
    try {
      const page = await getHomeFeed(last.created_at);
      setItems((current) => {
        const seen = new Set(current.map(feedItemKey));
        return [...current, ...page.items.filter((item) => !seen.has(feedItemKey(item)))];
      });
      setHasMore(page.hasMore);
    } catch {
      // Leave the feed as-is; the user can pull to retry.
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, items, loadingMore]);

  const openComments = useCallback((item: CommunityContent) => {
    const match = items.find((entry) => entry.id === item.id);
    setCommentTarget(match ?? null);
  }, [items]);

  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) => (
      <ContentCard
        item={item}
        kind={feedItemKind(item)}
        currentUserId={user?.id ?? ''}
        actions={actions}
        communityName={item.community_name}
        communityImage={item.community_image}
        onOpen={(entry) => setSelected(items.find((row) => row.id === entry.id) ?? null)}
        onComments={openComments}
      />
    ),
    [actions, items, openComments, user?.id],
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      <AppHeader />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Feather name="wifi-off" size={28} color={colors.foregroundMuted} />
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>Couldn&apos;t load your feed</Text>
          <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>{error}</Text>
          <Pressable onPress={() => void load('initial')} accessibilityRole="button">
            <Text style={[styles.retry, { color: colors.accent }]}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={feedItemKey}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 96 }]}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load('refresh')}
              tintColor={colors.foregroundMuted}
            />
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footer}>
                <ActivityIndicator size="small" color={colors.foregroundMuted} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Feather name="inbox" size={32} color={colors.foregroundSubtle} />
              <Text style={[styles.stateTitle, { color: colors.foregroundMuted }]}>No posts yet</Text>
              <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>
                When community members share threads, events, resources or their work
                publicly, they&apos;ll appear here.
              </Text>
            </View>
          }
        />
      )}

      <ContentDetail
        item={selected}
        kind={selected ? feedItemKind(selected) : 'threads'}
        currentUserId={user?.id ?? ''}
        actions={actions}
        communityName={selected?.community_name ?? null}
        visible={Boolean(selected)}
        onClose={() => setSelected(null)}
        onComments={openComments}
      />

      {commentTarget ? (
        <CommentsSheet
          visible
          communityId={commentTarget.community_id}
          kind={feedItemKind(commentTarget)}
          targetId={commentTarget.id}
          currentUserId={user?.id ?? ''}
          title={commentTarget.title}
          allowReplies={
            feedItemKind(commentTarget) === 'events'
              ? true
              : (commentTarget as { allow_replies?: boolean }).allow_replies !== false
          }
          onClose={() => setCommentTarget(null)}
          onCountChange={(total) => actions.setCommentCount(commentTarget.id, total)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { padding: 12, gap: 12, flexGrow: 1 },
  center: { flex: 1, minHeight: 300, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  stateTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 16 },
  stateBody: { fontFamily: 'Geist_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retry: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  footer: { paddingVertical: 20, alignItems: 'center' },
});
