import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
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
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/AppHeader';
import { JobCard } from '@/components/jobs/JobCard';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { hapticSelection } from '@/lib/haptics';
import {
  fetchJobFeed,
  jobErrorMessage,
  type JobKind,
  type JobPost,
} from '@/lib/jobs';
import {
  countNewSince,
  markJobTabSeen,
  newestInstant,
  readJobTabSeen,
} from '@/lib/jobTabSeen';
import { fetchScreenData, peekScreenData, readScreenData, writeScreenData } from '@/lib/screenDataCacheStore';
import { mergeUniquePage, SCREEN_CACHE_TTL_MS } from '@/lib/screenDataCache';

/** The two browse tabs; the other two carry a standing count instead. */
type BrowseKind = JobKind;
type Tab = BrowseKind | 'applied' | 'posts';

interface JobsSnapshot {
  jobs: JobPost[];
  hasMore: boolean;
}

const JOBS_CACHE_KEY = 'jobs:feed';

/**
 * The jobs board — the web `/dashboard/jobs` port.
 *
 * The browse tabs split other members' open roles by kind, and only keep the
 * postings this member could still apply to: their own posts live under My
 * posts, roles they applied to move to Applied, and roles their profile misses
 * on a gating criterion stay out entirely — `can_apply` is the same predicate
 * the write enforces, so no card here is ever "Locked for your profile".
 * Selecting a card opens the posting's own screen.
 *
 * The browse tabs wear "N new" instead of a total: matched roles posted since
 * the member last opened the tab, with the cut-off stored per account.
 */
export default function JobsTab() {
  const { user, sessionEpoch } = useAuth();
  const userId = user?.id ?? null;
  return (
    <JobsTabSession
      key={`${userId ?? 'signed-out'}:${sessionEpoch}`}
      userId={userId}
      sessionEpoch={sessionEpoch}
    />
  );
}

