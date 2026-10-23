import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
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
import {
  NotificationPermissionBanner,
  NotificationPermissionSheet,
} from '@/components/communities/NotificationPermissionPrompt';
import { useColors } from '@/hooks/useColors';
import { useCommunities } from '@/hooks/useCommunities';
import { useNotificationPermission } from '@/hooks/useNotificationPermission';
import { Community } from '@/lib/communities';
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

export default function CommunitiesScreen() {
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
  const notificationPermission = useNotificationPermission();
  const [notificationPromptOpen, setNotificationPromptOpen] = useState(false);
  const [notificationNoticeDismissed, setNotificationNoticeDismissed] = useState(false);
  const notificationPromptShownRef = useRef(false);

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
    [router, markCommunityRead]
  );

  const renderItem = useCallback(
    ({ item }: { item: Community }) => (
      <CommunityRow
        community={item}
        typingLabel={getTypingLabel(item.id)}
        nowMs={nowMs}
        onPress={() => handleCommunityPress(item)}
      />
    ),
    [getTypingLabel, handleCommunityPress, nowMs]
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      <AppHeader />

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

      <NotificationPermissionSheet
        visible={notificationPromptOpen}
        onClose={() => setNotificationPromptOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
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
