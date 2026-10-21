import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DmIcon } from '@/components/DmIcon';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useDmUnread } from '@/hooks/useDmUnread';
import { useNotifications } from '@/hooks/useNotifications';

/**
 * The workspace header — the brand on the left, the notifications bell and the
 * Messages entry on the right.
 *
 * The DM icon mirrors the web topbar's button (right of the bell here, per the
 * mobile layout) and carries the same badge rule: the number of conversations
 * with unread peer messages, never a message sum.
 */
export function AppHeader() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { unseenCount } = useNotifications(user?.id);
  const dmUnread = useDmUnread();

  // null while the seen watermark is still loading — no number to show yet.
  const badge = unseenCount ?? 0;

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
      <View style={styles.brand}>
        <Text style={[styles.logo, { color: colors.foreground }]}>uxcommunity</Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityLabel={
            badge > 0 ? `Notifications, ${badge} unread` : 'Notifications'
          }
          accessibilityRole="button"
          hitSlop={6}
          onPress={() => router.push('/notifications')}
          style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.8 : 1 }]}
        >
          <Feather name="bell" size={21} color={colors.foreground} />
          {badge > 0 ? (
            <View
              style={[
                styles.badge,
                { backgroundColor: colors.destructive, borderColor: colors.background },
              ]}
            >
              <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
            </View>
          ) : null}
        </Pressable>

        <Pressable
          accessibilityLabel={
            dmUnread > 0 ? `Messages, ${dmUnread} unread conversations` : 'Messages'
          }
          accessibilityRole="button"
          hitSlop={6}
          onPress={() => router.push('/messages')}
          style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.8 : 1 }]}
        >
          <DmIcon size={23} color={colors.foreground} />
          {dmUnread > 0 ? (
            <View
              style={[
                styles.badge,
                { backgroundColor: colors.destructive, borderColor: colors.background },
              ]}
            >
              <Text style={styles.badgeText}>{dmUnread > 99 ? '99+' : dmUnread}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logo: {
    fontSize: 18,
    fontFamily: 'Geist_700Bold',
    letterSpacing: -0.4,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -1,
    right: -3,
    minWidth: 17,
    height: 17,
    borderRadius: 8.5,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  badgeText: {
    fontSize: 10,
    lineHeight: 13,
    fontFamily: 'Geist_600SemiBold',
    color: '#FFFFFF',
  },
});