function JobsTabSession({
  userId,
  sessionEpoch,
}: {
  userId: string | null;
  sessionEpoch: number;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [jobs, setJobs] = useState<JobPost[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('hiring');
  const [search, setSearch] = useState('');
  const [newCounts, setNewCounts] = useState<Record<BrowseKind, number> | null>(null);
  const countedRef = useRef(false);
  const focusedOnceRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const jobsRef = useRef(jobs);
  const hasMoreRef = useRef(hasMore);
  const cacheReadyRef = useRef(false);
  jobsRef.current = jobs;
  hasMoreRef.current = hasMore;

  const commitJobs = useCallback((nextJobs: JobPost[], nextHasMore: boolean, persist = true) => {
    jobsRef.current = nextJobs;
    hasMoreRef.current = nextHasMore;
    setJobs(nextJobs);
    setHasMore(nextHasMore);
    if (persist && userId && cacheReadyRef.current) {
      void writeScreenData(
        userId,
        JOBS_CACHE_KEY,
        sessionEpoch,
        { jobs: nextJobs, hasMore: nextHasMore },
        SCREEN_CACHE_TTL_MS.jobs,
      );
    }
  }, [sessionEpoch, userId]);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent') => {
      if (!userId) {
        setLoading(false);
        setError('Sign in to load jobs.');
        return;
      }
      const sequence = ++requestSequenceRef.current;
      const isCurrent = () => requestSequenceRef.current === sequence;
      let cachePainted = false;
      let networkSucceeded = false;
      if (mode === 'initial') {
        setRefreshing(false);
        const memory = peekScreenData<JobsSnapshot>(
          userId,
          JOBS_CACHE_KEY,
          sessionEpoch,
          SCREEN_CACHE_TTL_MS.jobs,
        );
        if (memory) {
          cachePainted = true;
          cacheReadyRef.current = true;
          commitJobs(memory.data.jobs, memory.data.hasMore, false);
          setLoading(false);
          if (memory.isFresh) {
            setError(null);
            return;
          }
        } else {
          setLoading(true);
        }
        void readScreenData<JobsSnapshot>(
          userId,
          JOBS_CACHE_KEY,
          sessionEpoch,
          SCREEN_CACHE_TTL_MS.jobs,
        ).then((snapshot) => {
          if (!snapshot || cachePainted || networkSucceeded || !isCurrent()) return;
          cachePainted = true;
          cacheReadyRef.current = true;
          commitJobs(snapshot.data.jobs, snapshot.data.hasMore, false);
          setLoading(false);
        });
      }
      if (mode === 'refresh') setRefreshing(true);
      setError(null);
      try {
        const result = await fetchScreenData(
          userId,
          JOBS_CACHE_KEY,
          sessionEpoch,
          SCREEN_CACHE_TTL_MS.jobs,
          () => fetchJobFeed(),
        );
        if (!result.accepted || !isCurrent()) return;
        networkSucceeded = true;
        cacheReadyRef.current = true;
        commitJobs(result.data.jobs, result.data.has_more);
      } catch (cause) {
        if (!isCurrent()) return;
        setError(jobErrorMessage(cause, "Couldn't load jobs. Check your connection and try again."));
      } finally {
        if (isCurrent()) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [commitJobs, sessionEpoch, userId],
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  // Coming back from a posting can change its standing (applied, closed,
  // deleted), so the board re-reads on every return except the first focus.
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnceRef.current) {
        focusedOnceRef.current = true;
        return;
      }
      void load('silent');
    }, [load]),
  );

  const myPosts = useMemo(() => jobs.filter((job) => job.is_mine), [jobs]);
  const hiringPosts = useMemo(
    () => jobs.filter((job) => !job.is_mine && !job.applied && job.kind === 'hiring'),
    [jobs],
  );
  const referralPosts = useMemo(
    () => jobs.filter((job) => !job.is_mine && !job.applied && job.kind === 'referral'),
    [jobs],
  );
  const hiringJobs = useMemo(() => hiringPosts.filter((job) => job.can_apply), [hiringPosts]);
  const referralJobs = useMemo(() => referralPosts.filter((job) => job.can_apply), [referralPosts]);
  const appliedJobs = useMemo(
    () => jobs.filter((job) => !job.is_mine && job.applied),
    [jobs],
  );

  // The badges are counted once on arrival from the stored cut-off; the tab
  // the board opens on is being looked at right now, so it is marked seen.
  useEffect(() => {
    if (countedRef.current || loading || !userId) return;
    countedRef.current = true;

    void (async () => {
      const seen = await readJobTabSeen(userId);
      setNewCounts({
        hiring: countNewSince(hiringJobs, seen.hiring),
        referral: countNewSince(referralJobs, seen.referral),
      });
      await markJobTabSeen(userId, 'hiring', newestInstant(hiringJobs));
    })();
  }, [loading, userId, hiringJobs, referralJobs]);

  const browseList = tab === 'hiring' ? hiringJobs : tab === 'referral' ? referralJobs : null;
  const query = search.trim().toLowerCase();
  const visibleJobs =
    browseList !== null
      ? browseList.filter(
          (job) =>
            !query ||
            job.title.toLowerCase().includes(query) ||
            job.company.name.toLowerCase().includes(query) ||
            job.skills.some((skill) => skill.toLowerCase().includes(query)),
        )
      : tab === 'applied'
        ? appliedJobs
        : myPosts;

  const openTab = (next: Tab) => {
    hapticSelection();
    setTab(next);
    if ((next === 'hiring' || next === 'referral') && userId) {
      setNewCounts((counts) => (counts ? { ...counts, [next]: 0 } : counts));
      void markJobTabSeen(
        userId,
        next,
        newestInstant(next === 'hiring' ? hiringJobs : referralJobs),
      );
    }
  };

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreRef.current || jobsRef.current.length === 0 || !userId) return;
    const sequence = requestSequenceRef.current;
    const last = jobsRef.current[jobsRef.current.length - 1];
    setLoadingMore(true);
    loadingMoreRef.current = true;
    try {
      const page = await fetchJobFeed({ createdAt: last.created_at, id: last.id });
      if (requestSequenceRef.current !== sequence) return;
      commitJobs(mergeUniquePage(jobsRef.current, page.jobs, (job) => job.id), page.has_more);
    } catch {
      // Network error — leave the board as it is.
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [commitJobs, userId]);

  const newBadge = (count: number | undefined) =>
    count && count > 0 ? `${count} new` : null;
  const tabs: { value: Tab; label: string; chip: string | null; unseen: boolean }[] = [
    { value: 'hiring', label: '# Hiring', chip: newBadge(newCounts?.hiring), unseen: true },
    { value: 'referral', label: '# Referral', chip: newBadge(newCounts?.referral), unseen: true },
    { value: 'applied', label: 'Applied', chip: String(appliedJobs.length), unseen: false },
    { value: 'posts', label: 'My posts', chip: String(myPosts.length), unseen: false },
  ];

  const header = (
    <View>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <Text style={[styles.pageTitle, { color: colors.foreground }]}>Jobs</Text>
          <Text style={[styles.pageSubtitle, { color: colors.foregroundMuted }]}>
            Roles posted by verified company members — apply to the ones that match your profile.
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/jobs/new')}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.postButton,
            {
              backgroundColor: pressed ? colors.accentHover : colors.accent,
            },
          ]}
        >
          <Feather name="plus" size={13} color={colors.accentForeground} />
          <Text style={[styles.postButtonText, { color: colors.accentForeground }]}>
            Post a job
          </Text>
        </Pressable>
      </View>

      <View style={[styles.tabStrip, { borderBottomColor: colors.border }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabScroll}
          contentContainerStyle={styles.tabStripContent}
        >
          {tabs.map((item) => {
            const active = tab === item.value;
            return (
              <Pressable
                key={item.value}
                onPress={() => openTab(item.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[
                  styles.tab,
                  {
                    borderBottomColor: active ? colors.accent : 'transparent',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.tabLabel,
                    { color: active ? colors.foreground : colors.foregroundMuted },
                  ]}
                >
                  {item.label}
                </Text>
                {item.chip !== null ? (
                  <View
                    style={[
                      styles.tabChip,
                      {
                        backgroundColor:
                          item.unseen || active ? colors.accentSoft : colors.surfaceRaised,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.tabChipText,
                        { color: item.unseen || active ? colors.foreground : colors.foregroundMuted },
                      ]}
                    >
                      {item.chip}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {browseList !== null && browseList.length > 0 ? (
        <View
          style={[
            styles.searchField,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Feather name="search" size={14} color={colors.foregroundMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search roles or companies…"
            placeholderTextColor={colors.foregroundSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search roles"
            style={[styles.searchInput, { color: colors.foreground }]}
          />
          {search.length > 0 ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityLabel="Clear search">
              <Feather name="x" size={14} color={colors.foregroundMuted} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {error && jobs.length > 0 ? (
        <View style={[styles.notice, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
          <Text style={[styles.noticeText, { color: colors.destructive }]}>{error}</Text>
        </View>
      ) : null}
    </View>
  );

  const empty = !loading && visibleJobs.length === 0 ? (
    <EmptyJobs
      tab={tab}
      query={query}
      hasBrowseJobs={(tab === 'hiring' ? hiringPosts : referralPosts).length > 0}
      hasAnyJobs={jobs.length > 0}
      onPost={() => router.push('/jobs/new')}
    />
  ) : null;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      <AppHeader />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error && jobs.length === 0 ? (
        <View style={styles.center}>
          <Feather name="wifi-off" size={28} color={colors.foregroundMuted} />
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>
            Couldn&apos;t load jobs
          </Text>
          <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>{error}</Text>
          <Pressable onPress={() => void load('initial')} accessibilityRole="button">
            <Text style={[styles.retry, { color: colors.accent }]}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={visibleJobs}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
          keyboardShouldPersistTaps="handled"
          onEndReachedThreshold={0.4}
          onEndReached={() => void loadMore()}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load('refresh')}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
          renderItem={({ item }) => (
            <View style={styles.cardWrap}>
              <JobCard
                job={item}
                onPress={() => router.push(`/jobs/${item.id}`)}
                showOwnerActions={tab === 'posts'}
                onEdit={() => router.push(`/jobs/${item.id}/edit`)}
                onOwnerChanged={() => void load('silent')}
                onOwnerDeleted={() => void load('silent')}
              />
            </View>
          )}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footerLoading}>
                <ActivityIndicator size="small" color={colors.foregroundMuted} />
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

function EmptyJobs({
  tab,
  query,
  hasBrowseJobs,
  hasAnyJobs,
  onPost,
}: {
  tab: Tab;
  query: string;
  hasBrowseJobs: boolean;
  hasAnyJobs: boolean;
  onPost: () => void;
}) {
  const colors = useColors();

  let title = '';
  let body = '';
  let postAction = false;

  if ((tab === 'hiring' || tab === 'referral') && query && hasBrowseJobs) {
    title = 'No jobs match';
    body = 'Try a different search term.';
  } else if ((tab === 'hiring' || tab === 'referral') && !hasAnyJobs) {
    title = 'No jobs yet';
    body = "Be the first to post a role — you'll verify your company with a work email.";
    postAction = true;
  } else if (tab === 'hiring' || tab === 'referral') {
    title =
      tab === 'hiring'
        ? 'No hiring roles match your profile yet'
        : 'No referral roles match your profile yet';
    body = hasBrowseJobs
      ? 'A role lands here when your profile matches it — job title and experience level always, and city and sector unless the poster set them to All. Keep your profile current, and check back as new roles arrive.'
      : `Your own posts live under My posts, and roles you apply to move to Applied — ${
          tab === 'hiring' ? 'hiring' : 'referral'
        } posts from other members will show up here.`;
  } else if (tab === 'applied') {
    title = 'No applications yet';
    body =
      'Roles you apply to move here with their submission details, so you can follow them up in one place.';
  } else {
    title = "You haven't posted a job yet";
    body = 'Post a role to start receiving applications from members whose profile matches.';
    postAction = true;
  }

  return (
    <View style={[styles.empty, { borderColor: colors.border }]}>
      <Feather name="briefcase" size={26} color={colors.foregroundSubtle} />
      <Text style={[styles.stateTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>{body}</Text>
      {postAction ? (
        <Pressable
          onPress={onPost}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.emptyAction,
            {
              backgroundColor: pressed ? colors.accentHover : colors.accent,
            },
          ]}
        >
          <Feather name="plus" size={13} color={colors.accentForeground} />
          <Text style={[styles.emptyActionText, { color: colors.accentForeground }]}>Post a job</Text>
        </Pressable>
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
    paddingBottom: 8,
  },
  pageHeaderText: { flex: 1, gap: 3 },
  pageTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 20, letterSpacing: -0.3 },
  pageSubtitle: { fontFamily: 'Geist_400Regular', fontSize: 12.5, lineHeight: 18 },
  postButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 34,
    borderRadius: 999,
    paddingHorizontal: 13,
    marginTop: 2,
  },
  postButtonText: { fontFamily: 'Geist_600SemiBold', fontSize: 12.5 },

  tabStrip: {
    flexGrow: 0,
    marginTop: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabScroll: { flexGrow: 0 },
  tabStripContent: { paddingHorizontal: 12, gap: 2 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderBottomWidth: 2,
  },
  tabLabel: { fontFamily: 'Geist_500Medium', fontSize: 12.5 },
  tabChip: { borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1.5 },
  tabChipText: { fontFamily: 'Geist_500Medium', fontSize: 10 },

  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 40,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 4,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, fontFamily: 'Geist_400Regular', fontSize: 14, paddingVertical: 0 },

  cardWrap: { paddingHorizontal: 16, paddingTop: 10 },
  footerLoading: { paddingVertical: 18, alignItems: 'center' },
  notice: {
    marginHorizontal: 16,
    marginTop: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  noticeText: { fontFamily: 'Geist_400Regular', fontSize: 12.5, lineHeight: 18 },

  center: {
    flex: 1,
    minHeight: 300,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 32,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginHorizontal: 16,
    marginTop: 16,
    paddingVertical: 44,
    paddingHorizontal: 24,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  stateTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 15, textAlign: 'center' },
  stateBody: {
    fontFamily: 'Geist_400Regular',
    fontSize: 12.5,
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 320,
  },
  retry: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  emptyAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
    marginTop: 6,
  },
  emptyActionText: { fontFamily: 'Geist_600SemiBold', fontSize: 13 },
});
