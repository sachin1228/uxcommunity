import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/AppHeader';
import { CommunityPreviewSheet } from '@/components/community/CommunityPreviewSheet';
import { CommunityNameBadges } from '@/components/communities/CommunityBadges';
import { Initials } from '@/components/communities/CommunityRow';
import { useColors } from '@/hooks/useColors';
import {
  EXPLORE_TABS,
  splitExploreRows,
  visibleExploreRows,
  type ExploreCommunity,
  type ExploreTabValue,
} from '@/lib/exploreCommunities';
import { getExploreCommunities, withdrawJoinRequest } from '@/lib/exploreCommunitiesApi';
import { hapticSelection } from '@/lib/haptics';
import { resolveProfilePictureUri } from '@/lib/profilePicture';

/**
 * Explore — the web browse page (`/dashboard/communities`) ported: every
 * community the member can discover, with their standing on each row.
 *
 * The same four pills narrow the same list (All / Public / Private / Requests
 * sent), the same two sections split it by whether the member can join
 * outright, and the same rules hide what is never browsable — a community they
 * already joined lives in Chat, and the groups the server provisions from
 * profile fields are joined by match rather than by browsing. Both rules live
 * in `lib/exploreCommunities.ts` so a test pins them down.
 *
 * Joining goes through the feed's community sheet, which is already the app's
 * one join dialog: it reads the community live, covers the member / requested /
 * profile-gated states, and refreshes the Chat list when a join lands.
 */

/** How a row's action button reads and behaves. */
type CardAction = 'join' | 'request' | 'joined' | 'requested' | 'locked' | 'withdraw';

function actionFor(community: ExploreCommunity, onRequestsTab: boolean): CardAction {
  if (onRequestsTab) return 'withdraw';
  if (community.joined) return 'joined';
  if (!community.can_join) return 'locked';
  if (community.has_pending_request) return 'requested';
  return community.is_private === true ? 'request' : 'join';
}

const ACTION_LABEL: Record<CardAction, string> = {
  join: 'Join',
  request: 'Request to join',
  joined: 'Joined',
  requested: 'Request sent',
  locked: 'Join',
  withdraw: 'Withdraw',
};

interface Section {
  key: string;
  title: string;
  data: ExploreCommunity[];
}

