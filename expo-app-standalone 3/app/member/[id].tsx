/**
 * A member's profile as other members see it — the mobile reading of the web
 * /dashboard/profile/[userId]: the read-only identity hero, the Message chip
 * that starts a DM (get-or-create, exactly like the web `?peer=` handoff), and
 * the All activity feed listing what they share that the viewer may see — no
 * tab rail.
 *
 * Blocking reshapes the screen the same way it reshapes the web page: the owner
 * blocking the viewer leaves only the neutral unavailable state; the viewer
 * blocking the owner leaves the identity plus the blocked notice, with no feed.
 */

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
import { Feather, Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ContentDetail,
  ContentPlaybackProvider,
  useContentActions,
} from '@/components/community/contentView';
import { ContentCardRow } from '@/components/community/ContentCardRow';
import { DOT_BAND_HEIGHT, DotField } from '@/components/profile/DotField';
import { ProfileHeaderButton, ProfilePageHeader } from '@/components/profile/ProfilePageHeader';
import { MemberProfileHero } from '@/components/profile/MemberProfileHero';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useViewableKeys } from '@/hooks/useViewableKeys';
import type { CommunityContent } from '@/lib/communityContent';
import { PENDING_DM_CONVERSATION_ID } from '@/lib/dm';
import { unblockUser } from '@/lib/dmApi';
import { peekDmConversationForPeer } from '@/lib/dmConversationsCache';
import {
  applyPollEventToFeed,
  feedPollCommunityIds,
  type ThreadPollEvent,
} from '@/lib/feedPollRealtime';
import {
  FEED_LIST_PERFORMANCE,
  feedItemKey,
  feedItemKind,
  prefetchFeedImages,
  warmFeedMediaRatios,
  type FeedItem,
} from '@/lib/homeFeed';
import { useThreadPollRealtime } from '@/hooks/useThreadPollRealtime';
import {
  getProfileFeed,
  type MemberFeedScope,
} from '@/lib/profileFeed';
import { getMemberProfile, type MemberProfile } from '@/lib/profile';
import {
  fetchScreenData,
  invalidateScreenData,
  peekScreenData,
  readScreenData,
  writeScreenDataDebounced,
} from '@/lib/screenDataCacheStore';
import { mergeUniquePage, SCREEN_CACHE_TTL_MS } from '@/lib/screenDataCache';

/** The FlatList content's gutter — the dot band cancels it to run full-bleed. */
const LIST_PADDING = 12;

/** The server's one member feed — every authored kind, viewer-visible cards. */
const MEMBER_FEED_SCOPE: MemberFeedScope = 'all';

/** The web member feed's empty-state copy. */
const EMPTY_STATE: Record<MemberFeedScope, { title: string; body: string }> = {
  all: {
    title: 'Nothing here yet',
    body: 'Threads, showcase posts, resources and events they share will appear here.',
  },
  thread: {
    title: 'No threads yet',
    body: 'Threads they start in a community will appear here.',
  },
  showcase: {
    title: 'No showcase posts yet',
    body: 'Work they share in a community showcase will appear here.',
  },
  resource: {
    title: 'No resources yet',
    body: 'Resources they share in a community will appear here.',
  },
  event: {
    title: 'No events yet',
    body: 'Events they host in a community will appear here.',
  },
};

interface MemberFeedSnapshot {
  items: FeedItem[];
  hasMore: boolean;
}

function memberFeedCacheKey(memberId: string): string {
  return `member-feed:${memberId}:all`;
}

export default function MemberProfileScreen() {
  const { user, sessionEpoch } = useAuth();
  const { id: memberId } = useLocalSearchParams<{ id: string }>();
  const viewerId = user?.id ?? null;
  return (
    <MemberProfileSession
      key={`${viewerId ?? 'signed-out'}:${sessionEpoch}:${memberId ?? ''}`}
      viewerId={viewerId}
      sessionEpoch={sessionEpoch}
      memberId={memberId}
    />
  );
}

