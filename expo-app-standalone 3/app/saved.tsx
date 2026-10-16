/**
 * Saved — the mobile rendering of the web /dashboard/saved.
 *
 * `GET /api/profile/feed?scope=saved` returns the same card payloads as the
 * home feed: threads, showcase posts and events the member saved, and
 * resources they bookmarked through the "•••" Save action (the heart on a
 * resource is a like and never lands here). Cards render through the shared
 * community components, so unsaving from this screen removes the row on the
 * next load.
 */

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
import { Feather, Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { CommentsSheet } from '@/components/community/CommentsSheet';
import { ContentDetail, ContentCard, useContentActions } from '@/components/community/contentView';
import { useColors } from '@/hooks/useColors';
import { CommunityContent } from '@/lib/communityContent';
import { feedItemKey, feedItemKind, getSavedFeed, type FeedItem } from '@/lib/homeFeed';

export default function SavedScreen() {
  const colors = useColors();
  const router = useRouter();
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
    async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
      if (mode === 'initial') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      if (mode !== 'silent') setError(null);
      try {
        const page = await getSavedFeed();
        setItems(page.items);
        setHasMore(page.hasMore);
        resetActions();
        if (mode !== 'silent') setError(null);
      } catch (e) {
        if (mode !== 'silent') {
          setError(e instanceof Error ? e.message : 'Failed to load saved posts.');
        }
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

  // Saving/unsaving happens on other screens; re-read when this one regains
  // focus so a save made in a community shows up on return.
  useFocusEffect(
    useCallback(() => {
      void load('silent');
    }, [load]),
  );

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || items.length === 0) return;
    const last = items[items.length - 1];
    setLoadingMore(true);
    try {
      const page = await getSavedFeed(last.created_at);
      setItems((current) => {
        const seen = new Set(current.map(feedItemKey));
        return [...current, ...page.items.filter((item) => !seen.has(feedItemKey(item)))];
      });
      setHasMore(page.hasMore);
    } catch {
      // Keep the list; pull-to-refresh retries.
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, items, loadingMore]);

  const openComments = useCallback(
    (item: CommunityContent) => {
      const match = items.find((entry) => entry.id === item.id);
      setCommentTarget(match ?? null);
    },
    [items],
  );

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
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Saved</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Feather name="wifi-off" size={28} color={colors.foregroundMuted} />
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>
            Couldn&apos;t load saved posts
          </Text>
          <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>{error}</Text>
          <Pressable onPress={() => void load('initial')} accessibilityRole="button">
            <Text style={[styles.retry, { color: colors.accent }]}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={feedItemKey}
          renderItem={({ item }) => (
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
          )}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]}
          onEndReached={() => void loadMore()}
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
              <Feather name="bookmark" size={30} color={colors.foregroundSubtle} />
              <Text style={[styles.stateTitle, { color: colors.foregroundMuted }]}>
                Nothing saved yet
              </Text>
              <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>
                Posts you save — threads, showcase work, resources and events — collect here.
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: { padding: 2 },
  headerTitle: { flex: 1, fontFamily: 'Geist_600SemiBold', fontSize: 17, textAlign: 'center' },
  headerSpacer: { width: 26 },
  list: { padding: 12, gap: 12, flexGrow: 1 },
  center: {
    flex: 1,
    minHeight: 300,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 32,
  },
  stateTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 16, textAlign: 'center' },
  stateBody: { fontFamily: 'Geist_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retry: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  footer: { paddingVertical: 20, alignItems: 'center' },
});
