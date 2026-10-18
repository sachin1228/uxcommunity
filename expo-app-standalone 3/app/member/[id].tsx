/**
 * A member's profile as other members see it — the mobile reading of the web
 * /dashboard/profile/[userId]: the read-only identity hero, the Message chip
 * that starts a DM (get-or-create, exactly like the web `?peer=` handoff), and
 * the activity tabs listing what they share that the viewer may see.
 *
 * Blocking reshapes the screen the same way it reshapes the web page: the owner
 * blocking the viewer leaves only the neutral unavailable state; the viewer
 * blocking the owner leaves the identity plus the blocked notice, with no tabs
 * and no feed.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ContentCard,
  ContentDetail,
  useContentActions,
} from '@/components/community/contentView';
import { CommunityTabIcon } from '@/components/community/TabIcons';
import { DOT_BAND_HEIGHT, DotField } from '@/components/profile/DotField';
import { MemberProfileHero } from '@/components/profile/MemberProfileHero';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import type { CommunityContent } from '@/lib/communityContent';
import { createDmConversation, unblockUser } from '@/lib/dmApi';
import {
  applyPollEventToFeed,
  feedPollCommunityIds,
  type ThreadPollEvent,
} from '@/lib/feedPollRealtime';
import { feedItemKey, feedItemKind, type FeedItem } from '@/lib/homeFeed';
import { useThreadPollRealtime } from '@/hooks/useThreadPollRealtime';
import {
  getProfileFeed,
  type MemberFeedScope,
} from '@/lib/profileFeed';
import { getMemberProfile, type MemberProfile } from '@/lib/profile';

/** The FlatList content's gutter — the dot band cancels it to run full-bleed. */
const LIST_PADDING = 12;

/** One activity tab per card scope a member's feed serves — the web order. */
const TABS: { key: MemberFeedScope; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'thread', label: 'Threads' },
  { key: 'showcase', label: 'Showcase' },
  { key: 'resource', label: 'Resources' },
  { key: 'event', label: 'Events' },
];

/** The web member feed's empty-state copy, per tab. */
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

function TabIcon({ scope, color }: { scope: MemberFeedScope; color: string }) {
  if (scope === 'all') return <Feather name="grid" size={14} color={color} />;
  const kind =
    scope === 'thread'
      ? 'threads'
      : scope === 'showcase'
        ? 'showcase'
        : scope === 'resource'
          ? 'resources'
          : 'events';
  return <CommunityTabIcon tab={kind} size={14} color={color} />;
}

