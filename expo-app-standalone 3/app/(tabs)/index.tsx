import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/AppHeader';
import { useColors } from '@/hooks/useColors';
import { useViewableKeys } from '@/hooks/useViewableKeys';
import { useAuth } from '@/context/AuthContext';
import {
  ContentDetail,
  ContentPlaybackProvider,
  useContentActions,
} from '@/components/community/contentView';
import { ContentCardRow } from '@/components/community/ContentCardRow';
import { CommunityContentEditor } from '@/components/community/CommunityContentEditor';
import { CommunityContent, deleteCommunityContent } from '@/lib/communityContent';
import { chatContentKindForTab } from '@/lib/chatContentEvents';
import { notifyContentEvent } from '@/lib/contentEventMirror';
import { applyPollEventToFeed, feedPollCommunityIds, type ThreadPollEvent } from '@/lib/feedPollRealtime';
import {
  FEED_LIST_PERFORMANCE,
  feedItemKey,
  feedItemKind,
  getHomeFeed,
  prefetchFeedImages,
  type FeedItem,
} from '@/lib/homeFeed';
import {
  DEFAULT_HOME_FEED_SCOPE,
  HOME_FEED_TAB_SCOPES,
  type HomeFeedScope,
} from '@/lib/homeFeedScope';
import { readStoredHomeFeedScope, storeHomeFeedScope } from '@/lib/homeFeedScopeStore';
import { useThreadPollRealtime } from '@/hooks/useThreadPollRealtime';
import {
  fetchScreenData,
  peekScreenData,
  readScreenData,
  writeScreenDataDebounced,
} from '@/lib/screenDataCacheStore';
import { mergeUniquePage, SCREEN_CACHE_TTL_MS } from '@/lib/screenDataCache';

/**
 * Home — the cross-community feed, with the web dashboard's two filters:
 * "All posts" (joined-community cards plus publicly shared cards from
 * communities the member hasn't joined) and "Your Communities" (only the
 * communities they have joined). The chosen tab is remembered across launches,
 * like the web's localStorage choice.
 *
 * Renders the same cards as the community tabs (likes, saves, RSVPs and the
 * comment thread all work identically), with a chip naming the community each
 * post came from. The ··· menu carries the same owner Edit/Delete rows the web
 * feed has — the editor and the delete call are hosted here, so removing a post
 * from the feed updates the list in place.
 */

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/** One tab per feed source — the web switcher's labels and glyphs. */
const TAB_META: Record<HomeFeedScope, { label: string; icon: FeatherName }> = {
  all: { label: 'All posts', icon: 'layers' },
  communities: { label: 'Your Communities', icon: 'lock' },
};

/** Tab order comes from the shared axis — All posts leads. */
const TABS = HOME_FEED_TAB_SCOPES.map((key) => ({ key, ...TAB_META[key] }));

/** The web feed's empty-state copy per source. */
const EMPTY_STATE_DESCRIPTION: Record<HomeFeedScope, string> = {
  all: "Posts from your communities and public posts from across the community will appear here.",
  communities:
    "Everything posted in the communities you've joined will appear here, whether or not it was shared publicly.",
};

/** Space the floating switcher reserves above the first card. */
const FEED_TOP_INSET = 58;

/** A tab's measured slot inside the track, used to glide the indicator. */
type ScopeRect = { x: number; width: number };

/**
 * The floating feed switcher — a compact pill that hovers over the list while
 * the cards scroll underneath it. The active slot is a sliding capsule that
 * eases between the two measured tab widths, mirroring the web switcher.
 */
