import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/AppHeader';
import { CommunityRow } from '@/components/communities/CommunityRow';
import { PhotoViewerModal } from '@/components/PhotoViewerModal';
import {
  NotificationPermissionBanner,
  NotificationPermissionSheet,
} from '@/components/communities/NotificationPermissionPrompt';
import { CommunityMuteSheet } from '@/components/community/CommunityMuteSheet';
import { useColors } from '@/hooks/useColors';
import { useCommunities } from '@/hooks/useCommunities';
import { useNotificationPermission } from '@/hooks/useNotificationPermission';
import {
  Community,
  type CommunityMuteDuration,
  setCommunityMute,
} from '@/lib/communities';
import { communityStore } from '@/lib/communityStore';
import {
  communityRowActivityAt,
  recordCommunityReadFloor,
} from '@/lib/communityReadFloor';
import { planSelectionMute } from '@/lib/communityMute';
import { hapticImpact, hapticSelection } from '@/lib/haptics';
import { useAuth } from '@/context/AuthContext';
import { prefetchCommunityMessages } from '@/lib/communityMessageStoreRuntime';
import {
  COMMUNITY_REALTIME_LIMIT,
  HIBERNATED_LIST_REFRESH_MS,
} from '@/lib/realtimeWindow';

/**
 * How long the list must have been away before regaining focus earns an
 * immediate catch-up. Short hops — a glance at another tab, a chat pushed and
 * popped — are not real absences and must not cost a request each: the same
 * rule the web's useHiddenCatchUp applies to hidden tabs.
 */
const FOCUS_CATCH_UP_MIN_AWAY_MS = 5_000;

/** The list's one-at-a-time notice (mute confirmations and their Undo). */
interface ListToast {
  message: string;
  actionLabel?: string;
  onAction?: () => Promise<void> | void;
}

/**
 * WhatsApp's selection toolbar. Holding a chat row replaces the workspace
 * header with the selected count and the actions that apply to it; the only
 * action here is the mute toggle, which reuses the chat header's ⋯ menu
 * durations.
 *
 * The bell follows the selection's mute state: when every selected chat is
 * already muted it becomes unmute and clears them in one tap; otherwise it
 * mutes the chats that are still unmuted, leaving already-muted ones with
 * their own duration.
 */
function ChatSelectionHeader({
  count,
  allMuted,
  busy,
  onClose,
  onToggleMute,
}: {
  count: number;
  allMuted: boolean;
  busy: boolean;
  onClose: () => void;
  onToggleMute: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
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
      <View style={styles.headerLeft}>
        <Pressable
          onPress={onClose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Exit selection"
          style={({ pressed }) => [styles.headerIconBtn, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.selectionCount, { color: colors.foreground }]}
        >
          {count}
        </Text>
      </View>
      <Pressable
        onPress={onToggleMute}
        disabled={busy}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={allMuted ? 'Unmute notifications' : 'Mute notifications'}
        style={({ pressed }) => [
          styles.headerIconBtn,
          { opacity: busy ? 0.5 : pressed ? 0.7 : 1 },
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.foreground} />
        ) : (
          <Feather
            name={allMuted ? 'bell' : 'bell-off'}
            size={20}
            strokeWidth={2.25}
            color={colors.foreground}
          />
        )}
      </Pressable>
    </View>
  );
}

