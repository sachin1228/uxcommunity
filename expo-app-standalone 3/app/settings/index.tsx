import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/settings/ScreenHeader';
import { useColors } from '@/hooks/useColors';
import { hapticSelection } from '@/lib/haptics';

/**
 * Settings — the first level of the drill-down, the mobile reading of the web
 * /dashboard/settings index: one row per category, each opening its own page,
 * so a page carries only the settings the member came for.
 */

const ROWS: {
  href:
    | '/settings/profile'
    | '/settings/account'
    | '/settings/notifications'
    | '/settings/email'
    | '/settings/connected-accounts'
    | '/settings/job-profile';
  label: string;
  description: string;
  icon: React.ComponentProps<typeof Feather>['name'];
}[] = [
  {
    href: '/settings/profile',
    label: 'Profile',
    description: 'Your name, role and city.',
    icon: 'user',
  },
  {
    href: '/settings/job-profile',
    label: 'Job profile',
    description: 'Your portfolio link and saved resumes.',
    icon: 'briefcase',
  },
  {
    href: '/settings/account',
    label: 'Account',
    description: 'Your email, password and sign-in details.',
    icon: 'key',
  },
  {
    href: '/settings/notifications',
    label: 'Notifications',
    description: 'Chat pushes, sounds and quiet hours.',
    icon: 'bell',
  },
  {
    href: '/settings/email',
    label: 'Email',
    description: 'Which emails we send you.',
    icon: 'mail',
  },
  {
    href: '/settings/connected-accounts',
    label: 'Connected accounts',
    description: 'Link outside accounts to your profile.',
    icon: 'link-2',
  },
];

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Settings" subtitle="Manage your profile, account, notifications and email." />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {ROWS.map((row, index) => (
            <View key={row.href}>
              {index > 0 ? (
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
              ) : null}
              <Pressable
                onPress={() => {
                  hapticSelection();
                  router.push(row.href);
                }}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: pressed ? colors.surfaceRaised : 'transparent' },
                ]}
              >
                <View
                  style={[
                    styles.iconCircle,
                    { borderColor: colors.border, backgroundColor: colors.background },
                  ]}
                >
                  <Feather name={row.icon} size={15} color={colors.mutedForeground} />
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.rowLabel, { color: colors.foreground }]}>{row.label}</Text>
                  <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                    {row.description}
                  </Text>
                </View>
                <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
              </Pressable>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16 },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 14, fontFamily: 'Geist_500Medium' },
  rowDescription: { fontSize: 12, fontFamily: 'Geist_400Regular', marginTop: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 68 },
});
