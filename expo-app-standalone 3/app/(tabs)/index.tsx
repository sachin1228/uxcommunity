import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ContentDetail, ContentCard, useContentActions } from '@/components/community/contentView';
import { CommunityContent } from '@/lib/communityContent';
import { applyPollEventToFeed, feedPollCommunityIds, type ThreadPollEvent } from '@/lib/feedPollRealtime';
import { feedItemKey, feedItemKind, getHomeFeed, type FeedItem } from '@/lib/homeFeed';
import {
  DEFAULT_HOME_FEED_SCOPE,
  HOME_FEED_TAB_SCOPES,
  type HomeFeedScope,
} from '@/lib/homeFeedScope';
import { readStoredHomeFeedScope, storeHomeFeedScope } from '@/lib/homeFeedScopeStore';
import { useThreadPollRealtime } from '@/hooks/useThreadPollRealtime';

/**
 * Home — the cross-community feed, split into the web dashboard's two sources:
 * "Public Posts" (public cards from communities the member hasn't joined) and
 * "Your Communities" (everything from the communities they have). The chosen
 * tab is remembered across launches, like the web's localStorage choice.
 *
 * Renders the same cards as the community tabs (likes, saves, RSVPs and the
 * comment thread all work identically), with a chip naming the community each
 * post came from. Posts are read-only here: editing and deleting stay on the
 * post's own community tab, where membership is known.
 */

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/** One tab per feed source — the web switcher's labels and glyphs. */
const TAB_META: Record<HomeFeedScope, { label: string; icon: FeatherName }> = {
  public: { label: 'Public Posts', icon: 'globe' },
  communities: { label: 'Your Communities', icon: 'lock' },
};

/** Tab order comes from the shared axis — the web switcher's order. */
const TABS = HOME_FEED_TAB_SCOPES.map((key) => ({ key, ...TAB_META[key] }));

/** The web feed's empty-state copy per source — the two tabs show disjoint posts. */
const EMPTY_STATE_DESCRIPTION: Record<HomeFeedScope, string> = {
  public:
    "Posts that members share publicly — from communities you haven't joined — will appear here.",
  communities:
    "Everything posted in the communities you've joined will appear here, whether or not it was shared publicly.",
};

export default function HomeTab() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const actions = useContentActions();

  const [scope, setScope] = useState<HomeFeedScope>(DEFAULT_HOME_FEED_SCOPE);
  /** The live source — load callbacks compare against it to drop stale pages. */
  const scopeRef = useRef<HomeFeedScope>(DEFAULT_HOME_FEED_SCOPE);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FeedItem | null>(null);

  const resetActions = actions.reset;

  const load = useCallback(
    async (targetScope: HomeFeedScope, mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'initial') setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const page = await getHomeFeed(targetScope);
        // A tab switch while this page was in flight owns the list now.
        if (scopeRef.current !== targetScope) return;
        setItems(page.items);
        setHasMore(page.hasMore);
        resetActions();
      } catch (e) {
        if (scopeRef.current !== targetScope) return;
        setError(e instanceof Error ? e.message : 'Failed to load your feed.');
      } finally {
        if (scopeRef.current === targetScope) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [resetActions],
  );

  // Open on the remembered tab. The first load waits for the stored choice, so
  // a member who last read "Your Communities" never sees the public feed flash.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await readStoredHomeFeedScope();
      if (cancelled) return;
      const initial = stored ?? DEFAULT_HOME_FEED_SCOPE;
      scopeRef.current = initial;
      setScope(initial);
      await load(initial, 'initial');
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const handleScopeChange = useCallback(
    (next: HomeFeedScope) => {
      if (next === scopeRef.current) return;
      scopeRef.current = next;
      setScope(next);
      // Clear immediately: the old tab's cards must never linger under the new
      // tab's name while its page loads.
      setItems([]);
      setSelected(null);
      setHasMore(true);
      void storeHomeFeedScope(next);
      void load(next, 'initial');
    },
    [load],
  );

  // Poll tallies for the threads in this feed. Only communities with a visible
  // poll are subscribed — a feed of plain posts opens no sockets.
  const applyPollUpdate = actions.applyPollUpdate;
  const pollCommunityIds = useMemo(() => feedPollCommunityIds(items), [items]);

  const handlePollEvent = useCallback(
    (event: ThreadPollEvent) => {
      const me = user?.id ?? '';
      setItems((current) => applyPollEventToFeed(current, event, me));
      setSelected((current) => {
        if (!current || current.id !== event.threadId) return current;
        return applyPollEventToFeed([current], event, me)[0] ?? current;
      });
      // An optimistic local vote keeps its choice while the tallies move; an
      // event from this member on another device replaces it.
      applyPollUpdate(event.threadId, {
        counts: event.counts,
        userVote: event.userVote,
        undoUsed: event.undoUsed,
        mine: event.userId !== null && event.userId === me,
      });
    },
    [applyPollUpdate, user?.id],
  );

  // A reconnected room missed events while it was down; settle from the API.
  const handlePollGap = useCallback(() => {
    void load(scopeRef.current, 'refresh');
  }, [load]);

  useThreadPollRealtime({
    communityIds: pollCommunityIds,
    onEvent: handlePollEvent,
    onGap: handlePollGap,
  });

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || items.length === 0) return;
    const target = scopeRef.current;
    const last = items[items.length - 1];
    setLoadingMore(true);
    try {
      const page = await getHomeFeed(target, last.created_at);
      if (scopeRef.current !== target) return;
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

  // The comment count is the only route into a post's own page, where the
  // comments live under the post itself; the card body just double-tap likes.
  const openItem = useCallback((item: CommunityContent) => {
    const match = items.find((entry) => entry.id === item.id);
    setSelected(match ?? null);
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
        onComments={openItem}
      />
    ),
    [actions, items, openItem, user?.id],
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      <AppHeader />

      {/* ── Feed source tabs — the web switcher's two disjoint feeds ── */}
      <View style={[styles.tabsShell, { borderBottomColor: colors.border }]}>
        {TABS.map((tab) => {
          const active = scope === tab.key;
          const labelColor = active ? colors.foreground : colors.mutedForeground;
          return (
            <Pressable
              key={tab.key}
              onPress={() => handleScopeChange(tab.key)}
              style={[styles.tab, { borderBottomColor: active ? colors.accent : 'transparent' }]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <View style={styles.tabInner}>
                <Feather name={tab.icon} size={14} color={labelColor} />
                <Text style={[styles.tabText, { color: labelColor }]}>{tab.label}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Feather name="wifi-off" size={28} color={colors.foregroundMuted} />
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>Couldn&apos;t load your feed</Text>
          <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>{error}</Text>
          <Pressable onPress={() => void load(scopeRef.current, 'initial')} accessibilityRole="button">
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
              onRefresh={() => void load(scopeRef.current, 'refresh')}
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
              <Feather
                name={scope === 'communities' ? 'users' : 'globe'}
                size={32}
                color={colors.foregroundSubtle}
              />
              <Text style={[styles.stateTitle, { color: colors.foregroundMuted }]}>No posts yet</Text>
              <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>
                {EMPTY_STATE_DESCRIPTION[scope]}
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
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabsShell: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
  },
  tabInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabText: { fontSize: 12.5, fontFamily: 'Geist_500Medium' },
  list: { padding: 12, gap: 12, flexGrow: 1 },
  center: { flex: 1, minHeight: 300, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  stateTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 16 },
  stateBody: { fontFamily: 'Geist_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retry: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  footer: { paddingVertical: 20, alignItems: 'center' },
});