function FeedScopePill({
  scope,
  onChange,
}: {
  scope: HomeFeedScope;
  onChange: (next: HomeFeedScope) => void;
}) {
  const colors = useColors();
  const [rects, setRects] = useState<Partial<Record<HomeFeedScope, ScopeRect>>>({});
  const indicatorX = useRef(new Animated.Value(0)).current;
  const indicatorWidth = useRef(new Animated.Value(0)).current;
  const positioned = useRef(false);

  const activeRect = rects[scope];

  // Measure first, then glide. The very first placement is instant so the
  // capsule never sweeps in from the left edge on launch.
  useEffect(() => {
    if (!activeRect) return;
    const duration = positioned.current ? 240 : 0;
    const animation = Animated.parallel([
      Animated.timing(indicatorX, {
        toValue: activeRect.x,
        duration,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(indicatorWidth, {
        toValue: activeRect.width,
        duration,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]);
    animation.start();
    positioned.current = true;
    return () => animation.stop();
  }, [activeRect, indicatorWidth, indicatorX]);

  const measure = useCallback((key: HomeFeedScope, event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;
    setRects((current) => {
      const previous = current[key];
      if (previous && previous.x === x && previous.width === width) return current;
      return { ...current, [key]: { x, width } };
    });
  }, []);

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.scopePill,
        { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.scopeIndicator,
          {
            backgroundColor: colors.borderStrong,
            width: indicatorWidth,
            transform: [{ translateX: indicatorX }],
          },
        ]}
      />

      {TABS.map((tab) => {
        const active = scope === tab.key;
        const tint = active ? colors.foreground : colors.foregroundMuted;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            hitSlop={4}
            onPress={() => onChange(tab.key)}
            onLayout={(event) => measure(tab.key, event)}
            style={({ pressed }) => [styles.scopeSegment, pressed && styles.scopeSegmentPressed]}
          >
            <Feather name={tab.icon} size={12} color={tint} />
            <Text style={[styles.scopeSegmentText, { color: tint }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface HomeFeedSnapshot {
  items: FeedItem[];
  hasMore: boolean;
}

function homeFeedCacheKey(scope: HomeFeedScope): string {
  return `home-feed:${scope}`;
}

export default function HomeTab() {
  const { user, sessionEpoch } = useAuth();
  const userId = user?.id ?? null;
  return (
    <HomeTabSession
      key={`${userId ?? 'signed-out'}:${sessionEpoch}`}
      userId={userId}
      sessionEpoch={sessionEpoch}
    />
  );
}

function HomeTabSession({
  userId,
  sessionEpoch,
}: {
  userId: string | null;
  sessionEpoch: number;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

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
  const { viewableStore, onViewableItemsChanged, viewabilityConfig } = useViewableKeys();
  /** The feed row whose editor is open (owner-only; null when closed). */
  const [editing, setEditing] = useState<FeedItem | null>(null);

  const requestSequenceRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const itemsRef = useRef(items);
  const hasMoreRef = useRef(hasMore);
  itemsRef.current = items;
  hasMoreRef.current = hasMore;
  const cacheReadyScopeRef = useRef<string | null>(null);
  const cacheSessionKey = `${userId ?? ''}:${sessionEpoch}`;

  const commitFeed = useCallback(
    (targetScope: HomeFeedScope, nextItems: FeedItem[], nextHasMore: boolean, persist = true) => {
      itemsRef.current = nextItems;
      hasMoreRef.current = nextHasMore;
      setItems(nextItems);
      setHasMore(nextHasMore);
      if (persist && userId && cacheReadyScopeRef.current === `${cacheSessionKey}:${targetScope}`) {
        writeScreenDataDebounced(
          userId,
          homeFeedCacheKey(targetScope),
          sessionEpoch,
          { items: nextItems, hasMore: nextHasMore },
          SCREEN_CACHE_TTL_MS.homeFeed,
        );
      }
    },
    [cacheSessionKey, sessionEpoch, userId],
  );

  const persistCardMutation = useCallback(
    (source: CommunityContent, patch: Record<string, unknown>) => {
      const targetScope = scopeRef.current;
      const current = itemsRef.current;
      const next = current.map((item) =>
        item.id === source.id && item.community_id === source.community_id
          ? { ...item, ...patch }
          : item,
      );
      requestSequenceRef.current += 1;
      setRefreshing(false);
      commitFeed(targetScope, next, hasMoreRef.current);
      setSelected((selectedItem) =>
        selectedItem?.id === source.id && selectedItem.community_id === source.community_id
          ? ({ ...selectedItem, ...patch } as FeedItem)
          : selectedItem,
      );
    },
    [commitFeed],
  );

  const actions = useContentActions(persistCardMutation);

  const resetActions = actions.reset;

  const load = useCallback(
    async (targetScope: HomeFeedScope, mode: 'initial' | 'refresh' = 'initial') => {
      if (!userId) {
        setLoading(false);
        setError('Sign in to load your feed.');
        return;
      }
      const sequence = ++requestSequenceRef.current;
      const cacheKey = homeFeedCacheKey(targetScope);
      const cacheIdentity = `${cacheSessionKey}:${targetScope}`;
      let paintedSnapshot = false;
      let networkSucceeded = false;
      const isCurrent = () =>
        requestSequenceRef.current === sequence && scopeRef.current === targetScope;

      if (mode === 'initial') {
        setRefreshing(false);
        const memory = peekScreenData<HomeFeedSnapshot>(
          userId,
          cacheKey,
          sessionEpoch,
          SCREEN_CACHE_TTL_MS.homeFeed,
        );
        if (memory) {
          paintedSnapshot = true;
          cacheReadyScopeRef.current = cacheIdentity;
          commitFeed(targetScope, memory.data.items, memory.data.hasMore, false);
          resetActions();
          if (memory.isFresh) {
            setError(null);
            setLoading(false);
            return;
          }
          setLoading(false);
        } else {
          setLoading(true);
        }
        void readScreenData<HomeFeedSnapshot>(
          userId,
          cacheKey,
          sessionEpoch,
          SCREEN_CACHE_TTL_MS.homeFeed,
        ).then((snapshot) => {
          if (!snapshot || networkSucceeded || paintedSnapshot || !isCurrent()) return;
          paintedSnapshot = true;
          cacheReadyScopeRef.current = cacheIdentity;
          commitFeed(targetScope, snapshot.data.items, snapshot.data.hasMore, false);
          resetActions();
          setLoading(false);
        });
      } else {
        setRefreshing(true);
      }
      setError(null);
      try {
        const result = await fetchScreenData(
          userId,
          cacheKey,
          sessionEpoch,
          SCREEN_CACHE_TTL_MS.homeFeed,
          () => getHomeFeed(targetScope),
        );
        if (!result.accepted || !isCurrent()) return;
        networkSucceeded = true;
        cacheReadyScopeRef.current = cacheIdentity;
        commitFeed(targetScope, result.data.items, result.data.hasMore);
        prefetchFeedImages(result.data.items);
        resetActions();
      } catch (e) {
        if (!isCurrent()) return;
        setError(e instanceof Error ? e.message : 'Failed to load your feed.');
      } finally {
        if (isCurrent()) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [cacheSessionKey, commitFeed, resetActions, sessionEpoch, userId],
  );

  // Open on the remembered tab, defaulting to All posts. The first load waits
  // for the stored choice, so a returning member never sees the other feed
  // flash.
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
      commitFeed(next, [], true, false);
      setSelected(null);
      void storeHomeFeedScope(next);
      void load(next, 'initial');
    },
    [commitFeed, load],
  );

  // Poll tallies for the threads in this feed. Only communities with a visible
  // poll are subscribed — a feed of plain posts opens no sockets.
  const applyPollUpdate = actions.applyPollUpdate;
  const pollCommunityIds = useMemo(() => feedPollCommunityIds(items), [items]);

  const handlePollEvent = useCallback(
    (event: ThreadPollEvent) => {
      const me = userId ?? '';
      requestSequenceRef.current += 1;
      setRefreshing(false);
      commitFeed(
        scopeRef.current,
        applyPollEventToFeed(itemsRef.current, event, me),
        hasMoreRef.current,
      );
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
    [applyPollUpdate, commitFeed, userId],
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
    if (loadingMoreRef.current || !hasMoreRef.current || itemsRef.current.length === 0 || !userId) return;
    const target = scopeRef.current;
    const last = itemsRef.current[itemsRef.current.length - 1];
    const sequence = requestSequenceRef.current;
    setLoadingMore(true);
    loadingMoreRef.current = true;
    try {
      const page = await getHomeFeed(target, last.created_at);
      if (scopeRef.current !== target || requestSequenceRef.current !== sequence) return;
      const next = mergeUniquePage(itemsRef.current, page.items, feedItemKey);
      commitFeed(target, next, page.hasMore);
    } catch {
      // Leave the feed as-is; the user can pull to retry.
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [commitFeed, userId]);

  // The comment count is the only route into a post's own page, where the
  // comments live under the post itself; the card body just double-tap likes.
  const openItem = useCallback((item: CommunityContent) => {
    const match = itemsRef.current.find((entry) => entry.id === item.id);
    setSelected(match ?? null);
  }, []);

  // Feed rows carry their singular `_type`; the editor and the delete endpoint
  // want the plural tab key. An update response also lacks the row's community
  // attribution, so the feed keeps its own copy of those fields.
  const replaceItem = useCallback((saved: CommunityContent) => {
    requestSequenceRef.current += 1;
    setRefreshing(false);
    const next = itemsRef.current.map((entry) =>
        entry.id === saved.id
          ? {
              ...entry,
              ...saved,
              _type: entry._type,
              community_name: entry.community_name,
              community_image: entry.community_image,
            }
          : entry,
      );
    commitFeed(scopeRef.current, next, hasMoreRef.current);
    setSelected((current) =>
      current && current.id === saved.id
        ? {
            ...current,
            ...saved,
            _type: current._type,
            community_name: current.community_name,
            community_image: current.community_image,
          }
        : current,
    );
    setEditing(null);
  }, [commitFeed]);

  const editItem = useCallback(
    (entry: CommunityContent) => {
      const row = itemsRef.current.find((item) => item.id === entry.id);
      if (row) setEditing(row);
    },
    [],
  );

  const deleteItem = useCallback(
    async (entry: CommunityContent) => {
      const row = itemsRef.current.find((item) => item.id === entry.id);
      if (!row?.community_id) return;
      const kind = feedItemKind(row);
      await deleteCommunityContent(row.community_id, kind, row.id);
      requestSequenceRef.current += 1;
      setRefreshing(false);
      commitFeed(
        scopeRef.current,
        itemsRef.current.filter((item) => !(item.id === row.id && item._type === row._type)),
        hasMoreRef.current,
      );
      setSelected((current) =>
        current?.id === row.id && current._type === row._type ? null : current,
      );
      // Keep the community chat's "created a …" card in step, like the
      // community tab's own delete path.
      notifyContentEvent({
        kind: 'delete',
        communityId: row.community_id,
        id: row.id,
        contentKind: chatContentKindForTab(kind),
      });
    },
    [commitFeed],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: FeedItem; index: number }) => (
      <ContentCardRow
        item={item}
        itemKey={feedItemKey(item)}
        kind={feedItemKind(item)}
        currentUserId={userId ?? ''}
        actions={actions}
        viewableStore={viewableStore}
        communityName={item.community_name}
        communityImage={item.community_image}
        onComments={openItem}
        onEdit={editItem}
        onDelete={deleteItem}
        videoRank={index}
      />
    ),
    [actions, deleteItem, editItem, openItem, userId, viewableStore],
  );

  const focusSeenRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!focusSeenRef.current) {
        focusSeenRef.current = true;
        return;
      }
      void load(scopeRef.current, 'refresh');
    }, [load]),
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      <AppHeader />

      <View style={styles.feedArea}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : error && items.length === 0 ? (
          <View style={styles.center}>
            <Feather name="wifi-off" size={28} color={colors.foregroundMuted} />
            <Text style={[styles.stateTitle, { color: colors.foreground }]}>Couldn&apos;t load your feed</Text>
            <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>{error}</Text>
            <Pressable onPress={() => void load(scopeRef.current, 'initial')} accessibilityRole="button">
              <Text style={[styles.retry, { color: colors.accent }]}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <ContentPlaybackProvider enabled={!selected}>
            <FlatList
              data={items}
              keyExtractor={feedItemKey}
              renderItem={renderItem}
              initialNumToRender={FEED_LIST_PERFORMANCE.initialNumToRender}
              maxToRenderPerBatch={FEED_LIST_PERFORMANCE.maxToRenderPerBatch}
              windowSize={FEED_LIST_PERFORMANCE.windowSize}
              updateCellsBatchingPeriod={FEED_LIST_PERFORMANCE.updateCellsBatchingPeriod}
              contentContainerStyle={[
                styles.list,
                { paddingTop: FEED_TOP_INSET, paddingBottom: insets.bottom + 96 },
              ]}
              scrollIndicatorInsets={{ top: FEED_TOP_INSET }}
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={viewabilityConfig}
              onEndReached={loadMore}
              onEndReachedThreshold={0.4}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => void load(scopeRef.current, 'refresh')}
                  tintColor={colors.foregroundMuted}
                  progressViewOffset={FEED_TOP_INSET}
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
                error ? (
                  <View style={styles.center}>
                    <Feather name="wifi-off" size={28} color={colors.foregroundMuted} />
                    <Text style={[styles.stateTitle, { color: colors.foreground }]}>Couldn&apos;t refresh your feed</Text>
                    <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>{error}</Text>
                    <Pressable onPress={() => void load(scopeRef.current, 'refresh')} accessibilityRole="button">
                      <Text style={[styles.retry, { color: colors.accent }]}>Try again</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.center}>
                    <Feather
                      name={scope === 'communities' ? 'users' : 'layers'}
                      size={32}
                      color={colors.foregroundSubtle}
                    />
                    <Text style={[styles.stateTitle, { color: colors.foregroundMuted }]}>No posts yet</Text>
                    <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>
                      {EMPTY_STATE_DESCRIPTION[scope]}
                    </Text>
                  </View>
                )
              }
            />
          </ContentPlaybackProvider>
        )}

        {/* ── Floating source switcher — the cards scroll underneath it ── */}
        <View pointerEvents="box-none" style={styles.floatingTabs}>
          <FeedScopePill scope={scope} onChange={handleScopeChange} />
        </View>
      </View>

      <ContentDetail
        item={selected}
        kind={selected ? feedItemKind(selected) : 'threads'}
        currentUserId={userId ?? ''}
        actions={actions}
        communityName={selected?.community_name ?? null}
        visible={Boolean(selected)}
        onClose={() => setSelected(null)}
        onEdit={editItem}
        onDelete={deleteItem}
      />

      <CommunityContentEditor
        visible={Boolean(editing)}
        communityId={editing?.community_id ?? ''}
        kind={editing ? feedItemKind(editing) : 'threads'}
        item={editing}
        onClose={() => setEditing(null)}
        onSaved={replaceItem}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  feedArea: { flex: 1 },

  // The switcher floats above the list; cards scroll beneath its shadow.
  floatingTabs: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 8,
    alignItems: 'center',
    zIndex: 10,
  },
  scopePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    padding: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000000',
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  scopeIndicator: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    borderRadius: 999,
  },
  scopeSegment: {
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  scopeSegmentPressed: { opacity: 0.7 },
  scopeSegmentText: {
    fontSize: 12,
    letterSpacing: 0.1,
    fontFamily: 'Geist_600SemiBold',
  },

  list: { padding: 12, gap: 12, flexGrow: 1 },
  center: { flex: 1, minHeight: 300, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  stateTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 16 },
  stateBody: { fontFamily: 'Geist_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retry: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  footer: { paddingVertical: 20, alignItems: 'center' },
});