function MemberProfileSession({
  viewerId,
  sessionEpoch,
  memberId,
}: {
  viewerId: string | null;
  sessionEpoch: number;
  memberId?: string;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [member, setMember] = useState<MemberProfile | null>(null);
  const memberRef = useRef<MemberProfile | null>(null);
  memberRef.current = member;
  const [memberAuthoritative, setMemberAuthoritative] = useState(false);
  const [memberLoading, setMemberLoading] = useState(true);
  const [memberError, setMemberError] = useState<string | null>(null);
  const memberRequestRef = useRef(0);

  const scopeRef = useRef<MemberFeedScope>(MEMBER_FEED_SCOPE);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FeedItem | null>(null);
  const { viewableStore, onViewableItemsChanged, viewabilityConfig } = useViewableKeys();
  const itemsRef = useRef(items);
  const hasMoreRef = useRef(hasMore);
  const feedRequestRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const feedReadyRef = useRef(false);
  itemsRef.current = items;
  hasMoreRef.current = hasMore;

  const [messageError, setMessageError] = useState<string | null>(null);
  const [unblocking, setUnblocking] = useState(false);
  /** Guards a second push while the first tap's transition is starting. */
  const navigatingToMessagesRef = useRef(false);

  const commitFeed = useCallback((nextItems: FeedItem[], nextHasMore: boolean, persist = true) => {
    itemsRef.current = nextItems;
    hasMoreRef.current = nextHasMore;
    setItems(nextItems);
    setHasMore(nextHasMore);
    if (persist && viewerId && memberId && feedReadyRef.current) {
      writeScreenDataDebounced(
        viewerId,
        memberFeedCacheKey(memberId),
        sessionEpoch,
        { items: nextItems, hasMore: nextHasMore },
        SCREEN_CACHE_TTL_MS.memberFeed,
      );
    }
  }, [memberId, sessionEpoch, viewerId]);

  const persistCardMutation = useCallback(
    (source: CommunityContent, patch: Record<string, unknown>) => {
      feedRequestRef.current += 1;
      const next = itemsRef.current.map((item) =>
        item.id === source.id && item.community_id === source.community_id
          ? { ...item, ...patch }
          : item,
      );
      commitFeed(next, hasMoreRef.current);
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

  const loadMember = useCallback(async () => {
    if (!memberId || !viewerId) return;
    const sequence = ++memberRequestRef.current;
    const isCurrent = () => memberRequestRef.current === sequence;
    setMemberAuthoritative(false);
    setMemberLoading(true);
    setMessageError(null);
    // The API may omit the entire profile when its owner blocked this viewer.
    // Hide any prior projection while authorization is rechecked; cached
    // profile content must never stand in for that server decision.
    memberRef.current = null;
    setMember(null);
    try {
      const result = await getMemberProfile(memberId);
      if (!isCurrent()) return;
      memberRef.current = result;
      setMember(result);
      setMemberAuthoritative(true);
      setMemberError(null);
      if (result.blockedViewer || result.blockedByMe) {
        void invalidateScreenData(viewerId, memberFeedCacheKey(memberId));
      }
    } catch (e) {
      if (!isCurrent()) return;
      setMemberError(e instanceof Error ? e.message : 'Couldn\u2019t load this profile.');
    } finally {
      if (isCurrent()) setMemberLoading(false);
    }
  }, [memberId, sessionEpoch, viewerId]);

  const loadFeed = useCallback(
    async (targetScope: MemberFeedScope, mode: 'initial' | 'refresh') => {
      if (!memberId) return;
      if (!viewerId || !memberAuthoritative || member?.blockedViewer || member?.blockedByMe) return;
      const sequence = ++feedRequestRef.current;
      const isCurrent = () => feedRequestRef.current === sequence && scopeRef.current === targetScope;
      let cachedPainted = false;
      let networkSucceeded = false;
      const cacheKey = memberFeedCacheKey(memberId);
      if (mode === 'refresh') setRefreshing(true);
      setFeedError(null);
      if (mode === 'initial') {
        setRefreshing(false);
        const memory = peekScreenData<MemberFeedSnapshot>(viewerId, cacheKey, sessionEpoch, SCREEN_CACHE_TTL_MS.memberFeed);
        if (memory) {
          cachedPainted = true;
          await warmFeedMediaRatios(memory.data.items);
          if (!isCurrent()) return;
          feedReadyRef.current = true;
          commitFeed(memory.data.items, memory.data.hasMore, false);
          setFeedLoading(false);
          resetActions();
          if (memory.isFresh) {
            setFeedError(null);
            return;
          }
        } else {
          setFeedLoading(true);
        }
        void readScreenData<MemberFeedSnapshot>(viewerId, cacheKey, sessionEpoch, SCREEN_CACHE_TTL_MS.memberFeed).then(async (snapshot) => {
          if (!snapshot || cachedPainted || networkSucceeded || !isCurrent()) return;
          cachedPainted = true;
          await warmFeedMediaRatios(snapshot.data.items);
          if (!isCurrent()) return;
          feedReadyRef.current = true;
          commitFeed(snapshot.data.items, snapshot.data.hasMore, false);
          resetActions();
          setFeedLoading(false);
        });
      }
      try {
        const result = await fetchScreenData(
          viewerId,
          cacheKey,
          sessionEpoch,
          SCREEN_CACHE_TTL_MS.memberFeed,
          () => getProfileFeed(targetScope, undefined, memberId),
        );
        if (!result.accepted || !isCurrent()) return;
        networkSucceeded = true;
        await warmFeedMediaRatios(result.data.items);
        if (!isCurrent()) return;
        feedReadyRef.current = true;
        commitFeed(result.data.items, result.data.hasMore);
        prefetchFeedImages(result.data.items);
        resetActions();
      } catch (e) {
        if (!isCurrent()) return;
        setFeedError(e instanceof Error ? e.message : 'Failed to load this feed.');
      } finally {
        if (isCurrent()) {
          setFeedLoading(false);
          setRefreshing(false);
        }
      }
    },
    [commitFeed, member?.blockedByMe, member?.blockedViewer, memberAuthoritative, memberId, resetActions, sessionEpoch, viewerId],
  );

  // Activity can hydrate from cache only after this viewer/member block
  // relationship has been confirmed by the API.
  useEffect(() => {
    if (!member || !memberAuthoritative || member.blockedViewer) return;
    if (member.blockedByMe) {
      setFeedLoading(false);
      return;
    }
    void loadFeed(scopeRef.current, 'initial');
  }, [member, memberAuthoritative, loadFeed]);

  useFocusEffect(
    useCallback(() => {
      navigatingToMessagesRef.current = false;
      void loadMember();
    }, [loadMember]),
  );

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || feedLoading || !hasMoreRef.current || itemsRef.current.length === 0 || !memberId || !viewerId || !memberAuthoritative) return;
    const target = scopeRef.current;
    const last = itemsRef.current[itemsRef.current.length - 1];
    const sequence = feedRequestRef.current;
    setLoadingMore(true);
    loadingMoreRef.current = true;
    try {
      const page = await getProfileFeed(target, last.created_at, memberId);
      if (scopeRef.current !== target || feedRequestRef.current !== sequence) return;
      await warmFeedMediaRatios(page.items);
      if (scopeRef.current !== target || feedRequestRef.current !== sequence) return;
      const next = mergeUniquePage(itemsRef.current, page.items, feedItemKey);
      const grew = next.length > itemsRef.current.length;
      commitFeed(next, page.hasMore && grew);
    } catch {
      // Leave the feed as-is; the member can pull to retry.
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [commitFeed, feedLoading, memberAuthoritative, memberId, viewerId]);

  // Poll tallies for the threads in this member's feed. Only communities with a
  // visible poll are subscribed — a feed of plain posts opens no sockets.
  const applyPollUpdate = actions.applyPollUpdate;
  const pollCommunityIds = useMemo(() => feedPollCommunityIds(items), [items]);

  const handlePollEvent = useCallback(
    (event: ThreadPollEvent) => {
      const me = viewerId ?? '';
      feedRequestRef.current += 1;
      commitFeed(
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
    [applyPollUpdate, commitFeed, viewerId],
  );

  // A reconnected room missed events while it was down; settle the tallies in
  // place so a reconnect never truncates the pages already scrolled through.
  const handlePollGap = useCallback(() => {
    const target = scopeRef.current;
    const sequence = feedRequestRef.current;
    void (async () => {
      try {
        const page = await getProfileFeed(target, undefined, memberId);
        if (scopeRef.current !== target || feedRequestRef.current !== sequence) return;
        const fresh = new Map(page.items.map((item) => [feedItemKey(item), item]));
        const next = itemsRef.current.map((item) => {
          const updated = fresh.get(feedItemKey(item));
          return updated
            ? {
                ...item,
                ...updated,
                _type: item._type,
                community_name: item.community_name,
                community_image: item.community_image,
              }
            : item;
        });
        commitFeed(next, hasMoreRef.current);
      } catch {
        // Tallies settle on the next realtime event or manual refresh.
      }
    })();
  }, [commitFeed, memberId]);

  useThreadPollRealtime({
    communityIds: pollCommunityIds,
    onEvent: handlePollEvent,
    onGap: handlePollGap,
  });

  // The comment count is the only route into a post's own page, where the
  // comments live under the post itself; the card body just double-tap likes.
  const openItem = useCallback(
    (item: CommunityContent) => {
      const match = itemsRef.current.find((entry) => entry.id === item.id);
      setSelected(match ?? null);
    },
    [],
  );

  const openMessage = useCallback(() => {
    if (!memberId || navigatingToMessagesRef.current) return;
    if (memberId === viewerId) {
      setMessageError('You cannot message yourself.');
      return;
    }
    navigatingToMessagesRef.current = true;
    setMessageError(null);
    // Push the thread now — the id the server would mint comes back there.
    // Waiting on create-or-get here put 2-3s of dead time on the tap.
    const existing = peekDmConversationForPeer(memberId);
    router.push({
      pathname: '/messages/[id]',
      params: {
        id: existing?.id ?? PENDING_DM_CONVERSATION_ID,
        name: member?.user?.name ?? 'Member',
        avatar: member?.profile?.avatar_url ?? '',
        peerId: memberId,
      },
    });
  }, [member, memberId, router, viewerId]);

  const handleUnblock = useCallback(async () => {
    if (unblocking || !memberId) return;
    setUnblocking(true);
    try {
      await unblockUser(memberId);
      setMember((current) => {
        const next = current ? { ...current, blockedByMe: false } : current;
        memberRef.current = next;
        return next;
      });
    } catch {
      setMessageError('The block could not be removed. Please try again.');
    } finally {
      setUnblocking(false);
    }
  }, [memberId, unblocking]);

  const renderItem = useCallback(
    ({ item, index }: { item: FeedItem; index: number }) => (
      <ContentCardRow
        item={item}
        itemKey={feedItemKey(item)}
        kind={feedItemKind(item)}
        currentUserId={viewerId ?? ''}
        actions={actions}
        viewableStore={viewableStore}
        communityName={item.community_name}
        communityImage={item.community_image}
        onComments={openItem}
        videoRank={index}
      />
    ),
    [actions, openItem, viewerId, viewableStore],
  );

  const body = member?.profile;
  const identityName = member?.user?.name ?? 'Member';

  const header = (
    <View style={styles.heroWrap}>
      <View pointerEvents="none" style={styles.heroDots}>
        <DotField />
      </View>

      <MemberProfileHero
        name={identityName}
        avatarUrl={body?.avatar_url ?? null}
        city={body?.cities?.name ?? null}
        roleLabel={member?.roleLabel ?? null}
        bio={body?.bio ?? ''}
        company={member?.company ?? null}
        linkedinUrl={body?.linkedin_url ?? ''}
        portfolioUrl={body?.portfolio_url ?? ''}
        blockedByMe={member?.blockedByMe ?? false}
        onMessage={() => void openMessage()}
        onUnblock={() => void handleUnblock()}
        unblocking={unblocking}
        actionsDisabled={!memberAuthoritative}
      />

      {memberError && member ? (
        <Text style={[styles.messageError, { color: colors.destructive }]}>{memberError}</Text>
      ) : null}

      {messageError ? (
        <Text style={[styles.messageError, { color: colors.destructive }]}>{messageError}</Text>
      ) : null}
    </View>
  );

  const unavailable = memberAuthoritative && member?.blockedViewer;
  const showFeed = memberAuthoritative && Boolean(member) && !member?.blockedViewer && !member?.blockedByMe;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />

      <ProfilePageHeader
        leading={
          <ProfileHeaderButton
            label="Back"
            onPress={() => router.back()}
            icon={<Ionicons name="arrow-back" size={22} color={colors.foreground} />}
          />
        }
      />

      {memberLoading && !member ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : memberError && !member ? (
        <View style={styles.center}>
          <Feather name="wifi-off" size={28} color={colors.foregroundMuted} />
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>
            Couldn&apos;t load this profile
          </Text>
          <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>{memberError}</Text>
          <Pressable onPress={() => void loadMember()} accessibilityRole="button">
            <Text style={[styles.retry, { color: colors.accent }]}>Try again</Text>
          </Pressable>
        </View>
      ) : unavailable ? (
        <View style={styles.center}>
          <View style={[styles.lockCircle, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Feather name="lock" size={22} color={colors.foregroundMuted} />
          </View>
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>
            Profile not available
          </Text>
          <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>
            This member has restricted who can view their profile.
          </Text>
        </View>
      ) : (
        <ContentPlaybackProvider enabled={!selected}>
          <FlatList
            data={member?.blockedByMe ? [] : items}
            keyExtractor={feedItemKey}
            renderItem={renderItem}
            initialNumToRender={FEED_LIST_PERFORMANCE.initialNumToRender}
            maxToRenderPerBatch={FEED_LIST_PERFORMANCE.maxToRenderPerBatch}
            windowSize={FEED_LIST_PERFORMANCE.windowSize}
            updateCellsBatchingPeriod={FEED_LIST_PERFORMANCE.updateCellsBatchingPeriod}
            ListHeaderComponent={header}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            contentContainerStyle={[
              styles.list,
              { paddingBottom: insets.bottom + 96 },
            ]}
            onEndReached={loadMore}
            onEndReachedThreshold={1.5}
            refreshControl={
              showFeed ? (
                <RefreshControl
                  refreshing={refreshing || memberLoading}
                  onRefresh={() => void loadMember()}
                  tintColor={colors.foregroundMuted}
                />
              ) : undefined
            }
            ListFooterComponent={
              <View style={styles.footer}>
                {loadingMore ? (
                  <ActivityIndicator size="small" color={colors.foregroundMuted} />
                ) : null}
              </View>
            }
            ListEmptyComponent={
              !memberAuthoritative ? (
                <View style={styles.centerSmall}>
                  <ActivityIndicator color={colors.foregroundMuted} />
                </View>
              ) : !showFeed ? null : feedLoading ? (
                <View style={styles.centerSmall}>
                  <ActivityIndicator color={colors.accent} />
                </View>
              ) : feedError ? (
                <View style={styles.centerSmall}>
                  <Feather name="wifi-off" size={26} color={colors.foregroundMuted} />
                  <Text style={[styles.stateTitle, { color: colors.foreground }]}>
                    Couldn&apos;t load their posts
                  </Text>
                  <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>{feedError}</Text>
                  <Pressable
                    onPress={() => void loadFeed(scopeRef.current, 'initial')}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.retry, { color: colors.accent }]}>Try again</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.centerSmall}>
                  <Feather name="inbox" size={30} color={colors.foregroundSubtle} />
                  <Text style={[styles.stateTitle, { color: colors.foregroundMuted }]}>
                    {EMPTY_STATE[MEMBER_FEED_SCOPE].title}
                  </Text>
                  <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>
                    {EMPTY_STATE[MEMBER_FEED_SCOPE].body}
                  </Text>
                </View>
              )
            }
          />
        </ContentPlaybackProvider>
      )}

      <ContentDetail
        item={selected}
        kind={selected ? feedItemKind(selected) : 'threads'}
        currentUserId={viewerId ?? ''}
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
  heroWrap: { marginBottom: 4 },
  heroDots: {
    position: 'absolute',
    // The band starts at the list's top edge so the texture opens right under
    // the page header, with no bare gutter above it.
    top: -LIST_PADDING,
    left: -LIST_PADDING,
    right: -LIST_PADDING,
    height: DOT_BAND_HEIGHT,
    overflow: 'hidden',
  },
  messageError: {
    fontFamily: 'Geist_400Regular',
    fontSize: 12.5,
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 20,
  },
  list: { padding: LIST_PADDING, gap: 12, flexGrow: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 32,
  },
  centerSmall: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 32,
  },
  stateTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 15, textAlign: 'center' },
  stateBody: {
    fontFamily: 'Geist_400Regular',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  retry: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  footer: { height: 56, alignItems: 'center', justifyContent: 'center' },
  lockCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
});
