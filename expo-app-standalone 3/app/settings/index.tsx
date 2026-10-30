import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/settings/ScreenHeader';
import { useAuth } from '@/context/AuthContext';
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
    | '/settings/blocked-accounts'
    | '/settings/notifications'
    | '/settings/email'
    | '/settings/connected-accounts'
    | '/settings/job-profile'
    | '/settings/verification';
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
    href: '/settings/verification',
    label: 'Verification',
    description: 'Verify your profile to unlock all features.',
    icon: 'shield',
  },
  {
    href: '/settings/account',
    label: 'Account',
    description: 'Your email, password and sign-in details.',
    icon: 'key',
  },
  {
    href: '/settings/blocked-accounts',
    label: 'Blocked accounts',
    description: 'People who cannot message or mention you.',
    icon: 'slash',
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
  const { logout, user } = useAuth();
  // The verification option appears with the banner: after the signup grace
  // window, or immediately for pending/rejected accounts. Approved accounts
  // have nothing to do here.
  const rows = ROWS.filter(
    (row) => row.href !== '/settings/verification' || user?.verificationBannerVisible === true,
  );
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    if (signingOut) return;
    hapticSelection();
    setSigningOut(true);
    // logout() clears the local identity immediately, then finishes the
    // best-effort teardown (push token, server session, caches). SessionGate
    // in the root layout is the ONE place that reacts to that cleared
    // identity by moving to the login screen.
    //
    // Do not navigate here as well: the gate's redirect lands while this
    // request is still in flight, so a second replace when logout() settles
    // re-enters the same screen and makes the sign-in page flicker
    // (settings fades out, login fades in, login fades in again).
    try {
      await logout();
    } catch {
      /* the local session is cleared regardless */
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Settings" subtitle="Manage your profile, account, notifications and email." />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {rows.map((row, index) => (
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

        <View
          style={[
            styles.card,
            styles.signOutCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Pressable
            onPress={() => void handleSignOut()}
            disabled={signingOut}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
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
              <Feather name="log-out" size={15} color={colors.destructive} />
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, { color: colors.destructive }]}>
                {signingOut ? 'Signing out...' : 'Sign out'}
              </Text>
              <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                Sign out of your account on this device.
              </Text>
            </View>
            {signingOut ? (
              <ActivityIndicator size="small" color={colors.mutedForeground} />
            ) : null}
          </Pressable>
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
  signOutCard: { marginTop: 16 },
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
