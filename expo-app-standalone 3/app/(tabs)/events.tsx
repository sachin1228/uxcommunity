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
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/AppHeader';
import { ContentDetail, ContentCard, useContentActions } from '@/components/community/contentView';
import { CommunityContentEditor } from '@/components/community/CommunityContentEditor';
import { EventFiltersSheet } from '@/components/events/EventFiltersSheet';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import {
  getCityEventPage,
  firstPageCursor,
  type CityEventDateFilter,
  type CityEventFilters,
  type CityEventItem,
  type CityEventPhase,
  type CityEventTypeFilter,
} from '@/lib/cityEvents';
import { CommunityContent, CommunityEvent, deleteCommunityContent } from '@/lib/communityContent';
import { chatContentKindForTab } from '@/lib/chatContentEvents';
import { notifyContentEvent } from '@/lib/contentEventMirror';
import { feedItemKey, feedItemKind, type FeedItem } from '@/lib/homeFeed';
import { getOwnProfile } from '@/lib/profile';

/**
 * Events — the workspace page's city feed, ported: the public events of the
 * member's own city, upcoming and past, split by the same clock.
 *
 * Reads the very endpoint the web page pages through (/api/events/city), shows
 * the same cards (a past event dims, RSVP/like/save/comments all work through
 * the community that owns it) and the same empty states, including the one
 * that asks for a city when the profile has none.
 *
 * The web page's Upcoming/Past chips and its Type/Date dropdown are folded
 * into one filter sheet beside the heading: the list is always one stream
 * narrowed by status, type and start-date window.
 */

/** How often the Upcoming/Past split re-reads the clock — the web tick. */
const SPLIT_TICK_MS = 30_000;

/** The city listing answers with event rows; the shared card wants the home feed's `_type` shape. */
function toFeedItems(events: CityEventItem[]): FeedItem[] {
  return events.map((event) => ({ ...event, _type: 'event' }));
}

/** Ids are unique per table — the feed key keeps both phases apart. */
function mergeUnique(items: FeedItem[]): FeedItem[] {
  const byKey = new Map<string, FeedItem>();
  for (const item of items) byKey.set(feedItemKey(item), item);
  return [...byKey.values()];
}

/** An event is over once its window closes — its end, else its start. */
function endsAt(item: FeedItem): number {
  const event = item as CommunityEvent;
  return new Date(event.end_date ?? event.event_date).getTime();
}

