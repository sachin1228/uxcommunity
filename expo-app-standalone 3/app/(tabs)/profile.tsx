import React, { useCallback, useMemo, useRef, useState } from 'react';
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
import { Feather } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { AvatarPickerModal } from '@/components/profile/AvatarPickerModal';
import { AddLinkModal } from '@/components/profile/AddLinkModal';
import { DOT_BAND_HEIGHT, DotField } from '@/components/profile/DotField';
import { ProfileHero } from '@/components/profile/ProfileHero';
import { AddCompanyModal } from '@/components/companies/AddCompanyModal';
import { ContentDetail, ContentCard, useContentActions } from '@/components/community/contentView';
import { CommunityContentEditor } from '@/components/community/CommunityContentEditor';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useViewableKeys } from '@/hooks/useViewableKeys';
import { CommunityContent, deleteCommunityContent } from '@/lib/communityContent';
import { chatContentKindForTab } from '@/lib/chatContentEvents';
import { notifyContentEvent } from '@/lib/contentEventMirror';
import { applyPollEventToFeed, feedPollCommunityIds, type ThreadPollEvent } from '@/lib/feedPollRealtime';
import { feedItemKey, feedItemKind, type FeedItem } from '@/lib/homeFeed';
import { getProfileFeed, type ProfileFeedScope } from '@/lib/profileFeed';
import { useThreadPollRealtime } from '@/hooks/useThreadPollRealtime';
import { hapticSelection } from '@/lib/haptics';
import { getOwnProfile, uploadAvatar, type OwnProfile } from '@/lib/profile';
import { prepareImageForUpload, type PreparedImage } from '@/lib/prepareImage';
import { fetchScreenData, peekScreenData, readScreenData, writeScreenData } from '@/lib/screenDataCacheStore';
import { mergeUniquePage, SCREEN_CACHE_TTL_MS } from '@/lib/screenDataCache';
import {
  ownProfileCacheSnapshot,
  ownProfileFromCache,
  ownProfileFromServer,
  type OwnProfileSnapshot,
  type OwnProfileView,
} from '@/lib/profileCache';

/**
 * Profile — the member's own profile, mirroring the web /dashboard/profile:
 * the same hero (picture with its change-picture flow, role line with the
 * workplace, city, links and bio) and the same activity tabs, rendering the
 * identical feed cards through the shared card component.
 *
 * The hero refetches on focus so an edit made in Settings reads back the
 * moment the member returns.
 */

/** The FlatList content's gutter — the dot band cancels it to run full-bleed. */
const LIST_PADDING = 12;

/** The profile keeps two activity scopes — everything authored, and saves. */
const TABS: { key: ProfileFeedScope; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'saved', label: 'Saved' },
];

/** The web feed's EMPTY_STATE copy, verbatim. */
const EMPTY_STATE: Record<ProfileFeedScope, { title: string; body: string }> = {
  all: {
    title: 'Nothing here yet',
    body: 'Threads, showcase posts, resources and events you create will appear here.',
  },
  thread: {
    title: 'No threads yet',
    body: 'Threads you start in a community will appear here.',
  },
  showcase: {
    title: 'No showcase posts yet',
    body: 'Work you share in a community showcase will appear here.',
  },
  resource: {
    title: 'No resources yet',
    body: 'Resources you share in a community will appear here.',
  },
  event: {
    title: 'No events yet',
    body: 'Events you host in a community will appear here.',
  },
  saved: {
    title: 'Nothing saved yet',
    body: 'Save a thread, event, resource or showcase post and it will appear here.',
  },
};

interface ProfileFeedSnapshot {
  items: FeedItem[];
  hasMore: boolean;
}

const OWN_PROFILE_CACHE_KEY = 'own-profile:hero';

function profileFeedCacheKey(scope: ProfileFeedScope): string {
  return `profile-feed:${scope}`;
}

export default function ProfileScreen() {
  const { user, sessionEpoch } = useAuth();
  const userId = user?.id ?? null;
  return (
    <ProfileTabSession
      key={`${userId ?? 'signed-out'}:${sessionEpoch}`}
      userId={userId}
      sessionEpoch={sessionEpoch}
    />
  );
}

