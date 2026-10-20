import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { PersonAvatar } from '@/components/PersonAvatar';
import { getCommunityActivity, type CommunityActivityEntry } from '@/lib/communities';
import {
  actorLabel,
  describeActivity,
  entryActorId,
  fmtActivityTime,
} from '@/lib/communityActivity';

/**
 * The manager tier's management audit trail — the mobile port of the web
 * ActivityView: who did what, most recent first, with actor filter chips and
 * keyset pagination. Owners and platform-appointed admins see it; moderators
 * do not.
 */

interface Props {
  communityId: string;
  currentUserId: string;
  /** The hero + tab strip, rendered above the feed. */
  header: React.ReactNode;
}

const roleTone = (
  role: CommunityActivityEntry['actor_role'],
  colors: ReturnType<typeof useColors>
): { color: string; background: string } => {
  switch (role) {
    case 'owner':
      return { color: colors.accent, background: colors.accentSoft };
    case 'admin':
      return { color: '#F59E0B', background: 'rgba(245,158,11,0.14)' };
    case 'moderator':
      return { color: '#38BDF8', background: 'rgba(56,189,248,0.14)' };
    default:
      return { color: colors.mutedForeground, background: colors.surfaceRaised };
  }
};
export function ActivityPanel({ communityId, currentUserId, header }: Props) {
  const colors = useColors();
  const router = useRouter();

  const [entries, setEntries] = useState<CommunityActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actorFilter, setActorFilter] = useState('all');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getCommunityActivity(communityId)
      .then((result) => {
        if (cancelled) return;
        setEntries(result.activity);
        setHasMore(result.hasMore);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load activity.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [communityId, reloadKey]);

  const loadOlder = useCallback(async () => {
    if (loadingMore || loading || !hasMore || entries.length === 0) return;
    setLoadingMore(true);
    try {
      const oldest = entries[entries.length - 1];
      const result = await getCommunityActivity(communityId, oldest.created_at);
      setEntries((prev) => {
        const seen = new Set(prev.map((entry) => entry.id));
        return [...prev, ...result.activity.filter((entry) => !seen.has(entry.id))];
      });
      setHasMore(result.hasMore);
    } catch {
      /* keep the list; the next scroll retries */
    } finally {
      setLoadingMore(false);
    }
  }, [communityId, entries, hasMore, loading, loadingMore]);

  const actors = useMemo(() => {
    const seen = new Map<string, string>();
    for (const entry of entries) {
      const id = entryActorId(entry);
      if (!seen.has(id)) {
        seen.set(id, entry.actor_id === currentUserId ? 'You' : actorLabel(entry));
      }
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [entries, currentUserId]);

  const visible = useMemo(
    () =>
      actorFilter === 'all'
        ? entries
        : entries.filter((entry) => entryActorId(entry) === actorFilter),
    [entries, actorFilter]
  );

  const openProfile = useCallback(
    (userId: string) => {
      if (userId === currentUserId) {
        router.push('/profile');
        return;
      }
      router.push({ pathname: '/member/[id]', params: { id: userId } });
    },
    [currentUserId, router]
  );

  const listHeader = (
    <View>
      {header}
      <View style={styles.intro}>
        <Text style={[styles.introTitle, { color: colors.mutedForeground }]}>
          MANAGEMENT ACTIVITY
        </Text>
        <Text style={[styles.introCopy, { color: colors.mutedForeground }]}>
          Every action taken in this community — who did what, most recent first.
        </Text>
      </View>

      {!loading && !error && actors.length > 1 ? (
        <View style={styles.filters}>
          {[{ id: 'all', name: 'All' }, ...actors].map((actor) => {
            const active = actorFilter === actor.id;
            return (
              <Pressable
                key={actor.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setActorFilter(actor.id)}
                style={[
                  styles.chip,
                  {
                    borderColor: active ? colors.accent : colors.border,
                    backgroundColor: active ? colors.accentSoft : 'transparent',
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.chipText,
                    { color: active ? colors.foreground : colors.mutedForeground },
                  ]}
                >
                  {actor.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : null}

      {error && !loading ? (
        <View style={styles.emptyWrap}>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{error}</Text>
          <Pressable
            onPress={() => setReloadKey((key) => key + 1)}
            style={[styles.retryButton, { borderColor: colors.border }]}
          >
            <Text style={[styles.retryText, { color: colors.foreground }]}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      {!loading && !error && visible.length === 0 && !hasMore ? (
        <View style={styles.emptyWrap}>
          <Feather name="shield" size={20} strokeWidth={2} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            {actorFilter === 'all'
              ? 'No management activity yet. Actions taken by admins and moderators will appear here.'
              : 'No activity from this manager yet.'}
          </Text>
        </View>
      ) : null}

      {!loading && !error && visible.length === 0 && hasMore ? (
        <Text style={[styles.filteredEmpty, { color: colors.mutedForeground }]}>
          No activity from this manager in the loaded feed yet.
        </Text>
      ) : null}
    </View>
  );

  const renderEntry = ({
    item: entry,
    index,
  }: {
    item: CommunityActivityEntry;
    index: number;
  }) => {
    const tone = roleTone(entry.actor_role, colors);
    const isSelf = Boolean(entry.actor_id && entry.actor_id === currentUserId);
    const isPlatform = entry.actor_role === 'platform';
    const isLast = index === visible.length - 1;
    const excerpt =
      typeof entry.details?.message_excerpt === 'string' ? entry.details.message_excerpt : null;

    const avatar = isPlatform ? (
      <View
        style={[
          styles.avatarRing,
          { borderColor: tone.color, backgroundColor: tone.background },
        ]}
      >
        <Text style={[styles.platformMark, { color: tone.color }]}>UX</Text>
      </View>
    ) : (
      <Pressable
        onPress={() => (entry.actor_id ? openProfile(entry.actor_id) : undefined)}
        disabled={!entry.actor_id}
        style={[
          styles.avatarRing,
          { borderColor: tone.color, backgroundColor: tone.background },
        ]}
      >
        <PersonAvatar
          name={entry.actor_name ?? '?'}
          url={entry.actor_avatar_url ?? null}
          size={26}
        />
      </Pressable>
    );

    return (
      <View style={styles.entry}>
        {!isLast ? (
          <View style={[styles.timeline, { backgroundColor: colors.border }]} />
        ) : null}
        {avatar}
        <View style={styles.entryBody}>
          <Text style={[styles.entryText, { color: colors.foreground }]}>
            <Text style={styles.entryActor}>
              {isSelf ? 'You' : actorLabel(entry)}
            </Text>{' '}
            {describeActivity(entry)}
          </Text>
          {excerpt ? (
            <View
              style={[
                styles.excerpt,
                { borderColor: colors.border, backgroundColor: colors.surface },
              ]}
            >
              <Text style={[styles.excerptText, { color: colors.mutedForeground }]}>
                “{excerpt}”
              </Text>
            </View>
          ) : null}
          <Text style={[styles.entryMeta, { color: colors.mutedForeground }]}>
            {fmtActivityTime(entry.created_at)}
            <Text style={[styles.entryRole, { color: tone.color }]}>
              {'  '}
              {entry.actor_role.toUpperCase()}
            </Text>
          </Text>
        </View>
      </View>
    );
  };

  return (
    <FlatList
      data={loading || error ? [] : visible}
      keyExtractor={(entry) => entry.id}
      renderItem={renderEntry}
      ListHeaderComponent={listHeader}
      ListFooterComponent={
        loadingMore ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="small" color={colors.accent} />
          </View>
        ) : null
      }
      contentContainerStyle={styles.listContent}
      onEndReached={() => void loadOlder()}
      onEndReachedThreshold={0.4}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: 28 },
  intro: { paddingHorizontal: 16, paddingTop: 14 },
  introTitle: { fontSize: 9.5, fontFamily: 'Geist_600SemiBold', letterSpacing: 1.2 },
  introCopy: {
    fontSize: 13,
    fontFamily: 'Geist_400Regular',
    lineHeight: 19,
    marginTop: 5,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: 140,
  },
  chipText: { fontSize: 11.5, fontFamily: 'Geist_500Medium' },

  entry: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    position: 'relative',
  },
  timeline: {
    position: 'absolute',
    left: 31,
    top: 42,
    bottom: -10,
    width: StyleSheet.hairlineWidth,
  },
  avatarRing: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
    marginTop: 2,
  },
  platformMark: { fontSize: 8, fontFamily: 'Geist_700Bold' },
  entryBody: { flex: 1, minWidth: 0 },
  entryText: { fontSize: 13.5, fontFamily: 'Geist_400Regular', lineHeight: 20 },
  entryActor: { fontFamily: 'Geist_600SemiBold' },
  excerpt: {
    marginTop: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  excerptText: { fontSize: 12.5, fontFamily: 'Geist_400Regular', lineHeight: 18 },
  entryMeta: { fontSize: 11, fontFamily: 'Geist_400Regular', marginTop: 4 },
  entryRole: { fontSize: 8.5, fontFamily: 'Geist_600SemiBold', letterSpacing: 0.8 },

  loadingWrap: { paddingVertical: 34, alignItems: 'center' },
  emptyWrap: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 32, gap: 10 },
  emptyText: {
    fontSize: 13.5,
    fontFamily: 'Geist_400Regular',
    lineHeight: 19,
    textAlign: 'center',
  },
  filteredEmpty: {
    textAlign: 'center',
    fontSize: 13,
    fontFamily: 'Geist_400Regular',
    paddingHorizontal: 32,
    paddingTop: 28,
  },
  retryButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  retryText: { fontSize: 12.5, fontFamily: 'Geist_500Medium' },
});