export default function ExploreTab() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [rows, setRows] = useState<ExploreCommunity[]>([]);
  const [tab, setTab] = useState<ExploreTabValue>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  /** The community whose join sheet is open — the sheet reads it live. */
  const [previewId, setPreviewId] = useState<string | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      setRows(await getExploreCommunities());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load communities.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => visibleExploreRows(rows, tab, query), [rows, tab, query]);

  const sections = useMemo<Section[]>(() => {
    if (tab === 'requests') {
      return [{ key: 'pending', title: 'Pending requests', data: visible }];
    }
    const { recommended, rest } = splitExploreRows(visible);
    const out: Section[] = [];
    if (recommended.length > 0) {
      out.push({ key: 'recommended', title: 'Recommended for you', data: recommended });
    }
    if (rest.length > 0) {
      // Web only names this section when something sits above it; on its own the
      // list needs no heading.
      out.push({
        key: 'rest',
        title: recommended.length > 0 ? (tab === 'all' ? 'All communities' : 'More communities') : '',
        data: rest,
      });
    }
    return out;
  }, [tab, visible]);

  const openPreview = useCallback(
    (community: ExploreCommunity) => {
      hapticSelection();
      setPreviewId(community.id);
    },
    [],
  );

  /** Take back a pending request — the row leaves the Requests tab. */
  const withdraw = useCallback(
    async (community: ExploreCommunity) => {
      if (withdrawingId) return;
      setWithdrawingId(community.id);
      setWithdrawError(null);
      try {
        await withdrawJoinRequest(community.id);
        setRows((current) =>
          current.map((row) =>
            row.id === community.id ? { ...row, has_pending_request: false } : row,
          ),
        );
      } catch {
        setWithdrawError("Couldn't withdraw the request. Please try again.");
      } finally {
        setWithdrawingId(null);
      }
    },
    [withdrawingId],
  );

  const isRequestsTab = tab === 'requests';
  const isEmptyResult = !loading && !error && visible.length === 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      <AppHeader />

      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <Text style={[styles.pageTitle, { color: colors.foreground }]}>Explore Communities</Text>
          <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>
            Find the groups you want to be part of.
          </Text>
        </View>
      </View>

      <View style={styles.searchRow}>
        <View
          style={[
            styles.searchField,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Feather name="search" size={15} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search communities…"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search communities"
            style={[styles.searchInput, { color: colors.foreground }]}
          />
          {query.length > 0 && (
            <Pressable
              onPress={() => setQuery('')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Feather name="x" size={14} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabStrip}
        contentContainerStyle={styles.tabStripContent}
      >
        {EXPLORE_TABS.map((item) => {
          const active = tab === item.value;
          return (
            <Pressable
              key={item.value}
              onPress={() => {
                hapticSelection();
                setTab(item.value);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                styles.tabPill,
                {
                  borderColor: active ? colors.foreground : colors.border,
                  backgroundColor: active ? colors.foreground : colors.background,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.tabPillText,
                  { color: active ? colors.background : colors.mutedForeground },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {withdrawError && !isEmptyResult && (
        <View
          style={[
            styles.notice,
            { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.noticeText, { color: colors.destructive }]}>{withdrawError}</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error && rows.length === 0 ? (
        <View style={styles.center}>
          <Feather name="wifi-off" size={28} color={colors.foregroundMuted} />
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>
            Couldn&apos;t load communities
          </Text>
          <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>{error}</Text>
          <Pressable onPress={() => void load('initial')} accessibilityRole="button">
            <Text style={[styles.retry, { color: colors.accent }]}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) =>
            section.title ? (
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                {section.title}
              </Text>
            ) : null
          }
          renderItem={({ item }) => (
            <ExploreCard
              community={item}
              action={actionFor(item, isRequestsTab)}
              withdrawing={withdrawingId === item.id}
              onOpen={openPreview}
              onWithdraw={withdraw}
            />
          )}
          ListEmptyComponent={
            isEmptyResult ? (
              <View style={styles.empty}>
                <Feather
                  name={isRequestsTab ? 'clock' : 'search'}
                  size={26}
                  color={colors.foregroundSubtle}
                />
                <Text style={[styles.stateTitle, { color: colors.foregroundMuted }]}>
                  {isRequestsTab ? 'No pending requests' : 'No communities found'}
                </Text>
                <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>
                  {isRequestsTab
                    ? "Requests you send to private communities will wait here until an owner accepts them."
                    : query.trim()
                      ? 'Try a different name.'
                      : 'Try another tab.'}
                </Text>
              </View>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load('refresh')}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        />
      )}

      {/* Closing the sheet re-reads the list: a join or a request changes the
          row's standing, and a joined community leaves the browse tabs. */}
      <CommunityPreviewSheet
        visible={previewId !== null}
        communityId={previewId}
        onClose={() => {
          setPreviewId(null);
          void load('refresh');
        }}
      />
    </View>
  );
}

function ExploreCard({
  community,
  action,
  withdrawing,
  onOpen,
  onWithdraw,
}: {
  community: ExploreCommunity;
  action: CardAction;
  withdrawing: boolean;
  onOpen: (community: ExploreCommunity) => void;
  onWithdraw: (community: ExploreCommunity) => void;
}) {
  const colors = useColors();
  const imageUri = resolveProfilePictureUri(community.image_url);
  // A community closed to this profile keeps its action, but at the web page's
  // faded weight — the row explains itself through the sheet, not the button.
  const disabled = action === 'locked' || action === 'requested';
  const isMember = action === 'joined';

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surfaceRaised,
          borderColor: disabled ? colors.borderSubtle : colors.border,
        },
      ]}
    >
      <View style={styles.cardTop}>
        <Pressable
          onPress={() => onOpen(community)}
          accessibilityRole="button"
          accessibilityLabel={`View ${community.name}`}
          style={styles.cardIdentity}
        >
          <View style={disabled ? styles.faded : undefined}>
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={styles.avatar} />
            ) : (
              <Initials name={community.name} size={40} colors={colors} />
            )}
          </View>
          <View style={styles.cardText}>
            <View style={styles.nameRow}>
              <Text
                style={[styles.name, { color: colors.foreground }]}
                numberOfLines={1}
              >
                {community.name}
              </Text>
              <CommunityNameBadges
                type={community.type}
                isPrivate={community.is_private}
                size={12}
              />
            </View>
            <Text style={[styles.members, { color: colors.mutedForeground }]}>
              {community.member_count.toLocaleString()}{' '}
              {community.member_count === 1 ? 'member' : 'members'}
            </Text>
          </View>
        </Pressable>

        <Pressable
          onPress={() => {
            if (action === 'withdraw') {
              hapticSelection();
              void onWithdraw(community);
              return;
            }
            if (disabled) return;
            onOpen(community);
          }}
          accessibilityRole="button"
          accessibilityLabel={ACTION_LABEL[action]}
          accessibilityState={{ disabled }}
          style={({ pressed }) => [
            styles.action,
            {
              borderColor: isMember ? colors.accent : colors.border,
              backgroundColor: pressed && !disabled ? colors.card : 'transparent',
              opacity: disabled ? 0.6 : 1,
            },
          ]}
        >
          {action === 'withdraw' && withdrawing ? (
            <ActivityIndicator size="small" color={colors.foreground} />
          ) : (
            <>
              {action === 'joined' && (
                <Feather name="check" size={12} color={colors.accent} />
              )}
              {action === 'locked' && (
                <Feather name="lock" size={12} color={colors.mutedForeground} />
              )}
              <Text
                style={[
                  styles.actionText,
                  { color: isMember ? colors.accent : colors.foreground },
                ]}
              >
                {ACTION_LABEL[action]}
              </Text>
            </>
          )}
        </Pressable>
      </View>

      {community.description ? (
        <Text
          style={[styles.description, disabled ? styles.faded : null, { color: colors.mutedForeground }]}
          numberOfLines={2}
        >
          {community.description}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
  },
  pageHeaderText: { flex: 1, gap: 4 },
  pageTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 20, letterSpacing: -0.3 },
  pageSubtitle: { fontFamily: 'Geist_400Regular', fontSize: 13, lineHeight: 19 },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  searchField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 40,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Geist_400Regular',
    paddingVertical: 0,
  },

  tabStrip: { flexGrow: 0 },
  tabStripContent: { gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  tabPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  tabPillText: { fontFamily: 'Geist_500Medium', fontSize: 13.5 },

  notice: {
    marginHorizontal: 16,
    marginBottom: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  noticeText: { fontFamily: 'Geist_400Regular', fontSize: 12.5, lineHeight: 18 },

  sectionTitle: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 14,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },

  card: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 8,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  cardText: { flex: 1, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 15,
    flexShrink: 1,
  },
  members: { fontFamily: 'Geist_400Regular', fontSize: 12 },
  description: { fontFamily: 'Geist_400Regular', fontSize: 12.5, lineHeight: 18, paddingLeft: 50 },

  action: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  actionText: { fontFamily: 'Geist_500Medium', fontSize: 12.5 },

  faded: { opacity: 0.5 },

  center: {
    flex: 1,
    minHeight: 300,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 32,
  },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 44, paddingHorizontal: 32 },
  stateTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 15, textAlign: 'center' },
  stateBody: {
    fontFamily: 'Geist_400Regular',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 320,
  },
  retry: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
});