function ProfileTabSession({
  userId,
  sessionEpoch,
}: {
  userId: string | null;
  sessionEpoch: number;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  // ── Hero data ──
  const [profile, setProfile] = useState<OwnProfileView | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const profileSequenceRef = useRef(0);
  const profileCacheReadyRef = useRef(false);

  // ── Activity feed ──
  const [scope, setScope] = useState<ProfileFeedScope>('all');
  const scopeRef = useRef<ProfileFeedScope>('all');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FeedItem | null>(null);
  const { visibleKeys, onViewableItemsChanged, viewabilityConfig } = useViewableKeys();
  /** The activity row whose editor is open (owner-only; null when closed). */
  const [editing, setEditing] = useState<FeedItem | null>(null);
  const itemsRef = useRef(items);
  const hasMoreRef = useRef(hasMore);
  const requestSequenceRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const readyScopeRef = useRef<string | null>(null);
  const cacheSessionKey = `${userId ?? ''}:${sessionEpoch}`;
  itemsRef.current = items;
  hasMoreRef.current = hasMore;

  // ── Hero edit flows ──
  const [avatarPick, setAvatarPick] = useState<PreparedImage | null>(null);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [linkModal, setLinkModal] = useState<'linkedin' | 'portfolio' | null>(null);
  const [companyModalOpen, setCompanyModalOpen] = useState(false);

  // ── Header settings shortcut ──
  const openSettings = useCallback(() => {
    hapticSelection();
    router.push('/settings');
  }, [router]);

  const commitProfile = useCallback((next: OwnProfileView, persist = true) => {
    profileRef.current = next;
    setProfile(next);
    if (persist && userId && profileCacheReadyRef.current) {
      const safeSnapshot = ownProfileCacheSnapshot(next);
      void writeScreenData(
        userId,
        OWN_PROFILE_CACHE_KEY,
        sessionEpoch,
        safeSnapshot,
        SCREEN_CACHE_TTL_MS.ownProfile,
      );
    }
  }, [sessionEpoch, userId]);

  const commitFeed = useCallback(
    (targetScope: ProfileFeedScope, nextItems: FeedItem[], nextHasMore: boolean, persist = true) => {
      itemsRef.current = nextItems;
      hasMoreRef.current = nextHasMore;
      setItems(nextItems);
      setHasMore(nextHasMore);
      if (persist && userId && readyScopeRef.current === `${cacheSessionKey}:${targetScope}`) {
        void writeScreenData(
          userId,
          profileFeedCacheKey(targetScope),
          sessionEpoch,
          { items: nextItems, hasMore: nextHasMore },
          SCREEN_CACHE_TTL_MS.profileFeed,
        );
      }
    },
    [cacheSessionKey, sessionEpoch, userId],
  );

  const persistCardMutation = useCallback(
    (source: CommunityContent, patch: Record<string, unknown>) => {
      requestSequenceRef.current += 1;
      setRefreshing(false);
      const next = itemsRef.current.map((item) =>
        item.id === source.id && item.community_id === source.community_id
          ? { ...item, ...patch }
          : item,
      );
      commitFeed(scopeRef.current, next, hasMoreRef.current);
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

  const loadProfile = useCallback(async () => {
    if (!userId) return;
    const sequence = ++profileSequenceRef.current;
    let cachedPainted = false;
    let networkSucceeded = false;
    const isCurrent = () => profileSequenceRef.current === sequence;
    const memory = peekScreenData<OwnProfileSnapshot>(
      userId,
      OWN_PROFILE_CACHE_KEY,
      sessionEpoch,
      SCREEN_CACHE_TTL_MS.ownProfile,
    );
    if (memory) {
      cachedPainted = true;
      profileCacheReadyRef.current = true;
      commitProfile(ownProfileFromCache(memory.data), false);
    }
    void readScreenData<OwnProfileSnapshot>(
      userId,
      OWN_PROFILE_CACHE_KEY,
      sessionEpoch,
      SCREEN_CACHE_TTL_MS.ownProfile,
    ).then((snapshot) => {
      if (!snapshot || cachedPainted || networkSucceeded || !isCurrent()) return;
      cachedPainted = true;
      profileCacheReadyRef.current = true;
      commitProfile(ownProfileFromCache(snapshot.data), false);
    });
    try {
      const result = await fetchScreenData(
        userId,
        OWN_PROFILE_CACHE_KEY,
        sessionEpoch,
        SCREEN_CACHE_TTL_MS.ownProfile,
        getOwnProfile,
        ownProfileCacheSnapshot,
      );
      if (!result.accepted || !isCurrent()) return;
      networkSucceeded = true;
      profileCacheReadyRef.current = true;
      commitProfile(ownProfileFromServer(result.data));
      setProfileError(null);
    } catch {
      if (isCurrent()) setProfileError('Couldn\u2019t load your profile. Pull to retry.');
    }
  }, [commitProfile, sessionEpoch, userId]);

  const loadFeed = useCallback(
    async (targetScope: ProfileFeedScope, mode: 'initial' | 'refresh') => {
      if (!userId) {
        setFeedLoading(false);
        setFeedError('Sign in to load your posts.');
        return;
      }
      const sequence = ++requestSequenceRef.current;
      const cacheKey = profileFeedCacheKey(targetScope);
      const cacheIdentity = `${cacheSessionKey}:${targetScope}`;
      let cachedPainted = false;
      let networkSucceeded = false;
      const isCurrent = () => requestSequenceRef.current === sequence && scopeRef.current === targetScope;
      if (mode === 'initial') {
        setRefreshing(false);
        const memory = peekScreenData<ProfileFeedSnapshot>(userId, cacheKey, sessionEpoch, SCREEN_CACHE_TTL_MS.profileFeed);
        if (memory) {
          cachedPainted = true;
          readyScopeRef.current = cacheIdentity;
          commitFeed(targetScope, memory.data.items, memory.data.hasMore, false);
          setFeedLoading(false);
          resetActions();
          if (memory.isFresh) {
            setFeedError(null);
            return;
          }
        } else {
          setFeedLoading(true);
        }
        void readScreenData<ProfileFeedSnapshot>(userId, cacheKey, sessionEpoch, SCREEN_CACHE_TTL_MS.profileFeed).then((snapshot) => {
          if (!snapshot || cachedPainted || networkSucceeded || !isCurrent()) return;
          cachedPainted = true;
          readyScopeRef.current = cacheIdentity;
          commitFeed(targetScope, snapshot.data.items, snapshot.data.hasMore, false);
          resetActions();
          setFeedLoading(false);
        });
      } else {
        setRefreshing(true);
      }
      setFeedError(null);
      try {
        const result = await fetchScreenData(
          userId,
          cacheKey,
          sessionEpoch,
          SCREEN_CACHE_TTL_MS.profileFeed,
          () => getProfileFeed(targetScope),
        );
        if (!result.accepted || !isCurrent()) return;
        networkSucceeded = true;
        readyScopeRef.current = cacheIdentity;
        commitFeed(targetScope, result.data.items, result.data.hasMore);
        resetActions();
      } catch (e) {
        if (!isCurrent()) return;
        setFeedError(e instanceof Error ? e.message : 'Failed to load your posts.');
      } finally {
        if (isCurrent()) {
          setFeedLoading(false);
          setRefreshing(false);
        }
      }
    },
    [cacheSessionKey, commitFeed, resetActions, sessionEpoch, userId],
  );

  // Refetch the hero (an identity edit happened in Settings, a company may be
  // new) and settle the feed every time the screen comes back into focus. The
  // first focus is the initial load; later focuses keep the list on screen.
  const firstFocusRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      void loadProfile();
      void loadFeed(scopeRef.current, firstFocusRef.current ? 'initial' : 'refresh');
      firstFocusRef.current = false;
    }, [loadProfile, loadFeed]),
  );

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || feedLoading || !hasMoreRef.current || itemsRef.current.length === 0 || !userId) return;
    const target = scopeRef.current;
    const last = itemsRef.current[itemsRef.current.length - 1];
    const sequence = requestSequenceRef.current;
    setLoadingMore(true);
    loadingMoreRef.current = true;
    try {
      const page = await getProfileFeed(target, last.created_at);
      if (scopeRef.current !== target || requestSequenceRef.current !== sequence) return;
      commitFeed(target, mergeUniquePage(itemsRef.current, page.items, feedItemKey), page.hasMore);
    } catch {
      // Leave the feed as-is; the user can pull to retry.
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [commitFeed, feedLoading, userId]);

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
    void loadFeed(scopeRef.current, 'refresh');
  }, [loadFeed]);

  useThreadPollRealtime({
    communityIds: pollCommunityIds,
    onEvent: handlePollEvent,
    onGap: handlePollGap,
  });

  const handleScopeChange = useCallback(
    (next: ProfileFeedScope) => {
      if (next === scope) return;
      requestSequenceRef.current += 1;
      setScope(next);
      scopeRef.current = next;
      commitFeed(next, [], true, false);
      setSelected(null);
      void loadFeed(next, 'initial');
    },
    [commitFeed, loadFeed, scope],
  );

  // The comment count is the only route into a post's own page, where the
  // comments live under the post itself; the card body just double-tap likes.
  const openItem = useCallback(
    (item: CommunityContent) => {
      const match = itemsRef.current.find((entry) => entry.id === item.id);
      setSelected(match ?? null);
    },
    [],
  );

  // An edit response carries the post's own fields, not the feed row's
  // `_type` / community attribution — keep the row's copy of those.
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
      notifyContentEvent({
        kind: 'delete',
        communityId: row.community_id,
        id: row.id,
        contentKind: chatContentKindForTab(kind),
      });
    },
    [commitFeed],
  );

  // ── Change picture — the OS library sheet is the file chooser, then the
  //    confirm modal previews and saves, exactly like the web flow. ──
  const handleChangePicture = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      // No intermediate loss — prepareImageForUpload applies the final WebP
      // quality-0.90 encode (max dimension 2560, never upscaled).
      quality: 1,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setAvatarError(null);
    try {
      setAvatarPick(await prepareImageForUpload(asset, `profile-picture-${Date.now()}`));
    } catch {
      // Keep the original picked image as a last-resort fallback.
      setAvatarPick({
        uri: asset.uri,
        mimeType: 'image/jpeg',
        name: `profile-picture-${Date.now()}.jpg`,
        width: asset.width,
        height: asset.height,
      });
    }
  }, []);

  const handleSaveAvatar = useCallback(async () => {
    if (!avatarPick || avatarSaving) return;
    setAvatarSaving(true);
    setAvatarError(null);
    try {
      const avatarUrl = await uploadAvatar(avatarPick);
      const current = profileRef.current;
      if (current?.profile) {
        commitProfile({ ...current, profile: { ...current.profile, avatar_url: avatarUrl } });
      }
      setAvatarPick(null);
    } catch (e) {
      // A server rejection carries its own copy; anything else is the wire.
      const hasStatus = typeof (e as { status?: number }).status === 'number';
      setAvatarError(
        hasStatus && e instanceof Error ? e.message : 'Network error. Please try again.',
      );
    } finally {
      setAvatarSaving(false);
    }
  }, [avatarPick, avatarSaving, commitProfile]);

  const handleLinkSaved = useCallback((field: 'linkedin_url' | 'portfolio_url', url: string) => {
    const current = profileRef.current;
    if (current?.profile) {
      commitProfile({ ...current, profile: { ...current.profile, [field]: url || null } });
    }
    setLinkModal(null);
  }, [commitProfile]);

  const renderItem = useCallback(
    ({ item, index }: { item: FeedItem; index: number }) => (
      <ContentCard
        item={item}
        kind={feedItemKind(item)}
        currentUserId={userId ?? ''}
        actions={actions}
        communityName={item.community_name}
        communityImage={item.community_image}
        onComments={openItem}
        onEdit={editItem}
        onDelete={deleteItem}
        videoActive={!selected && visibleKeys.has(feedItemKey(item))}
        videoRank={index}
      />
    ),
    [actions, deleteItem, editItem, openItem, selected, userId, visibleKeys],
  );

  const body = profile?.profile;
  const hero = (
    <View style={styles.heroWrap}>
      {/* Full-bleed dotted backdrop — the web profile's texture, anchored to
          the hero so it scrolls away with it, as on the web page. */}
      <View pointerEvents="none" style={styles.heroDots}>
        <DotField />
      </View>

      <View style={styles.heroTop}>
        <ProfileHero
          name={profile?.user?.name ?? user?.name ?? ''}
          // The session already carries the member's picture, so the hero shows
          // the real DP from the first frame instead of a flash of initials
          // while GET /api/profile is in flight.
          avatarUrl={body?.avatar_url ?? user?.avatar_url ?? null}
          city={body?.cities?.name ?? null}
          roleLabel={profile?.roleLabel ?? null}
          bio={body?.bio ?? ''}
          company={profile?.company ?? null}
          linkedinUrl={body?.linkedin_url ?? ''}
          portfolioUrl={body?.portfolio_url ?? ''}
          onPressAvatar={() => void handleChangePicture()}
          onAddLinkedIn={() => setLinkModal('linkedin')}
          onAddPortfolio={() => setLinkModal('portfolio')}
          onAddCompany={() => setCompanyModalOpen(true)}
          onEdit={() => router.push('/settings/profile')}
        />
      </View>

      {/* ── Activity tabs — the app's underline vocabulary, web's tab set ── */}
      <View style={[styles.tabsShell, { borderBottomColor: colors.border }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {TABS.map((entry) => {
            const active = scope === entry.key;
            const labelColor = active ? colors.foreground : colors.mutedForeground;
            return (
              <Pressable
                key={entry.key}
                onPress={() => handleScopeChange(entry.key)}
                style={[styles.tab, { borderBottomColor: active ? colors.accent : 'transparent' }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <View style={styles.tabInner}>
                  <Feather
                    name={entry.key === 'all' ? 'grid' : 'bookmark'}
                    size={14}
                    color={labelColor}
                  />
                  <Text style={[styles.tabText, { color: labelColor }]}>{entry.label}</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Settings"
        hitSlop={6}
        onPress={openSettings}
        style={({ pressed }) => [
          styles.settingsButton,
          {
            top: insets.top + 16,
            backgroundColor: colors.surfaceRaised,
            borderColor: colors.border,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        <Feather name="settings" size={22} color={colors.foreground} />
      </Pressable>

      {profileError && !profile ? (
        <View style={styles.center}>
          <Feather name="wifi-off" size={28} color={colors.foregroundMuted} />
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>
            Couldn&apos;t load your profile
          </Text>
          <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>{profileError}</Text>
          <Pressable onPress={() => void loadProfile()} accessibilityRole="button">
            <Text style={[styles.retry, { color: colors.accent }]}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={feedItemKey}
          renderItem={renderItem}
          ListHeaderComponent={hero}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          contentContainerStyle={[
            styles.list,
            { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 96 },
          ]}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                void loadProfile();
                void loadFeed(scopeRef.current, 'refresh');
              }}
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
            feedLoading ? (
              <View style={styles.centerSmall}>
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : feedError ? (
              <View style={styles.centerSmall}>
                <Feather name="wifi-off" size={26} color={colors.foregroundMuted} />
                <Text style={[styles.stateTitle, { color: colors.foreground }]}>
                  Couldn&apos;t load your posts
                </Text>
                <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>{feedError}</Text>
                <Pressable onPress={() => void loadFeed(scopeRef.current, 'initial')} accessibilityRole="button">
                  <Text style={[styles.retry, { color: colors.accent }]}>Try again</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.centerSmall}>
                <Feather
                  name={scope === 'saved' ? 'bookmark' : 'inbox'}
                  size={30}
                  color={colors.foregroundSubtle}
                />
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

      <AvatarPickerModal
        visible={avatarPick !== null}
        previewUri={avatarPick?.uri ?? null}
        saving={avatarSaving}
        error={avatarError}
        onSave={() => void handleSaveAvatar()}
        onClose={() => {
          if (avatarSaving) return;
          setAvatarPick(null);
          setAvatarError(null);
        }}
      />

      {linkModal ? (
        <AddLinkModal
          kind={linkModal}
          initialUrl={(linkModal === 'linkedin' ? body?.linkedin_url : body?.portfolio_url) ?? ''}
          onSaved={(url) => handleLinkSaved(linkModal === 'linkedin' ? 'linkedin_url' : 'portfolio_url', url)}
          onClose={() => setLinkModal(null)}
        />
      ) : null}

      {/* Mounted only while open: the picker's state is per-attempt, so
          unmounting it is what resets the search, the email and the code. */}
      {companyModalOpen ? (
        <AddCompanyModal
          visible
          initialPending={profile?.pendingCompany ?? null}
          onVerified={() => void loadProfile()}
          onClose={() => setCompanyModalOpen(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  settingsButton: {
    position: 'absolute',
    right: 11,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  heroWrap: { marginBottom: 4 },
  // Extra breathing room above the display picture now that the header is
  // gone. The dotted backdrop is absolutely positioned, so it stays anchored
  // to the top of the hero while the picture moves down.
  heroTop: { paddingTop: 32 },
  heroDots: {
    position: 'absolute',
    // The list's own top gutter would leave a bare strip under the screen
    // header, so the band starts at the list's top edge instead — the web
    // texture begins at the page's top the same way.
    top: -LIST_PADDING,
    left: -LIST_PADDING,
    right: -LIST_PADDING,
    height: DOT_BAND_HEIGHT,
  },
  tabsShell: {
    marginTop: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabs: {
    flexGrow: 1,
    minWidth: '100%',
    justifyContent: 'center',
  },
  tab: {
    flex: 1,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
  },
  tabInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
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
  footer: { paddingVertical: 20, alignItems: 'center' },
});
