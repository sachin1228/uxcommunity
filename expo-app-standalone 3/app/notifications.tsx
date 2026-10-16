import React, { useCallback, useMemo, useState } from 'react';
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
import { ScreenHeader } from '@/components/settings/ScreenHeader';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useNotifications } from '@/hooks/useNotifications';
import { hapticSelection } from '@/lib/haptics';
import {
  NOTIFICATION_TABS,
  notificationHrefToRoute,
  splitNotificationsByTab,
  type NotificationItem,
  type NotificationTab,
  type NotificationType,
} from '@/lib/notifications';

/**
 * Notifications — the mobile reading of the web page at
 * /dashboard/notifications.
 *
 * Same feed, same four tabs, same empty states: the page the bell opens.
 * Rows mark themselves read on the tap (optimistically, like the web), then
 * open what they are about — a community's item, or the Jobs tab for a role
 * match. The web page's realtime sync is not here; the bell and this list
 * refresh on mount, on pull, and whenever the store has been patched.
 *
 * The bell's number is "new since you last looked": mounting this screen
 * advances that watermark (the web's autoMarkSeen) without writing read_at,
 * so the unread dots and "Mark all read" keep their meaning.
 */

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/** Row icon per type — the web view's iconFor, in the same order. */
function iconFor(type: NotificationType): FeatherName {
  if (type === 'report_reviewed') return 'flag';
  if (type === 'content_restored') return 'rotate-ccw';
  if (type === 'job_match') return 'briefcase';
  if (type === 'join_request_accepted') return 'user-plus';
  if (type.endsWith('_deleted')) return 'trash-2';
  if (type === 'thread_like') return 'heart';
  if (type.includes('event')) return 'calendar';
  if (type.includes('resource')) return 'file-text';
  if (type.includes('comment') || type.includes('reply')) return 'message-circle';
  return 'users';
}

/** Tab key → its icon (the web's TAB_ICONS). Labels come from the shared module. */
const TAB_ICONS: Record<NotificationTab, FeatherName> = {
  activity: 'message-circle',
  events: 'calendar',
  jobs: 'briefcase',
  other: 'bell',
};

/** The per-tab empty states, verbatim from the web view. */
const TAB_EMPTY: Record<NotificationTab, { icon: FeatherName; title: string; hint: string }> = {
  activity: {
    icon: 'message-circle',
    title: 'No likes or comments yet',
    hint: 'Likes and comments on your threads and resources will appear here.',
  },
  events: {
    icon: 'calendar',
    title: 'No event activity yet',
    hint: 'RSVPs and comments on your events will appear here.',
  },
  jobs: {
    icon: 'briefcase',
    title: 'No job matches yet',
    hint: 'Roles posted that match your profile will appear here with a link to view them.',
  },
  other: {
    icon: 'trash-2',
    title: 'Nothing here yet',
    hint: 'Removals of your posts, updates on reports you filed, and accepted join requests will show up here.',
  },
};

