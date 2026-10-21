import React from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

/**
 * The chat list's "notifications are off" prompt, modelled on WhatsApp's:
 * a tinted banner with an inline "Turn on" link that opens a bottom sheet
 * explaining what is missed and offering a shortcut into the app's system
 * settings.
 */

const ACCENT = '#0062D1';

const BULLETS: Array<{ icon: React.ComponentProps<typeof Feather>['name']; label: string }> = [
  { icon: 'message-circle', label: 'Find out when you receive messages' },
  { icon: 'calendar', label: 'Know when events you’re going to are about to start' },
  { icon: 'settings', label: 'Change this setting at any time' },
];

export function NotificationPermissionBanner({
  onEnable,
  onDismiss,
}: {
  onEnable: () => void;
  onDismiss: () => void;
}) {
  const colors = useColors();
  const background = colors.isDark ? 'rgba(0, 98, 209, 0.16)' : 'rgba(0, 98, 209, 0.08)';
  const border = colors.isDark ? 'rgba(82, 168, 255, 0.28)' : 'rgba(0, 98, 209, 0.22)';

  return (
    <View style={[styles.notice, { backgroundColor: background, borderColor: border }]}>
      <Feather name="bell" size={20} color={colors.link} style={styles.noticeIcon} />
      <View style={styles.noticeCopy}>
        <Text style={[styles.noticeTitle, { color: colors.foreground }]}>
          Get message notifications
        </Text>
        <Text style={[styles.noticeText, { color: colors.foregroundMuted }]}>
          Make sure you know when you have new messages.{' '}
          <Text
            style={[styles.noticeLink, { color: colors.link }]}
            onPress={onEnable}
            accessibilityRole="link"
          >
            Turn on
          </Text>
        </Text>
      </View>
      <Pressable
        onPress={onDismiss}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Dismiss notification prompt"
        style={styles.noticeDismiss}
      >
        <Feather name="x" size={16} color={colors.foregroundMuted} />
      </Pressable>
    </View>
  );
}

export function NotificationPermissionSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const openSettings = () => {
    onClose();
    void Linking.openSettings().catch(() => {});
  };

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 16) + 8,
            },
          ]}
          onPress={(event) => event.stopPropagation()}
        >
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={styles.close}
          >
            <Feather name="x" size={18} color={colors.foregroundMuted} />
          </Pressable>

          <View style={styles.badge}>
            <Feather name="bell" size={30} color="#FFFFFF" />
          </View>

          <Text style={[styles.title, { color: colors.foreground }]}>
            Turn on notifications for uxcommunity
          </Text>
          <Text style={[styles.subtitle, { color: colors.foregroundMuted }]}>
            Allow uxcommunity to send you notifications so you stay up to date with messages
            and events.
          </Text>

          <View style={styles.bullets}>
            {BULLETS.map((bullet) => (
              <View key={bullet.label} style={styles.bullet}>
                <Feather name={bullet.icon} size={18} color={colors.link} />
                <Text style={[styles.bulletText, { color: colors.foreground }]}>
                  {bullet.label}
                </Text>
              </View>
            ))}
          </View>

          <Pressable
            onPress={openSettings}
            accessibilityRole="button"
            style={({ pressed }) => [styles.cta, { opacity: pressed ? 0.85 : 1 }]}
          >
            <Text style={styles.ctaText}>Go to Settings</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 8,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  noticeIcon: { marginTop: 1 },
  noticeCopy: { flex: 1, paddingRight: 2 },
  noticeTitle: { fontSize: 14, fontFamily: 'Geist_600SemiBold' },
  noticeText: {
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: 'Geist_400Regular',
    marginTop: 3,
  },
  noticeLink: { fontFamily: 'Geist_600SemiBold' },
  noticeDismiss: { padding: 2, marginTop: -2 },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 24,
    paddingTop: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -4 },
    elevation: 16,
  },
  close: { position: 'absolute', left: 18, top: 16, padding: 4, zIndex: 1 },
  badge: {
    width: 76,
    height: 76,
    borderRadius: 38,
    marginTop: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ACCENT,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontFamily: 'Geist_600SemiBold',
    textAlign: 'center',
    marginTop: 20,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: 'Geist_400Regular',
    textAlign: 'center',
    marginTop: 8,
  },
  bullets: { alignSelf: 'stretch', marginTop: 24, gap: 16 },
  bullet: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  bulletText: { flex: 1, fontSize: 14, fontFamily: 'Geist_400Regular' },
  cta: {
    alignSelf: 'stretch',
    height: 50,
    borderRadius: 12,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
  },
  ctaText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Geist_600SemiBold' },
});
