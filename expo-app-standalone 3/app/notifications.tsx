/**
 * Notifications — the member's inbox, opened from the header bell.
 *
 * Port of the web /dashboard/notifications page: the same four tabs, unread
 * bookkeeping and empty states (web lib/notifications-tabs.ts drives both).
 * Rows that carry a content link open the community surface the notification
 * is about; rows without a mobile destination stay tappable for "mark read"
 * only. Mounting this screen advances the seen watermark (clearing the bell
 * badge) without marking anything read — see useNotifications.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useNotifications } from '@/hooks/useNotifications';
import {
  NOTIFICATION_TABS,
  formatRelativeTime,
  notificationRouteFor,
  splitNotificationsByTab,
  type NotificationItem,
  type NotificationTab,
  type NotificationType,
} from '@/lib/notifications';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/** Same buckets as the web view's iconFor(). */
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

const TAB_ICONS: Record<NotificationTab, FeatherName> = {
  activity: 'message-circle',
  events: 'calendar',
  jobs: 'briefcase',
  other: 'bell',
};

/** Per-tab empty copies — identical to the web NotificationsView. */
const EMPTY_BY_TAB: Record<
  NotificationTab,
  { icon: FeatherName; title: string; hint: string }
> = {
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

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: FeatherName;
  title: string;
  hint: string;
}) {
  const colors = useColors();
  return (
    <View style={styles.empty}>
      <Feather name={icon} size={26} color={colors.foregroundMuted} style={styles.emptyIcon} />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.emptyHint, { color: colors.foregroundMuted }]}>{hint}</Text>
    </View>
  );
}