export default function EventsTab() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const actions = useContentActions();

  const [cityName, setCityName] = useState<string | null>(null);
  const [items, setItems] = useState<FeedItem[]>([]);
  // One cursor per phase; null once that phase runs out. "past" from a spent
  // upcoming page is folded into null by the client.
  const [cursors, setCursors] = useState<Record<CityEventPhase, string | null>>({
    upcoming: null,
    past: null,
  });
  const [phase, setPhase] = useState<CityEventPhase>('upcoming');
  const [typeFilter, setTypeFilter] = useState<CityEventTypeFilter>('all');
  const [dateFilter, setDateFilter] = useState<CityEventDateFilter>('any');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FeedItem | null>(null);
  /** The event row whose editor is open (host-only; null when closed). */
  const [editing, setEditing] = useState<FeedItem | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const resetActions = actions.reset;
  const filters = useMemo<CityEventFilters>(
    () => ({ type: typeFilter, date: dateFilter }),
    [dateFilter, typeFilter],
  );

  /** Last load wins — a filter picked mid-flight owns the list when it lands. */
  const loadRequest = useRef(0);

  /**
   * Both phases in one round trip, exactly like the web page's first paint —
   * the member's city comes off their own profile, so a profile without one
   * asks for it instead of guessing. Type/date ride along with both phase
   * requests, and every request replaces both cursors: paging never mixes
   * filter sets.
   */
  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      const request = ++loadRequest.current;
      if (mode === 'initial') setLoading(true);
      else setRefreshing(true);
      setError(null);

      try {
        const profile = await getOwnProfile();
        if (request !== loadRequest.current) return;
        const city = profile.profile?.cities?.name ?? null;
        setCityName(city);

        if (!city) {
          setItems([]);
          setCursors({ upcoming: null, past: null });
          return;
        }

        const [upcomingPage, pastPage] = await Promise.all([
          getCityEventPage(firstPageCursor('upcoming'), filters),
          getCityEventPage(firstPageCursor('past'), filters),
        ]);
        if (request !== loadRequest.current) return;

        setItems(mergeUnique([...toFeedItems(upcomingPage.events), ...toFeedItems(pastPage.events)]));
        setCursors({ upcoming: upcomingPage.nextCursor, past: pastPage.nextCursor });
        setNow(Date.now());
        resetActions();
      } catch (e) {
        if (request !== loadRequest.current) return;
        setError(e instanceof Error ? e.message : 'Failed to load events.');
      } finally {
        if (request === loadRequest.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [filters, resetActions],
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  // The boundary is a moment: an event finishing while the tab is open has to
  // cross it on its own (the web page ticks the same clock).
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), SPLIT_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const loadMore = useCallback(async () => {
    const cursor = cursors[phase];
    if (!cursor || loadingMore || loading) return;
    const request = loadRequest.current;
    setLoadingMore(true);
    try {
      const page = await getCityEventPage(cursor, filters);
      // A filter change while this page was in flight owns the list now.
      if (request !== loadRequest.current) return;
      setItems((current) => mergeUnique([...current, ...toFeedItems(page.events)]));
      setCursors((current) => ({ ...current, [phase]: page.nextCursor }));
    } catch {
      // Leave the list as-is; pulling down retries the whole stream.
    } finally {
      setLoadingMore(false);
    }
  }, [cursors, filters, loading, loadingMore, phase]);

  const { upcoming, past } = useMemo(() => {
    const split = { upcoming: [] as FeedItem[], past: [] as FeedItem[] };
    for (const item of items) {
      if (endsAt(item) >= now) split.upcoming.push(item);
      else split.past.push(item);
    }
    split.upcoming.sort((a, b) => endsAt(a) - endsAt(b));
    split.past.sort((a, b) => endsAt(b) - endsAt(a));
    return split;
  }, [items, now]);

  const activeList = phase === 'upcoming' ? upcoming : past;
  const counts: Record<CityEventPhase, number> = { upcoming: upcoming.length, past: past.length };
  const filtersActive =
    phase !== 'upcoming' || filters.type !== 'all' || filters.date !== 'any';

  const resetFilters = useCallback(() => {
    setPhase('upcoming');
    setTypeFilter('all');
    setDateFilter('any');
  }, []);

  // The comment count is the only route into an event's own page, where the
  // comments live under the event itself.
  const openItem = useCallback(
    (item: CommunityContent) => {
      setSelected(items.find((entry) => entry.id === item.id) ?? null);
    },
    [items],
  );

  // The city listing's rows are feed rows: keep their `_type` and community
  // attribution when an edit response replaces the event's own fields.
  const replaceItem = useCallback((saved: CommunityContent) => {
    setItems((current) =>
      current.map((entry) =>
        entry.id === saved.id
          ? {
              ...entry,
              ...saved,
              _type: entry._type,
              community_name: entry.community_name,
              community_image: entry.community_image,
            }
          : entry,
      ),
    );
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
  }, []);

  const editItem = useCallback(
    (entry: CommunityContent) => {
      const row = items.find((item) => item.id === entry.id);
      if (row) setEditing(row);
    },
    [items],
  );

  const deleteItem = useCallback(
    async (entry: CommunityContent) => {
      const row = items.find((item) => item.id === entry.id);
      if (!row?.community_id) return;
      const kind = feedItemKind(row);
      await deleteCommunityContent(row.community_id, kind, row.id);
      setItems((current) =>
        current.filter((item) => !(item.id === row.id && item._type === row._type)),
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
    [items],
  );

  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) => (
      // A past event dims under its tab, exactly like the web list.
      <View style={endsAt(item) < now ? styles.pastCard : undefined}>
        <ContentCard
          item={item}
          kind={feedItemKind(item)}
          currentUserId={user?.id ?? ''}
          actions={actions}
          communityName={item.community_name}
          communityImage={item.community_image}
          onComments={openItem}
          onEdit={editItem}
          onDelete={deleteItem}
        />
      </View>
    ),
    [actions, deleteItem, editItem, now, openItem, user?.id],
  );

  const emptyState =
    items.length === 0
      ? filtersActive
        ? {
            title: 'No events match these filters',
            body: 'Try a different status, date window or type.',
          }
        : {
            title: `No public events in ${cityName} yet`,
            body: 'Events shared publicly for your city will show up here.',
          }
      : phase === 'upcoming'
        ? {
            title: 'No upcoming events',
            body: filtersActive
              ? 'Nothing matches these filters here — try Past or widen them.'
              : 'Nothing is scheduled right now — Past has what already happened.',
          }
        : {
            title: 'No past events',
            body: filtersActive
              ? 'Nothing matches these filters here — try Upcoming or widen them.'
              : 'Nothing in your city has wrapped up yet.',
          };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      <AppHeader />

      {/* The web page header, with every filter behind the button at the
          heading's right edge — status, type and start-date window in one. */}
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <Text style={[styles.pageTitle, { color: colors.foreground }]}>Events</Text>
          <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>
            {cityName
              ? `Public events happening in ${cityName}.`
              : 'Public events happening in your city.'}
          </Text>
        </View>

        {cityName ? (
          <Pressable
            onPress={() => setFiltersOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Filter events"
            accessibilityState={{ expanded: filtersOpen }}
            style={({ pressed }) => [
              styles.filterButton,
              {
                borderColor: filtersActive ? colors.accent : colors.border,
                backgroundColor: filtersActive ? colors.accentSoft : colors.surfaceRaised,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Feather
              name="sliders"
              size={16}
              color={filtersActive ? colors.accent : colors.foregroundMuted}
            />
            {filtersActive ? (
              <View style={[styles.filterDot, { backgroundColor: colors.accent }]} />
            ) : null}
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error && items.length === 0 ? (
        <View style={styles.center}>
          <Feather name="wifi-off" size={28} color={colors.foregroundMuted} />
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>Couldn&apos;t load events</Text>
          <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>{error}</Text>
          <Pressable onPress={() => void load('initial')} accessibilityRole="button">
            <Text style={[styles.retry, { color: colors.accent }]}>Try again</Text>
          </Pressable>
        </View>
      ) : !cityName ? (
        <View style={styles.center}>
          <Feather name="map-pin" size={30} color={colors.foregroundSubtle} />
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>No city on your profile yet</Text>
          <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>
            Add your city and this page will show you the public events happening there.
          </Text>
          <Pressable
            onPress={() => router.push('/settings/profile')}
            accessibilityRole="button"
            style={[styles.cta, { backgroundColor: colors.accent }]}
          >
            <Text style={[styles.ctaText, { color: colors.accentForeground }]}>Add your city</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={activeList}
          keyExtractor={feedItemKey}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 96 }]}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load('refresh')}
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
              <Feather name="calendar" size={30} color={colors.foregroundSubtle} />
              <Text style={[styles.stateTitle, { color: colors.foregroundMuted }]}>{emptyState.title}</Text>
              <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>{emptyState.body}</Text>
            </View>
          }
        />
      )}

      <ContentDetail
        item={selected}
        kind={selected ? feedItemKind(selected) : 'events'}
        currentUserId={user?.id ?? ''}
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
        kind="events"
        item={editing}
        onClose={() => setEditing(null)}
        onSaved={replaceItem}
      />

      <EventFiltersSheet
        visible={filtersOpen}
        phase={phase}
        type={typeFilter}
        date={dateFilter}
        counts={counts}
        active={filtersActive}
        onChangePhase={setPhase}
        onChangeType={setTypeFilter}
        onChangeDate={setDateFilter}
        onReset={resetFilters}
        onClose={() => setFiltersOpen(false)}
      />
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
  filterButton: {
    width: 34,
    height: 34,
    marginTop: 2,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterDot: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  list: { padding: 12, gap: 12, flexGrow: 1 },
  pastCard: { opacity: 0.6 },
  center: {
    flex: 1,
    minHeight: 300,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 32,
  },
  stateTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 16, textAlign: 'center' },
  stateBody: { fontFamily: 'Geist_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retry: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  cta: { marginTop: 6, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 11 },
  ctaText: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  footer: { paddingVertical: 20, alignItems: 'center' },
});
