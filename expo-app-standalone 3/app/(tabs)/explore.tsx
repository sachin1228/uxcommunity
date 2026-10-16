/**
 * Explore — the mobile rendering of the web /dashboard/communities browse page.
 *
 * One fetch of `GET /api/communities/all` (the whole directory, no paging) with
 * the same four tabs: All / Public / Private browse the discovery list (joined
 * rows and profile-mirror communities are never listed) and "Requests sent" is
 * the member's own outgoing requests. Rows the profile can join are grouped as
 * "Recommended for you"; the rest sit under the second heading with a lock.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/AppHeader';
import { useColors } from '@/hooks/useColors';
import {
  EXPLORE_TABS,
  memberCountLabel,
  splitExploreRows,
  visibleExploreRows,
  type ExploreCommunity,
  type ExploreTabValue,
} from '@/lib/explore';
import {
  getExploreCommunities,
  joinCommunity,
  withdrawJoinRequest,
} from '@/lib/exploreApi';

export default function ExploreScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [communities, setCommunities] = useState<ExploreCommunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ExploreTabValue>('all');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  /** The private community whose request modal is open, if any. */
  const [requestTarget, setRequestTarget] = useState<ExploreCommunity | null>(null);
  /** Communities with a join/withdraw in flight (their buttons disable). */
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    else setRefreshing(true);
    try {
      const rows = await getExploreCommunities();
      setCommunities(rows);
      setError(null);
    } catch (e) {
      if (mode === 'initial') setError(e instanceof Error ? e.message : 'Failed to load communities.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load('initial');
  }, [load]);

  const setBusy = useCallback((id: string, busy: boolean) => {
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const applyJoin = useCallback(
    async (community: ExploreCommunity, message?: string) => {
      if (busyIds.has(community.id)) return;
      setBusy(community.id, true);
      try {
        const outcome = await joinCommunity(community.id, message);
        // The row leaves the browse tabs either way (joined rows are hidden;
        // the request shows under Requests sent).
        setCommunities((current) =>
          current.map((row) =>
            row.id === community.id
              ? {
                  ...row,
                  joined: outcome.kind === 'joined' ? true : row.joined,
                  has_pending_request:
                    outcome.kind === 'requested' ? true : row.has_pending_request,
                }
              : row,
          ),
        );
        setNotice(
          outcome.kind === 'joined'
            ? `Joined ${community.name} — it's in your Communities tab.`
            : `Request sent to ${community.name}.`,
        );
      } catch (e) {
        const err = e as Error & { status?: number; data?: { error?: string } };
        const copy =
          err.data?.error ??
          (err.status === 429
            ? "You've reached the limit of 7 communities. Leave one before joining another."
            : 'The join could not be completed.');
        Alert.alert(
          err.status === 403 ? 'Profile mismatch' : 'Could not join',
          copy,
        );
      } finally {
        setBusy(community.id, false);
      }
    },
    [busyIds, setBusy],
  );

  const withdraw = useCallback(
    async (community: ExploreCommunity) => {
      if (busyIds.has(community.id)) return;
      Alert.alert('Withdraw request?', `Your request to join ${community.name} will be withdrawn.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Withdraw',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(community.id, true);
              try {
                await withdrawJoinRequest(community.id);
                setCommunities((current) =>
                  current.map((row) =>
                    row.id === community.id ? { ...row, has_pending_request: false } : row,
                  ),
                );
                setNotice(`Request to ${community.name} withdrawn.`);
              } catch {
                Alert.alert('Could not withdraw', 'Please try again.');
              } finally {
                setBusy(community.id, false);
              }
            })();
          },
        },
      ]);
    },
    [busyIds, setBusy],
  );

  const onPressAction = useCallback(
    (community: ExploreCommunity) => {
      setNotice(null);
      if (community.has_pending_request) {
        if (tab === 'requests') void withdraw(community);
        return; // browse tabs: "Request sent" is not actionable
      }
      if (!community.can_join) return; // locked rows only carry their hint
      if (community.is_private) {
        setRequestTarget(community);
      } else {
        Alert.alert(`Join ${community.name}?`, 'The community appears in your Communities tab right after joining.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Join', onPress: () => void applyJoin(community) },
        ]);
      }
    },
    [applyJoin, tab, withdraw],
  );

  const visible = useMemo(
    () => visibleExploreRows(communities, tab, query),
    [communities, tab, query],
  );
  const { recommended, rest } = useMemo(() => splitExploreRows(visible), [visible]);

  /**
   * One flat list with heading rows interleaved, so the second section's
   * heading can sit between the two groups (FlatList cannot do that from a
   * header/footer pair).
   */
  type ListRow =
    | { kind: 'heading'; key: string; title: string }
    | { kind: 'community'; key: string; community: ExploreCommunity };

  const listData = useMemo<ListRow[]>(() => {
    const rows: ListRow[] = [];
    if (recommended.length > 0) {
      rows.push({ kind: 'heading', key: 'heading-recommended', title: 'Recommended for you' });
      for (const community of recommended) {
        rows.push({ kind: 'community', key: community.id, community });
      }
    }
    if (rest.length > 0) {
      rows.push({
        kind: 'heading',
        key: 'heading-rest',
        title: recommended.length > 0 ? 'More communities' : 'All communities',
      });
      for (const community of rest) {
        rows.push({ kind: 'community', key: community.id, community });
      }
    }
    return rows;
  }, [recommended, rest]);

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
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>
            Couldn&apos;t load Explore
          </Text>
          <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>{error}</Text>
          <Pressable onPress={() => void load('initial')} accessibilityRole="button">
            <Text style={[styles.retry, { color: colors.accent }]}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(row) => row.key}
          renderItem={({ item }) =>
            item.kind === 'heading' ? (
              <Text style={[styles.sectionHeading, { color: colors.foregroundMuted }]}>
                {item.title}
              </Text>
            ) : (
              <CommunityBrowseCard
                community={item.community}
                tab={tab}
                busy={busyIds.has(item.community.id)}
                onPress={() => onPressAction(item.community)}
              />
            )
          }
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 96 }]}
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load('refresh')}
              tintColor={colors.foregroundMuted}
            />
          }
          ListHeaderComponent={
            <View style={styles.headerBlock}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tabsRow}
              >
                {EXPLORE_TABS.map(({ label, value }) => {
                  const active = tab === value;
                  return (
                    <Pressable
                      key={value}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: active }}
                      onPress={() => {
                        setTab(value);
                        setNotice(null);
                      }}
                      style={[
                        styles.tabChip,
                        {
                          backgroundColor: active ? colors.accentSoft : 'transparent',
                          borderColor: active ? colors.borderStrong : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.tabLabel,
                          { color: active ? colors.foreground : colors.mutedForeground },
                        ]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <View
                style={[
                  styles.searchBox,
                  { backgroundColor: colors.input, borderColor: colors.inputBorder },
                ]}
              >
                <Feather name="search" size={15} color={colors.mutedForeground} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search communities"
                  placeholderTextColor={colors.foregroundSubtle}
                  style={[styles.searchInput, { color: colors.foreground }]}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {query.length > 0 && (
                  <Pressable accessibilityLabel="Clear search" hitSlop={8} onPress={() => setQuery('')}>
                    <Feather name="x" size={15} color={colors.mutedForeground} />
                  </Pressable>
                )}
              </View>

              {notice && (
                <View
                  style={[
                    styles.notice,
                    { borderColor: colors.border, backgroundColor: colors.surfaceRaised },
                  ]}
                >
                  <Feather name="check-circle" size={14} color={colors.accent} />
                  <Text style={[styles.noticeText, { color: colors.foreground }]}>{notice}</Text>
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Feather name="compass" size={30} color={colors.foregroundSubtle} />
              <Text style={[styles.stateTitle, { color: colors.foregroundMuted }]}>
                {tab === 'requests' ? 'No pending requests' : 'No communities found'}
              </Text>
              <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>
                {tab === 'requests'
                  ? 'Communities you ask to join privately show up here until the owner decides.'
                  : 'Try a different search term or tab.'}
              </Text>
            </View>
          }
        />
      )}

      <PrivateRequestModal
        community={requestTarget}
        onClose={() => setRequestTarget(null)}
        onSubmit={(message) => {
          const target = requestTarget;
          setRequestTarget(null);
          if (target) void applyJoin(target, message);
        }}
      />
    </View>
  );
}

function CommunityBrowseCard({
  community,
  tab,
  busy,
  onPress,
}: {
  community: ExploreCommunity;
  tab: ExploreTabValue;
  busy: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = community.image_url && !imageFailed ? community.image_url : null;

  const pending = community.has_pending_request;
  const locked = !community.can_join && !pending;

  const actionLabel = pending
    ? tab === 'requests'
      ? 'Withdraw'
      : 'Request sent'
    : community.is_private
      ? 'Request to join'
      : 'Join';

  const actionDisabled = busy || (pending && tab !== 'requests') || locked;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
        pressed && { backgroundColor: colors.surfaceRaised },
      ]}
    >
      {imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          style={[styles.cardImage, { borderColor: colors.border }]}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <View
          style={[
            styles.cardImage,
            styles.cardImageFallback,
            { borderColor: colors.border, backgroundColor: colors.surfaceRaised },
          ]}
        >
          <Text style={[styles.cardImageInitial, { color: colors.mutedForeground }]}>
            {community.name.trim()[0]?.toUpperCase() ?? '?'}
          </Text>
        </View>
      )}

      <View style={styles.cardBody}>
        <View style={styles.cardTitleRow}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]} numberOfLines={1}>
            {community.name}
          </Text>
          {community.is_private && (
            <Feather name="lock" size={12} color={colors.mutedForeground} />
          )}
        </View>
        {community.description ? (
          <Text style={[styles.cardDescription, { color: colors.mutedForeground }]} numberOfLines={2}>
            {community.description}
          </Text>
        ) : null}
        <Text style={[styles.cardMeta, { color: colors.foregroundSubtle }]}>
          {memberCountLabel(community.member_count)}
          {locked ? ' · Update your profile to join' : ''}
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: actionDisabled }}
        disabled={actionDisabled}
        onPress={onPress}
        style={[
          styles.cardAction,
          pending && tab === 'requests'
            ? { borderColor: colors.borderStrong }
            : { borderColor: colors.borderStrong, backgroundColor: colors.accentSoft },
          actionDisabled && { opacity: 0.45 },
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <Text
            style={[
              styles.cardActionText,
              {
                color:
                  pending && tab === 'requests' ? colors.destructive : colors.accent,
              },
            ]}
          >
            {actionLabel}
          </Text>
        )}
      </Pressable>
    </Pressable>
  );
}

function PrivateRequestModal({
  community,
  onClose,
  onSubmit,
}: {
  community: ExploreCommunity | null;
  onClose: () => void;
  onSubmit: (message: string) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (community) setMessage('');
  }, [community]);

  return (
    <Modal visible={Boolean(community)} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View
          style={[
            styles.modalCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              paddingBottom: insets.bottom + 16,
            },
          ]}
        >
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>
            Request to join {community?.name ?? ''}
          </Text>
          <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
            This community is private — the owner reviews every request. Add a short note
            (optional) so they know who is asking.
          </Text>
          <TextInput
            value={message}
            onChangeText={(text) => setMessage(text.slice(0, 500))}
            placeholder="Say hi, or why you'd like to join"
            placeholderTextColor={colors.foregroundSubtle}
            multiline
            style={[
              styles.modalInput,
              {
                color: colors.foreground,
                backgroundColor: colors.input,
                borderColor: colors.inputBorder,
              },
            ]}
          />
          <View style={styles.modalActions}>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={[styles.modalButton, { borderColor: colors.border }]}
            >
              <Text style={[styles.modalButtonText, { color: colors.foreground }]}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => onSubmit(message)}
              style={[styles.modalButton, { borderColor: colors.accent, backgroundColor: colors.accent }]}
            >
              <Text style={[styles.modalButtonText, { color: colors.accentForeground }]}>
                Send request
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: {
    flex: 1,
    minHeight: 280,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 32,
  },
  stateTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 16, textAlign: 'center' },
  stateBody: { fontFamily: 'Geist_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retry: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  list: { padding: 12, gap: 10, flexGrow: 1 },
  headerBlock: { gap: 10, marginBottom: 2 },
  tabsRow: { gap: 8, paddingRight: 8 },
  tabChip: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  tabLabel: { fontFamily: 'Geist_500Medium', fontSize: 12.5 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    height: 40,
  },
  searchInput: { flex: 1, fontFamily: 'Geist_400Regular', fontSize: 14, padding: 0 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noticeText: { flex: 1, fontFamily: 'Geist_400Regular', fontSize: 12.5 },
  sectionHeading: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 6,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  cardImage: {
    width: 48,
    height: 48,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardImageFallback: { alignItems: 'center', justifyContent: 'center' },
  cardImageInitial: { fontFamily: 'Geist_600SemiBold', fontSize: 17, textTransform: 'uppercase' },
  cardBody: { flex: 1, minWidth: 0, gap: 2 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { flexShrink: 1, fontFamily: 'Geist_600SemiBold', fontSize: 14.5 },
  cardDescription: { fontFamily: 'Geist_400Regular', fontSize: 12.5, lineHeight: 17 },
  cardMeta: { fontFamily: 'Geist_400Regular', fontSize: 11.5, marginTop: 1 },
  cardAction: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 13,
    paddingVertical: 7,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardActionText: { fontFamily: 'Geist_600SemiBold', fontSize: 12.5 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    gap: 10,
  },
  modalTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 16.5 },
  modalBody: { fontFamily: 'Geist_400Regular', fontSize: 13, lineHeight: 19 },
  modalInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 12,
    minHeight: 88,
    fontFamily: 'Geist_400Regular',
    fontSize: 14,
    textAlignVertical: 'top',
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  modalButton: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonText: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
});
