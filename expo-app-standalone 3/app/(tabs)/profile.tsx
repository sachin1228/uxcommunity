import React, { useCallback, useRef, useState } from 'react';
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
import { AccountSideMenu } from '@/components/AccountSideMenu';
import { AvatarPickerModal } from '@/components/profile/AvatarPickerModal';
import { AddLinkModal } from '@/components/profile/AddLinkModal';
import { DOT_BAND_HEIGHT, DotField } from '@/components/profile/DotField';
import { ProfileHero } from '@/components/profile/ProfileHero';
import { AddCompanyModal } from '@/components/companies/AddCompanyModal';
import { CommentsSheet } from '@/components/community/CommentsSheet';
import { ContentDetail, ContentCard, useContentActions } from '@/components/community/contentView';
import { CommunityTabIcon } from '@/components/community/TabIcons';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { CommunityContent } from '@/lib/communityContent';
import { feedItemKey, feedItemKind, type FeedItem } from '@/lib/homeFeed';
import { getProfileFeed, type ProfileFeedScope } from '@/lib/profileFeed';
import { getOwnProfile, uploadAvatar, type OwnProfile } from '@/lib/profile';
import { prepareImageForUpload, type PreparedImage } from '@/lib/prepareImage';

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

/** One activity tab per card scope the profile feed serves — the web order. */
const TABS: { key: ProfileFeedScope; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'thread', label: 'Threads' },
  { key: 'showcase', label: 'Showcase' },
  { key: 'resource', label: 'Resources' },
  { key: 'event', label: 'Events' },
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

function TabIcon({ scope, color }: { scope: ProfileFeedScope; color: string }) {
  if (scope === 'all') return <Feather name="grid" size={14} color={color} />;
  if (scope === 'saved') return <Feather name="bookmark" size={14} color={color} />;
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

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const actions = useContentActions();

  // ── Hero data ──
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

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
  const [commentTarget, setCommentTarget] = useState<FeedItem | null>(null);

  // ── Hero edit flows ──
  const [avatarPick, setAvatarPick] = useState<PreparedImage | null>(null);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [linkModal, setLinkModal] = useState<'linkedin' | 'portfolio' | null>(null);
  const [companyModalOpen, setCompanyModalOpen] = useState(false);

  // ── Header menu ──
  const [menuOpen, setMenuOpen] = useState(false);

  const resetActions = actions.reset;

  const loadProfile = useCallback(async () => {
    try {
      setProfile(await getOwnProfile());
      setProfileError(null);
    } catch {
      setProfileError('Couldn\u2019t load your profile. Pull to retry.');
    }
  }, []);

  const loadFeed = useCallback(
    async (targetScope: ProfileFeedScope, mode: 'initial' | 'refresh') => {
      if (mode === 'initial') setFeedLoading(true);
      else setRefreshing(true);
      setFeedError(null);
      try {
        const page = await getProfileFeed(targetScope);
        if (scopeRef.current !== targetScope) return;
        setItems(page.items);
        setHasMore(page.hasMore);
        resetActions();
      } catch (e) {
        if (scopeRef.current !== targetScope) return;
        setFeedError(e instanceof Error ? e.message : 'Failed to load your posts.');
      } finally {
        if (scopeRef.current === targetScope) {
          setFeedLoading(false);
          setRefreshing(false);
        }
      }
    },
    [resetActions],
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
    if (loadingMore || feedLoading || !hasMore || items.length === 0) return;
    const target = scopeRef.current;
    const last = items[items.length - 1];
    setLoadingMore(true);
    try {
      const page = await getProfileFeed(target, last.created_at);
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
  }, [feedLoading, hasMore, items, loadingMore]);

  const handleScopeChange = useCallback(
    (next: ProfileFeedScope) => {
      if (next === scope) return;
      setScope(next);
      scopeRef.current = next;
      setItems([]);
      setSelected(null);
      void loadFeed(next, 'initial');
    },
    [loadFeed, scope],
  );

  const openComments = useCallback(
    (item: CommunityContent) => {
      const match = items.find((entry) => entry.id === item.id);
      setCommentTarget(match ?? null);
    },
    [items],
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
      setProfile((current) =>
        current?.profile
          ? { ...current, profile: { ...current.profile, avatar_url: avatarUrl } }
          : current,
      );
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
  }, [avatarPick, avatarSaving]);

  const handleLinkSaved = useCallback((field: 'linkedin_url' | 'portfolio_url', url: string) => {
    setProfile((current) =>
      current?.profile ? { ...current, profile: { ...current.profile, [field]: url || null } } : current,
    );
    setLinkModal(null);
  }, []);

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

  const body = profile?.profile;
  const hero = (
    <View style={styles.heroWrap}>
      {/* Full-bleed dotted backdrop — the web profile's texture, anchored to
          the hero so it scrolls away with it, as on the web page. */}
      <View pointerEvents="none" style={styles.heroDots}>
        <DotField />
      </View>

      <ProfileHero
        name={profile?.user?.name ?? user?.name ?? ''}
        avatarUrl={body?.avatar_url ?? null}
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

      {/* ── Activity tabs — the app's underline vocabulary, web's tab set ── */}
      <View style={[styles.tabsShell, { borderBottomColor: colors.border }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
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
    </View>
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
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Profile</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Menu"
          hitSlop={10}
          onPress={() => setMenuOpen(true)}
          style={styles.menuButton}
        >
          <Feather name="menu" size={22} color={colors.foreground} />
        </Pressable>
      </View>

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
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 96 }]}
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

      <AccountSideMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontFamily: 'Geist_600SemiBold' },
  heroWrap: { marginBottom: 4 },
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
    minWidth: '100%',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  tab: {
    minWidth: 74,
    height: 46,
    paddingHorizontal: 12,
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