/** "now" / "5m" / "3h" / "2d" — the web's formatRelativeTime. */
function formatRelativeTime(value: string): string {
  const diff = Date.now() - new Date(value).getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return 'now';
  if (diff < hour) return `${Math.floor(diff / minute)}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  return `${Math.floor(diff / day)}d`;
}

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { notifications, unreadCount, loading, error, refresh, markRead, markAllRead } =
    useNotifications(user?.id, { autoMarkSeen: true });

  const [tab, setTab] = useState<NotificationTab>('activity');
  const [refreshing, setRefreshing] = useState(false);

  const hasUnread = unreadCount > 0;

  // Unread counts are derived from the loaded page — the server total
  // (unreadCount) is not split by type.
  const { activity, events, jobs, other, unreadByTab } = useMemo(
    () => splitNotificationsByTab(notifications),
    [notifications],
  );

  const visible = tab === 'activity' ? activity : tab === 'events' ? events : tab === 'jobs' ? jobs : other;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  /** Marks the row read, then opens what it is about. */
  const open = useCallback(
    (item: NotificationItem) => {
      hapticSelection();
      if (!item.read_at) markRead(item.id);

      const route = notificationHrefToRoute(item.href);
      if (route.kind === 'community') {
        const query =
          route.contentKind && route.contentId
            ? `?contentKind=${route.contentKind}&contentId=${route.contentId}`
            : '';
        router.push(`/community/${route.communityId}${query}`);
      } else if (route.kind === 'jobs') {
        router.push('/jobs');
      }
    },
    [markRead, router],
  );

  const renderItem = useCallback(
    ({ item }: { item: NotificationItem }) => {
      const unread = !item.read_at;
      return (
        <Pressable
          onPress={() => open(item)}
          accessibilityRole="button"
          accessibilityLabel={unread ? `${item.title}, unread` : item.title}
          style={({ pressed }) => [
            styles.row,
            {
              backgroundColor: unread ? colors.backgroundSubtle : 'transparent',
              borderBottomColor: colors.border,
            },
            pressed && { backgroundColor: colors.surfaceRaised },
          ]}
        >
          <View
            style={[
              styles.rowIcon,
              { backgroundColor: unread ? colors.accentSoft : colors.backgroundSubtle },
            ]}
          >
            <Feather
              name={iconFor(item.type)}
              size={16}
              color={unread ? colors.accent : colors.foregroundMuted}
            />
          </View>

          <View style={styles.rowBody}>
            <View style={styles.rowTitleLine}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={[styles.rowTime, { color: colors.foregroundSubtle }]}>
                {formatRelativeTime(item.created_at)}
              </Text>
            </View>

            {item.body ? (
              <Text
                style={[styles.rowText, { color: colors.foregroundMuted }]}
                numberOfLines={2}
              >
                {item.body}
              </Text>
            ) : null}

            {item.type === 'job_match' ? (
              <View style={styles.viewJob}>
                <Text style={[styles.viewJobText, { color: colors.accent }]}>View job</Text>
                <Feather name="arrow-right" size={12} color={colors.accent} />
              </View>
            ) : null}
          </View>

          {unread ? (
            <View style={[styles.unreadDot, { backgroundColor: colors.destructive }]} />
          ) : null}
        </Pressable>
      );
    },
    [colors, open],
  );

  const emptyState = TAB_EMPTY[tab];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />

      <ScreenHeader
        title="Notifications"
        subtitle={hasUnread ? `${unreadCount} unread` : 'All caught up'}
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mark all read"
            disabled={!hasUnread}
            onPress={markAllRead}
            style={({ pressed }) => [styles.markAll, { opacity: !hasUnread ? 0.4 : pressed ? 0.7 : 1 }]}
          >
            <Feather name="check-circle" size={14} color={colors.mutedForeground} />
            <Text style={[styles.markAllText, { color: colors.mutedForeground }]}>
              Mark all read
            </Text>
          </Pressable>
        }
      />

      {/* Hidden while the very first page loads and when the account has no
          notifications at all — a tab bar over nothing is just noise. */}
      {!loading && notifications.length > 0 ? (
        <View style={[styles.tabsShell, { borderBottomColor: colors.border }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {NOTIFICATION_TABS.map(({ key, label }) => {
              const active = tab === key;
              const unread = unreadByTab[key];
              const labelColor = active ? colors.foreground : colors.mutedForeground;
              return (
                <Pressable
                  key={key}
                  onPress={() => setTab(key)}
                  style={[styles.tab, { borderBottomColor: active ? colors.accent : 'transparent' }]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                >
                  <View style={styles.tabInner}>
                    <Feather name={TAB_ICONS[key]} size={14} color={labelColor} />
                    <Text style={[styles.tabText, { color: labelColor }]}>{label}</Text>
                    {unread > 0 ? (
                      <View style={[styles.tabPill, { backgroundColor: colors.accentSoft }]}>
                        <Text style={[styles.tabPillText, { color: colors.accent }]}>
                          {unread > 9 ? '9+' : unread}
                        </Text>
                      </View>
                    ) : null}
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
      ) : error && notifications.length === 0 ? (
        <View style={styles.center}>
          <Feather name="wifi-off" size={28} color={colors.foregroundMuted} />
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>
            Couldn&apos;t load notifications
          </Text>
          <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>{error}</Text>
          <Pressable onPress={() => void refresh()} accessibilityRole="button">
            <Text style={[styles.retry, { color: colors.accent }]}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + 40 },
            visible.length === 0 && styles.listEmpty,
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={colors.foregroundMuted}
            />
          }
          ListEmptyComponent={
            notifications.length === 0 ? (
              <View style={styles.center}>
                <Feather name="bell" size={26} color={colors.foregroundSubtle} />
                <Text style={[styles.stateTitle, { color: colors.foregroundMuted }]}>
                  No notifications yet
                </Text>
                <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>
                  Likes, comments, event RSVPs and job matches will appear here.
                </Text>
              </View>
            ) : (
              <View style={styles.center}>
                <Feather name={emptyState.icon} size={26} color={colors.foregroundSubtle} />
                <Text style={[styles.stateTitle, { color: colors.foregroundMuted }]}>
                  {emptyState.title}
                </Text>
                <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>
                  {emptyState.hint}
                </Text>
              </View>
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  markAll: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4 },
  markAllText: { fontSize: 12, fontFamily: 'Geist_500Medium' },
  tabsShell: { borderBottomWidth: StyleSheet.hairlineWidth },
  tabs: { paddingHorizontal: 12 },
  tab: {
    height: 46,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
  },
  tabInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabText: { fontSize: 12.5, fontFamily: 'Geist_500Medium' },
  tabPill: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabPillText: { fontSize: 10, fontFamily: 'Geist_600SemiBold', lineHeight: 13 },
  list: { flexGrow: 1 },
  listEmpty: { justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowIcon: {
    marginTop: 1,
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowTitle: { flex: 1, fontSize: 14, lineHeight: 19, fontFamily: 'Geist_500Medium' },
  rowTime: { fontSize: 11, fontFamily: 'Geist_400Regular', marginTop: 1 },
  rowText: { marginTop: 2, fontSize: 12.5, lineHeight: 18, fontFamily: 'Geist_400Regular' },
  viewJob: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  viewJobText: { fontSize: 12.5, fontFamily: 'Geist_500Medium' },
  unreadDot: { width: 6, height: 6, borderRadius: 3, marginTop: 8 },
  center: {
    flex: 1,
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 32,
    paddingVertical: 48,
  },
  stateTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 15, textAlign: 'center' },
  stateBody: { fontFamily: 'Geist_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retry: { fontFamily: 'Geist_600SemiBold', fontSize: 14, marginTop: 4 },
});
