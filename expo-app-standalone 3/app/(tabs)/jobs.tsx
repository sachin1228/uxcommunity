/**
 * Jobs board — the mobile rendering of the web /dashboard/jobs.
 *
 * One newest-first feed of postings (50/page, cursor paging) with the same
 * four tabs filtering the loaded pages: Hiring and Referral show only roles
 * the viewer's profile matches (`can_apply`, the same predicate the server
 * enforces), own posts live under My posts, and applied-to roles move to
 * Applied. Search filters the two browse tabs client-side, exactly like the
 * web board's search box.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
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
import { JobCard } from '@/components/jobs/JobCard';
import { useColors } from '@/hooks/useColors';
import { getJobFeed } from '@/lib/jobsApi';
import {
  JOBS_TABS,
  searchJobs,
  splitJobsByTab,
  type JobPost,
  type JobsTab,
} from '@/lib/jobs';

const REFRESH_ON_FOCUS_MS = 30_000;

export default function JobsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [jobs, setJobs] = useState<JobPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<JobsTab>('hiring');
  const [query, setQuery] = useState('');

  /** Cursor is the very last row of the whole feed, not of the filtered tab. */
  const cursorRef = useRef<{ createdAt: string; id: string } | null>(null);
  const loadingMoreRef = useRef(false);
  const lastFetchedAtRef = useRef(0);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    if (mode !== 'silent') setError(null);
    try {
      const page = await getJobFeed();
      setJobs(page.jobs);
      setHasMore(page.hasMore);
      const last = page.jobs[page.jobs.length - 1];
      cursorRef.current = last ? { createdAt: last.created_at, id: last.id } : null;
      lastFetchedAtRef.current = Date.now();
      if (mode !== 'silent') setError(null);
    } catch (e) {
      if (mode === 'silent') return; // keep the board as-is
      setError(e instanceof Error ? e.message : 'Failed to load jobs.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load('initial');
  }, [load]);

  // The web board re-renders on every RSC navigation, so returning from a
  // detail refreshed it. Mobile screens stay mounted, so re-read the first
  // page on focus — but never more often than the freshness window.
  useFocusEffect(
    useCallback(() => {
      if (Date.now() - lastFetchedAtRef.current > REFRESH_ON_FOCUS_MS) {
        void load('silent');
      }
    }, [load]),
  );

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || !cursorRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await getJobFeed(cursorRef.current);
      setJobs((current) => {
        const seen = new Set(current.map((job) => job.id));
        return [...current, ...page.jobs.filter((job) => !seen.has(job.id))];
      });
      setHasMore(page.hasMore);
      const last = page.jobs[page.jobs.length - 1];
      if (last) cursorRef.current = { createdAt: last.created_at, id: last.id };
    } catch {
      // Keep the board; the list retries on the next scroll or pull.
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMore]);

  const tabs = useMemo(() => splitJobsByTab(jobs), [jobs]);

  const preMatch: JobPost[] =
    tab === 'hiring'
      ? tabs.hiring
      : tab === 'referral'
        ? tabs.referral
        : tab === 'applied'
          ? tabs.applied
          : tabs.myPosts;

  const isBrowseTab = tab === 'hiring' || tab === 'referral';
  const visible = isBrowseTab ? searchJobs(preMatch, query) : preMatch;

  const openJob = useCallback(
    (job: JobPost) => {
      router.push({ pathname: '/jobs/[id]', params: { id: job.id } });
    },
    [router],
  );

  const counts: Record<JobsTab, number> = {
    hiring: tabs.hiring.length,
    referral: tabs.referral.length,
    applied: tabs.applied.length,
    'my-posts': tabs.myPosts.length,
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      <AppHeader />

      <View style={[styles.tabsRow, { borderBottomColor: colors.border }]}>
        {JOBS_TABS.map(({ key, label }) => {
          const active = tab === key;
          const count = counts[key];
          return (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => {
                setTab(key);
                setQuery('');
                Keyboard.dismiss();
              }}
              style={[styles.tabButton, active && { borderBottomColor: colors.foreground }]}
            >
              <Text
                style={[
                  styles.tabLabel,
                  { color: active ? colors.foreground : colors.mutedForeground },
                ]}
              >
                {label}
              </Text>
              {count > 0 && (
                <Text style={[styles.tabCount, { color: colors.foregroundSubtle }]}>{count}</Text>
              )}
            </Pressable>
          );
        })}
      </View>

      {isBrowseTab && preMatch.length > 0 && (
        <View style={styles.searchRow}>
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
              placeholder="Search roles, companies, skills"
              placeholderTextColor={colors.foregroundSubtle}
              style={[styles.searchInput, { color: colors.foreground }]}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {query.length > 0 && (
              <Pressable accessibilityLabel="Clear search" hitSlop={8} onPress={() => setQuery('')}>
                <Feather name="x" size={15} color={colors.mutedForeground} />
              </Pressable>
            )}
          </View>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
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
          data={visible}
          keyExtractor={(job) => job.id}
          renderItem={({ item }) => <JobCard job={item} onPress={() => openJob(item)} />}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 96 }]}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.4}
          keyboardDismissMode="on-drag"
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
          ListEmptyComponent={<JobsEmpty tab={tab} query={query} hasAnyJobs={jobs.length > 0} />}
        />
      )}
    </View>
  );
}

/** Empty copy carried over from the web board — one voice on both clients. */
function JobsEmpty({
  tab,
  query,
  hasAnyJobs,
}: {
  tab: JobsTab;
  query: string;
  hasAnyJobs: boolean;
}) {
  const colors = useColors();

  let title: string;
  let body: string;

  if (query && (tab === 'hiring' || tab === 'referral')) {
    title = 'No jobs match';
    body = 'Try a different search term.';
  } else if (!hasAnyJobs && (tab === 'hiring' || tab === 'referral')) {
    title = 'No jobs yet';
    body = "Be the first to post a role — you'll verify your company with a work email.";
  } else if (tab === 'hiring' || tab === 'referral') {
    title = tab === 'hiring' ? 'No hiring roles match your profile yet' : 'No referral roles match your profile yet';
    body =
      'A role lands here when your profile matches it — job title and experience level always, and city and sector unless the poster set them to All. Keep your profile current, and check back as new roles arrive.';
  } else if (tab === 'applied') {
    title = 'No applications yet';
    body =
      'Roles you apply to move here with their submission details, so you can follow them up in one place.';
  } else {
    title = "You haven't posted a job yet";
    body = 'Post a role to start receiving applications from members whose profile matches.';
  }

  return (
    <View style={styles.center}>
      <Feather name="briefcase" size={30} color={colors.foregroundSubtle} />
      <Text style={[styles.stateTitle, { color: colors.foregroundMuted }]}>{title}</Text>
      <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  tabButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 11,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabLabel: { fontFamily: 'Geist_500Medium', fontSize: 13 },
  tabCount: { fontFamily: 'Geist_400Regular', fontSize: 11.5 },
  searchRow: { paddingHorizontal: 12, paddingTop: 10 },
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
  list: { padding: 12, gap: 10, flexGrow: 1 },
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
  footer: { paddingVertical: 20, alignItems: 'center' },
});