export default function CommunitiesScreen() {
  const { user } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    communities,
    isLoading,
    error,
    nowMs,
    reload,
    markCommunityRead,
    getTypingLabel,
    catchUpList,
  } = useCommunities();
  const [query, setQuery] = useState('');
  /** The row whose face is open full screen — set only for rows with a picture. */
  const [photoCommunity, setPhotoCommunity] = useState<Community | null>(null);
  const notificationPermission = useNotificationPermission();
  const [notificationPromptOpen, setNotificationPromptOpen] = useState(false);
  const [notificationNoticeDismissed, setNotificationNoticeDismissed] = useState(false);
  const notificationPromptShownRef = useRef(false);

  /** Rows claimed by selection; empty while the list is not selecting. */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  /** The selection toolbar's mute row opens the duration sheet. */
  const [muteSheetOpen, setMuteSheetOpen] = useState(false);
  const [muteBusy, setMuteBusy] = useState(false);
  /** The list's own toast — "Chat muted" with Undo, "Chat unmuted". */
  const [toast, setToast] = useState<ListToast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissToast = useCallback(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = null;
    setToast(null);
  }, []);
  const showToast = useCallback((next: ListToast) => {
    setToast(next);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      toastTimer.current = null;
      setToast(null);
    }, 4000);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const selectionActive = selectedIds.size > 0;
  const selectedCommunities = useMemo(
    () => communities.filter((c) => selectedIds.has(c.id)),
    [communities, selectedIds],
  );
  // The toolbar's bell mirrors WhatsApp: it unmutes once the whole selection
  // is already muted, and otherwise mutes whatever the selection has left
  // unmuted. Already-muted chats keep their own duration.
  const muteSelection = useMemo(
    () => planSelectionMute(selectedCommunities, nowMs),
    [selectedCommunities, nowMs],
  );

  const exitSelection = useCallback(() => {
    setSelectedIds(new Set());
    setMuteSheetOpen(false);
  }, []);

  const handleSelect = useCallback((community: Community) => {
    hapticSelection();
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(community.id)) next.delete(community.id);
      else next.add(community.id);
      return next;
    });
  }, []);

  const handleLongPress = useCallback((community: Community) => {
    hapticImpact();
    setMuteSheetOpen(false);
    setSelectedIds((current) => {
      if (current.has(community.id)) return current;
      return new Set(current).add(community.id);
    });
  }, []);

  // Rows removed elsewhere (Exit community on another device, an archive)
  // take their selection with them.
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const alive = new Set(communities.map((c) => c.id));
    const next = new Set([...selectedIds].filter((id) => alive.has(id)));
    if (next.size === selectedIds.size) return;
    setSelectedIds(next);
    if (next.size === 0) setMuteSheetOpen(false);
  }, [communities, selectedIds]);

  // Android's back button leaves selection before it leaves the tab.
  useEffect(() => {
    if (!selectionActive) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      exitSelection();
      return true;
    });
    return () => sub.remove();
  }, [selectionActive, exitSelection]);

  // Leaving the tab drops the selection, like WhatsApp's chat list.
  useFocusEffect(
    useCallback(
      () => () => {
        setSelectedIds(new Set());
        setMuteSheetOpen(false);
      },
      [],
    ),
  );

  /**
   * Save the caller's mute for every selected chat and confirm with one
   * toast — "Chat muted"/"3 chats muted" with Undo, and the same in the
   * plural for unmute. Failures leave just the failed rows selected so a
   * retry is one tap away; successful rows still patch through the shared
   * store the moment each save lands.
   */
  const applyMute = useCallback(
    async (
      communityIds: string[],
      duration: CommunityMuteDuration,
      { reportFailure = true }: { reportFailure?: boolean } = {},
    ): Promise<boolean> => {
      if (muteBusy || communityIds.length === 0) return false;
      setMuteBusy(true);
      try {
        const results = await Promise.allSettled(
          communityIds.map((communityId) => setCommunityMute(communityId, duration)),
        );
        const succeeded: string[] = [];
        const failed: string[] = [];
        results.forEach((result, index) => {
          const communityId = communityIds[index];
          if (result.status === 'fulfilled') {
            communityStore.notifyCommunityChanged({
              kind: 'patch',
              communityId,
              patch: result.value,
            });
            succeeded.push(communityId);
          } else {
            failed.push(communityId);
          }
        });

        if (failed.length > 0) {
          setMuteSheetOpen(false);
          if (reportFailure) {
            setSelectedIds(new Set(failed));
            showToast({ message: "Couldn't update notifications. Try again." });
          }
          return false;
        }

        const count = succeeded.length;
        if (duration === 'off') {
          showToast({ message: count === 1 ? 'Chat unmuted' : `${count} chats unmuted` });
        } else {
          showToast({
            message: count === 1 ? 'Chat muted' : `${count} chats muted`,
            actionLabel: 'Undo',
            onAction: async () => {
              if (!(await applyMute(succeeded, 'off', { reportFailure: false }))) {
                throw new Error('undo failed');
              }
            },
          });
        }
        setMuteSheetOpen(false);
        setSelectedIds(new Set());
        return true;
      } catch {
        if (reportFailure) {
          showToast({ message: "Couldn't update notifications. Try again." });
        }
        return false;
      } finally {
        setMuteBusy(false);
      }
    },
    // The undo closure references applyMute itself, exactly like the chat
    // screen's handler.
    [muteBusy, showToast],
  );

  const handleSelectionMute = useCallback(() => {
    if (muteBusy || selectedCommunities.length === 0) return;
    if (muteSelection.unmute) {
      // Every selected chat is muted — the toolbar's bell means unmute, and
      // the sheet would only repeat that one action.
      void applyMute(
        selectedCommunities.map((community) => community.id),
        'off',
      );
      return;
    }
    setMuteSheetOpen(true);
  }, [muteBusy, selectedCommunities, muteSelection.unmute, applyMute]);

  const handleToastAction = useCallback(() => {
    const action = toast?.onAction;
    if (!action) return;
    dismissToast();
    Promise.resolve(action()).catch(() => {
      showToast({ message: "Couldn't undo that" });
    });
  }, [toast, dismissToast, showToast]);

  // Opening the app with notifications off should explain why, not wait for
  // the banner link. Once per session; after that the banner carries it. If the
  // member grants permission while the sheet is open (the OS prompt or system
  // settings), it has nothing left to explain.
  useEffect(() => {
    if (notificationPermission === 'granted') {
      setNotificationPromptOpen(false);
      return;
    }
    if (notificationPermission !== 'denied' || notificationPromptShownRef.current) return;
    notificationPromptShownRef.current = true;
    setNotificationPromptOpen(true);
  }, [notificationPermission]);

  /**
   * Hibernated rows: communities past the live socket window
   * (`lib/realtimeWindow.ts`) hold no socket, so the list is the only surface
   * that moves their preview, unread count and position — and a list that is
   * merely being looked at produces none of the triggers that would otherwise
   * reconcile it (foreground, reconnect, pull-to-refresh). While this screen
   * is focused and at least one such row exists, catch up on a real return and
   * then on a slow beat: the mobile counterpart of the web sidebar's poll
   * while it is over its window.
   *
   * The beat stops when the tab blurs, and a tick that finds the app
   * backgrounded is dropped, because a foreground return has its own catch-up
   * (useCommunities). The first focus of a session is the mount load already
   * in flight; a return shorter than FOCUS_CATCH_UP_MIN_AWAY_MS skips the
   * immediate catch-up because the rows are only seconds old.
   */
  const blurredAtRef = useRef<number | null>(null);
  const overRealtimeLimit = communities.length > COMMUNITY_REALTIME_LIMIT;
  useFocusEffect(
    useCallback(() => {
      const blurredAt = blurredAtRef.current;
      if (
        overRealtimeLimit &&
        blurredAt !== null &&
        Date.now() - blurredAt >= FOCUS_CATCH_UP_MIN_AWAY_MS
      ) {
        catchUpList();
      }

      const timer = overRealtimeLimit
        ? setInterval(() => {
            if (AppState.currentState === 'active') catchUpList();
          }, HIBERNATED_LIST_REFRESH_MS)
        : null;

      return () => {
        blurredAtRef.current = Date.now();
        if (timer !== null) clearInterval(timer);
      };
    }, [overRealtimeLimit, catchUpList]),
  );

  /**
   * The joined list filtered by name — the same rule the web browse page
   * searches by (case-insensitive substring of the name), applied locally:
   * the list is already in hand, and a round trip would only add latency.
   */
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return communities;
    return communities.filter((c) => c.name.toLowerCase().includes(term));
  }, [communities, query]);

  const handleCommunityPress = useCallback(
    (community: Community) => {
      prefetchCommunityMessages(user?.id, community.id);
      // The open covers every message and card this row already shows; a list
      // payload produced before the read PATCH lands must not bring the badge
      // back (see lib/communityReadFloor).
      recordCommunityReadFloor(
        user?.id,
        community.id,
        communityRowActivityAt(community),
      );
      markCommunityRead(community.id);
      const imageParam = community.image_url
        ? `&image=${encodeURIComponent(community.image_url)}`
        : '';
      const tabsParam = `&tabs=${encodeURIComponent(community.enabled_tabs.join(','))}`;
      // Showcase keeps its own flag (defaults to on) — see lib/communities/areas.ts on the web.
      const showcaseParam = `&showcase=${community.showcase_enabled === false ? '0' : '1'}`;
      // Ownership only gates the "delete anyone's message" affordance in chat;
      // the server still authorizes every delete.
      const ownerParam = community.owner_id
        ? `&owner=${encodeURIComponent(community.owner_id)}`
        : '';
      // Snapshot the unread state *before* markCommunityRead zeroes the badge so
      // the chat can draw its "N unread messages" divider in the right place.
      const unreadParam = `&unread=${community.unread_count ?? 0}`;
      const readParam = community.last_read_at
        ? `&read=${encodeURIComponent(community.last_read_at)}`
        : '';
      // The count rides along so the chat header's second line paints from the
      // first frame, before its own community lookup returns.
      const membersParam = `&members=${community.member_count ?? ''}`;
      // Same idea for the name's verified/lock badges — otherwise they pop in
      // only after the chat's own fetch.
      const typeParam = `&type=${encodeURIComponent(community.type)}`;
      const privateParam = `&private=${community.is_private ? '1' : '0'}`;
      router.push(
        `/community/${community.id}?name=${encodeURIComponent(community.name)}${imageParam}${tabsParam}${showcaseParam}${ownerParam}${unreadParam}${readParam}${membersParam}${typeParam}${privateParam}`
      );
    },
    [router, markCommunityRead, user?.id]
  );

  const renderItem = useCallback(
    ({ item }: { item: Community }) => (
      <CommunityRow
        community={item}
        typingLabel={getTypingLabel(item.id)}
        nowMs={nowMs}
        onPress={() => handleCommunityPress(item)}
        onPressIn={() => prefetchCommunityMessages(user?.id, item.id)}
        onPressAvatar={() => setPhotoCommunity(item)}
        selectionMode={selectionActive}
        selected={selectedIds.has(item.id)}
        onLongPress={() => handleLongPress(item)}
        onSelect={() => handleSelect(item)}
      />
    ),
    [
      getTypingLabel,
      handleCommunityPress,
      handleLongPress,
      handleSelect,
      nowMs,
      selectedIds,
      selectionActive,
      user?.id,
    ],
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      {selectionActive ? (
        <ChatSelectionHeader
          count={selectedCommunities.length}
          allMuted={muteSelection.unmute}
          busy={muteBusy}
          onClose={exitSelection}
          onToggleMute={handleSelectionMute}
        />
      ) : (
        <AppHeader />
      )}

      {/* Search filters the joined list locally. Creating lives in the
          floating + at the bottom-right, above the tab bar. */}
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

      {notificationPermission === 'denied' && !notificationNoticeDismissed && (
        <NotificationPermissionBanner
          onDismiss={() => setNotificationNoticeDismissed(true)}
        />
      )}

      {isLoading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      {!isLoading && error && communities.length === 0 && (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
          <Pressable onPress={reload} style={[styles.retryButton, { borderColor: colors.border }]}>
            <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
          </Pressable>
        </View>
      )}

      {!isLoading && !error && communities.length === 0 && (
        <View style={styles.center}>
          <Feather name="users" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No communities yet</Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            You haven&apos;t joined any communities. Create one with the + button.
          </Text>
        </View>
      )}

      {!isLoading && communities.length > 0 && (
        <FlatList
          data={visible}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 120 }]}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.noResults}>
              <Feather name="search" size={26} color={colors.foregroundSubtle} />
              <Text style={[styles.emptyTitle, { color: colors.foregroundMuted }]}>
                No communities found
              </Text>
              <Text style={[styles.emptyText, { color: colors.foregroundSubtle }]}>
                Try a different name.
              </Text>
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={reload}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        />
      )}

      {/* Fixed floating create — same round control the search row used to
          hold, now hovering above the tab bar while the list scrolls. */}
      <Pressable
        onPress={() => router.push('/create-community')}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Create community"
        style={({ pressed }) => [
          styles.fab,
          {
            backgroundColor: pressed ? colors.accentHover : colors.accent,
            borderColor: colors.accent,
            bottom: insets.bottom + 96,
            shadowColor: '#000000',
          },
        ]}
      >
        <Feather name="plus" size={22} color={colors.accentForeground} />
      </Pressable>

      {toast && (
        <View
          style={[styles.toast, { backgroundColor: colors.foreground, top: insets.top + 112 }]}
        >
          <Text style={[styles.toastText, { color: colors.background }]}>{toast.message}</Text>
          {toast.actionLabel && (
            <Pressable
              onPress={handleToastAction}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={toast.actionLabel}
            >
              <Text style={[styles.toastAction, { color: colors.background }]}>
                {toast.actionLabel}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      <NotificationPermissionSheet
        visible={notificationPromptOpen}
        onClose={() => setNotificationPromptOpen(false)}
      />

      {/* Mute durations for the selected rows — the chat header's ⋯ menu
          sheet, opened from the selection toolbar. */}
      <CommunityMuteSheet
        open={muteSheetOpen}
        muted={false}
        muteStateLabel={null}
        busy={muteBusy}
        onChoose={(duration) => {
          // Only the still-unmuted chats take the chosen duration; ones
          // already muted keep their own mute (see planSelectionMute).
          if (muteSelection.toMute.length > 0) {
            void applyMute(
              muteSelection.toMute.map((community) => community.id),
              duration,
            );
          }
        }}
        onClose={() => {
          if (!muteBusy) setMuteSheetOpen(false);
        }}
      />

      <PhotoViewerModal
        visible={photoCommunity !== null}
        uri={photoCommunity?.image_url ?? null}
        title="Community photo"
        onClose={() => setPhotoCommunity(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  // The selection toolbar mirrors AppHeader's height so the swap reads as one
  // header changing, not the page jumping.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  headerIconBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionCount: {
    fontSize: 18,
    fontFamily: 'Geist_600SemiBold',
  },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
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
  fab: {
    position: 'absolute',
    right: 18,
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  // Same toast as the chat screen's mute confirmation, parked under the
  // search row so it never covers the field it just left.
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  toastText: { fontSize: 12, fontFamily: 'Geist_500Medium' },
  toastAction: {
    fontSize: 12,
    fontFamily: 'Geist_700Bold',
    textDecorationLine: 'underline',
    marginLeft: 2,
  },
  noResults: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 48,
    paddingHorizontal: 32,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  errorText: {
    fontSize: 14,
    fontFamily: 'Geist_400Regular',
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  retryText: { fontSize: 14, fontFamily: 'Geist_500Medium' },
  emptyTitle: {
    fontSize: 17,
    fontFamily: 'Geist_600SemiBold',
    marginTop: 8,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Geist_400Regular',
    textAlign: 'center',
  },
  list: { flexGrow: 1 },
});