export default function MemberProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { id: memberId } = useLocalSearchParams<{ id: string }>();
  const actions = useContentActions();

  const [member, setMember] = useState<MemberProfile | null>(null);
  const [memberLoading, setMemberLoading] = useState(true);
  const [memberError, setMemberError] = useState<string | null>(null);

  const [scope, setScope] = useState<MemberFeedScope>('all');
  const scopeRef = useRef<MemberFeedScope>('all');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FeedItem | null>(null);

  const [messaging, setMessaging] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [unblocking, setUnblocking] = useState(false);

  const resetActions = actions.reset;

  const loadMember = useCallback(async () => {
    if (!memberId) return;
    setMemberLoading(true);
    try {
      setMember(await getMemberProfile(memberId));
      setMemberError(null);
    } catch (e) {
      setMemberError(e instanceof Error ? e.message : 'Couldn\u2019t load this profile.');
    } finally {
      setMemberLoading(false);
    }
  }, [memberId]);

  const loadFeed = useCallback(
    async (targetScope: MemberFeedScope, mode: 'initial' | 'refresh') => {
      if (!memberId) return;
      if (mode === 'initial') setFeedLoading(true);
      else setRefreshing(true);
      setFeedError(null);
      try {
        const page = await getProfileFeed(targetScope, undefined, memberId);
        if (scopeRef.current !== targetScope) return;
        setItems(page.items);
        setHasMore(page.hasMore);
        resetActions();
      } catch (e) {
        if (scopeRef.current !== targetScope) return;
        setFeedError(e instanceof Error ? e.message : 'Failed to load this feed.');
      } finally {
        if (scopeRef.current === targetScope) {
          setFeedLoading(false);
          setRefreshing(false);
        }
      }
    },
    [memberId, resetActions],
  );

  useEffect(() => {
    setItems([]);
    setMember(null);
    void loadMember();
  }, [loadMember]);

  // The feed waits for the identity: a blocked pair has no activity to show.
  useEffect(() => {
    if (!member || member.blockedViewer) return;
    if (member.blockedByMe) {
      setFeedLoading(false);
      return;
    }
    void loadFeed(scopeRef.current, 'initial');
  }, [member, loadFeed]);

  const loadMore = useCallback(async () => {
    if (loadingMore || feedLoading || !hasMore || items.length === 0 || !memberId) return;
    const target = scopeRef.current;
    const last = items[items.length - 1];
    setLoadingMore(true);
    try {
      const page = await getProfileFeed(target, last.created_at, memberId);
      if (scopeRef.current !== target) return;
      setItems((current) => {
        const seen = new Set(current.map(feedItemKey));
        return [...current, ...page.items.filter((item) => !seen.has(feedItemKey(item)))];
      });
      setHasMore(page.hasMore);
    } catch {
      // Leave the feed as-is; the member can pull to retry.
    } finally {
      setLoadingMore(false);
    }
  }, [feedLoading, hasMore, items, loadingMore, memberId]);

  // Poll tallies for the threads in this member's feed. Only communities with a
  // visible poll are subscribed — a feed of plain posts opens no sockets.
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
    void loadFeed(scopeRef.current, 'refresh');
  }, [loadFeed]);

  useThreadPollRealtime({
    communityIds: pollCommunityIds,
    onEvent: handlePollEvent,
    onGap: handlePollGap,
  });

  const handleScopeChange = useCallback(
    (next: MemberFeedScope) => {
      if (next === scope) return;
      setScope(next);
      scopeRef.current = next;
      setItems([]);
      setSelected(null);
      void loadFeed(next, 'initial');
    },
    [loadFeed, scope],
  );

  // The comment count is the only route into a post's own page, where the
  // comments live under the post itself; the card body just double-tap likes.
  const openItem = useCallback(
    (item: CommunityContent) => {
      const match = items.find((entry) => entry.id === item.id);
      setSelected(match ?? null);
    },
    [items],
  );

  const openMessage = useCallback(async () => {
    if (messaging || !memberId) return;
    setMessaging(true);
    setMessageError(null);
    try {
      const conversation = await createDmConversation(memberId);
      router.push({
        pathname: '/messages/[id]',
        params: {
          id: conversation.id,
          name: conversation.peer.name,
          avatar: conversation.peer.avatar_url ?? '',
          peerId: conversation.peer.id,
        },
      });
    } catch (e) {
      setMessageError(e instanceof Error ? e.message : 'Could not open messages.');
    } finally {
      setMessaging(false);
    }
  }, [memberId, messaging, router]);

  const handleUnblock = useCallback(async () => {
    if (unblocking || !memberId) return;
    setUnblocking(true);
    try {
      await unblockUser(memberId);
      setMember((current) => (current ? { ...current, blockedByMe: false } : current));
    } catch {
      setMessageError('The block could not be removed. Please try again.');
    } finally {
      setUnblocking(false);
    }
  }, [memberId, unblocking]);

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
      />

      {messageError ? (
        <Text style={[styles.messageError, { color: colors.destructive }]}>{messageError}</Text>
      ) : null}

      {/* The viewer's block reduces the profile to the identity card — the web
          hides the tabs and feed the same way. */}
      {!member?.blockedByMe && !member?.blockedViewer ? (
        <View style={[styles.tabsShell, { borderBottomColor: colors.border }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabs}
          >
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
                    <TabIcon scope={tab.key} color={labelColor} />
                    <Text style={[styles.tabText, { color: labelColor }]}>{tab.label}</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );

  const unavailable = member?.blockedViewer;
  const showFeed = Boolean(member) && !member?.blockedViewer && !member?.blockedByMe;

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
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Profile</Text>
        <View style={styles.headerSpacer} />
      </View>

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
        <FlatList
          data={member?.blockedByMe ? [] : items}
          keyExtractor={feedItemKey}
          renderItem={renderItem}
          ListHeaderComponent={header}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 96 }]}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            showFeed ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  void loadMember();
                  void loadFeed(scopeRef.current, 'refresh');
                }}
                tintColor={colors.foregroundMuted}
              />
            ) : undefined
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footer}>
                <ActivityIndicator size="small" color={colors.foregroundMuted} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            !showFeed ? null : feedLoading ? (
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
                  {EMPTY_STATE[scope].title}
                </Text>
                <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>
                  {EMPTY_STATE[scope].body}
                </Text>
              </View>
            )
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
  heroWrap: { marginBottom: 4 },
  heroDots: {
    position: 'absolute',
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
  tabsShell: {
    marginTop: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabs: {
    minWidth: '100%',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  tab: {
    paddingHorizontal: 12,
    paddingTop: 10,
    borderBottomWidth: 2,
  },
  tabInner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 10 },
  tabText: { fontSize: 12, fontFamily: 'Geist_500Medium' },
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
  footer: { paddingVertical: 16, alignItems: 'center' },
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
