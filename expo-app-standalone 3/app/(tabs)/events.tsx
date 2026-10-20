import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/AppHeader';
import { ContentDetail, ContentCard, useContentActions } from '@/components/community/contentView';
import { CommunityContentEditor } from '@/components/community/CommunityContentEditor';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { getCityEventPage, firstPageCursor, type CityEventItem, type CityEventPhase } from '@/lib/cityEvents';
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
 * The type and date filters the web header carries are not here yet: the app's
 * event surfaces have never had them.
 */

/** How often the Upcoming/Past split re-reads the clock — the web tick. */
const SPLIT_TICK_MS = 30_000;

const PHASES: Array<{ key: CityEventPhase; label: string; icon: React.ComponentProps<typeof Feather>['name'] }> = [
  { key: 'upcoming', label: 'Upcoming', icon: 'clock' },
  { key: 'past', label: 'Past', icon: 'check-circle' },
];

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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FeedItem | null>(null);
  /** The event row whose editor is open (host-only; null when closed). */
  const [editing, setEditing] = useState<FeedItem | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const resetActions = actions.reset;

  /**
   * Both phases in one round trip, exactly like the web page's first paint —
   * the member's city comes off their own profile, so a profile without one
   * asks for it instead of guessing.
   */
  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'initial') setLoading(true);
      else setRefreshing(true);
      setError(null);

      try {
        const profile = await getOwnProfile();
        const city = profile.profile?.cities?.name ?? null;
        setCityName(city);

        if (!city) {
          setItems([]);
          setCursors({ upcoming: null, past: null });
          return;
        }

        const [upcomingPage, pastPage] = await Promise.all([
          getCityEventPage(firstPageCursor('upcoming')),
          getCityEventPage(firstPageCursor('past')),
        ]);

        setItems(mergeUnique([...toFeedItems(upcomingPage.events), ...toFeedItems(pastPage.events)]));
        setCursors({ upcoming: upcomingPage.nextCursor, past: pastPage.nextCursor });
        setNow(Date.now());
        resetActions();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load events.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [resetActions],
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
    setLoadingMore(true);
    try {
      const page = await getCityEventPage(cursor);
      setItems((current) => mergeUnique([...current, ...toFeedItems(page.events)]));
      setCursors((current) => ({ ...current, [phase]: page.nextCursor }));
    } catch {
      // Leave the list as-is; pulling down retries the whole stream.
    } finally {
      setLoadingMore(false);
    }
  }, [cursors, loading, loadingMore, phase]);

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
      ? {
          title: `No public events in ${cityName} yet`,
          body: 'Events shared publicly for your city will show up here.',
        }
      : phase === 'upcoming'
        ? {
            title: 'No upcoming events',
            body: 'Nothing is scheduled right now — the Past tab has what already happened.',
          }
        : {
            title: 'No past events',
            body: 'Nothing in your city has wrapped up yet.',
          };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      <AppHeader />

      {/* The web page header, verbatim: the title and the city line. */}
      <View style={styles.pageHeader}>
        <Text style={[styles.pageTitle, { color: colors.foreground }]}>Events</Text>
        <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>
          {cityName
            ? `Public events happening in ${cityName}.`
            : 'Public events happening in your city.'}
        </Text>
      </View>

      {cityName && !loading && !error ? (
        <View style={[styles.tabsShell, { borderBottomColor: colors.border }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {PHASES.map((entry) => {
              const active = phase === entry.key;
              const labelColor = active ? colors.foreground : colors.mutedForeground;
              return (
                <Pressable
                  key={entry.key}
                  onPress={() => setPhase(entry.key)}
                  style={[styles.tab, { borderBottomColor: active ? colors.accent : 'transparent' }]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                >
                  <View style={styles.tabInner}>
                    <Feather name={entry.icon} size={14} color={labelColor} />
                    <Text style={[styles.tabText, { color: labelColor }]}>
                      {entry.label} ({counts[entry.key]})
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pageHeader: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4, gap: 4 },
  pageTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 20, letterSpacing: -0.3 },
  pageSubtitle: { fontFamily: 'Geist_400Regular', fontSize: 13, lineHeight: 19 },
  tabsShell: { marginTop: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  tabs: { minWidth: '100%', justifyContent: 'flex-start', paddingHorizontal: 16 },
  tab: {
    minWidth: 118,
    height: 46,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
  },
  tabInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabText: { fontSize: 12.5, fontFamily: 'Geist_500Medium' },
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