export default function NotificationsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, isLoading: authLoading } = useAuth();

  const { notifications, unreadCount, loading, refresh, markOneRead, markAllRead } =
    useNotifications({ autoMarkSeen: true });

  const [tab, setTab] = useState<NotificationTab>('activity');
  const [refreshing, setRefreshing] = useState(false);

  const { activity, events, jobs, other, unreadByTab } = useMemo(
    () => splitNotificationsByTab(notifications),
    [notifications],
  );

  const visible =
    tab === 'activity' ? activity : tab === 'events' ? events : tab === 'jobs' ? jobs : other;

  const hasUnread = unreadCount > 0;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh({ silent: true });
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const openItem = useCallback(
    (item: NotificationItem) => {
      if (!item.read_at) void markOneRead(item.id);
      const route = notificationRouteFor(item.href);
      if (route) router.push(route);
    },
    [markOneRead, router],
  );

  if (!authLoading && !user) return <Redirect href="/(auth)/login" />;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />

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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.foreground }]}>Notifications</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {hasUnread ? `${unreadCount} unread` : 'All caught up'}
          </Text>
        </View>

        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mark all read"
            accessibilityState={{ disabled: !hasUnread }}
            disabled={!hasUnread}
            hitSlop={8}
            onPress={() => void markAllRead()}
            style={({ pressed }) => [
              styles.iconButton,
              {
                backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
                opacity: hasUnread ? 1 : 0.4,
              },
            ]}
          >
            <Feather name="check-circle" size={20} color={colors.mutedForeground} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Notification settings"
            hitSlop={8}
            onPress={() => router.push('/settings/notifications')}
            style={({ pressed }) => [
              styles.iconButton,
              { backgroundColor: pressed ? colors.surfaceRaised : 'transparent' },
            ]}
          >
            <Ionicons name="settings-outline" size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>
      </View>

      {loading && notifications.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={colors.mutedForeground}
            />
          }
        >
          {/* A tab bar over nothing is just noise — same rule as the web. */}
          {notifications.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tabsRow}
            >
              {NOTIFICATION_TABS.map(({ key, label }) => {
                const active = tab === key;
                const unread = unreadByTab[key];
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    onPress={() => setTab(key)}
                    style={[
                      styles.tabChip,
                      {
                        backgroundColor: active ? colors.accentSoft : 'transparent',
                        borderColor: active ? colors.borderStrong : colors.border,
                      },
                    ]}
                  >
                    <Feather
                      name={TAB_ICONS[key]}
                      size={13}
                      color={active ? colors.foreground : colors.mutedForeground}
                    />
                    <Text
                      style={[
                        styles.tabLabel,
                        { color: active ? colors.foreground : colors.mutedForeground },
                      ]}
                    >
                      {label}
                    </Text>
                    {unread > 0 && (
                      <View style={[styles.tabBadge, { backgroundColor: colors.surfaceRaised }]}>
                        <Text style={[styles.tabBadgeText, { color: colors.accent }]}>
                          {unread > 9 ? '9+' : unread}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {notifications.length === 0 ? (
              <EmptyState
                icon="bell"
                title="No notifications yet"
                hint="Likes, comments, event RSVPs and job matches will appear here."
              />
            ) : visible.length === 0 ? (
              <EmptyState {...EMPTY_BY_TAB[tab]} />
            ) : (
              visible.map((item, index) => {
                const unread = !item.read_at;
                const route = notificationRouteFor(item.href);
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    onPress={() => openItem(item)}
                    style={({ pressed }) => [
                      styles.row,
                      index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                      // Web highlight: accent-soft at ~35%; the alpha suffix
                      // keeps this working for the light palette too.
                      unread && { backgroundColor: `${colors.accentSoft}59` },
                      pressed && { backgroundColor: colors.surfaceRaised },
                    ]}
                  >
                    <View
                      style={[
                        styles.iconTile,
                        { backgroundColor: unread ? colors.accentSoft : colors.backgroundSubtle },
                      ]}
                    >
                      <Feather
                        name={iconFor(item.type)}
                        size={16}
                        color={unread ? colors.accent : colors.mutedForeground}
                      />
                    </View>
                    <View style={styles.rowBody}>
                      <View style={styles.rowTop}>
                        <Text
                          style={[styles.rowTitle, { color: colors.foreground }]}
                          numberOfLines={2}
                        >
                          {item.title}
                        </Text>
                        <Text style={[styles.rowTime, { color: colors.foregroundSubtle }]}>
                          {formatRelativeTime(item.created_at)}
                        </Text>
                      </View>
                      {item.body ? (
                        <Text
                          style={[styles.rowText, { color: colors.mutedForeground }]}
                          numberOfLines={2}
                        >
                          {item.body}
                        </Text>
                      ) : null}
                      {item.type === 'job_match' && route ? (
                        <View style={styles.rowAction}>
                          <Text style={[styles.rowActionText, { color: colors.accent }]}>
                            View job
                          </Text>
                          <Feather name="arrow-right" size={12} color={colors.accent} />
                        </View>
                      ) : null}
                    </View>
                    {unread && <View style={styles.unreadDot} />}
                  </Pressable>
                );
              })
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: { padding: 2 },
  headerText: { flex: 1 },
  title: { fontFamily: 'Geist_600SemiBold', fontSize: 17 },
  subtitle: { fontFamily: 'Geist_400Regular', fontSize: 12, marginTop: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 12 },
  tabsRow: { gap: 8, paddingRight: 8 },
  tabChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  tabLabel: { fontFamily: 'Geist_500Medium', fontSize: 12 },
  tabBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeText: { fontFamily: 'Geist_600SemiBold', fontSize: 10 },
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowTitle: { flex: 1, fontFamily: 'Geist_500Medium', fontSize: 14, lineHeight: 19 },
  rowTime: { fontFamily: 'Geist_400Regular', fontSize: 11, marginTop: 2 },
  rowText: { fontFamily: 'Geist_400Regular', fontSize: 12.5, lineHeight: 18, marginTop: 2 },
  rowAction: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  rowActionText: { fontFamily: 'Geist_500Medium', fontSize: 12.5 },
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#EF4444',
    marginTop: 7,
  },
  empty: { alignItems: 'center', paddingHorizontal: 20, paddingVertical: 56 },
  emptyIcon: { opacity: 0.5, marginBottom: 10 },
  emptyTitle: { fontFamily: 'Geist_500Medium', fontSize: 14 },
  emptyHint: {
    fontFamily: 'Geist_400Regular',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 4,
  },
});
