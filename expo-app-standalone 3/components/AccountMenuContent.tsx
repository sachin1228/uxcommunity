import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { hapticSelection } from '@/lib/haptics';

/**
 * The account menu's rows — identity, Settings and Sign out.
 *
 * Shared by the avatar's bottom sheet (the other tabs) and the Profile
 * header's side menu, so the rows and the sign-out path are identical
 * wherever the menu is opened from. The host decides how it is presented and
 * hands back `onNavigate` so it can dismiss itself.
 */

interface Props {
  /** Dismiss the host — called before Settings opens and after sign-out. */
  onNavigate: () => void;
}

export function AccountMenuContent({ onNavigate }: Props) {
  const colors = useColors();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const openSettings = () => {
    hapticSelection();
    onNavigate();
    router.push('/settings');
  };

  async function handleSignOut() {
    if (signingOut) return;
    hapticSelection();
    setSigningOut(true);
    // logout() is best-effort on the wire and always clears the local session
    // (realtime first, then the push token, then the cookie) — whatever it
    // returns, the login screen is the right place to land next.
    try {
      await logout();
    } catch {
      /* the local session is cleared regardless */
    } finally {
      setSigningOut(false);
      onNavigate();
      router.replace('/(auth)/login');
    }
  }

  return (
    <>
      {/* Identity — the member's name and the email they sign in with */}
      <View style={[styles.identity, { borderBottomColor: colors.border }]}>
        <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
          {user?.name ?? 'Member'}
        </Text>
        <Text style={[styles.email, { color: colors.mutedForeground }]} numberOfLines={1}>
          {user?.email ?? ''}
        </Text>
      </View>

      <MenuRow icon="settings" label="Settings" onPress={openSettings} />

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      <MenuRow
        icon="log-out"
        label={signingOut ? 'Signing out...' : 'Sign out'}
        onPress={() => void handleSignOut()}
        disabled={signingOut}
        busy={signingOut}
      />
    </>
  );
}

function MenuRow({
  icon,
  label,
  onPress,
  disabled,
  busy,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const colors = useColors();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="menuitem"
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.surfaceRaised : 'transparent' },
      ]}
    >
      <Feather name={icon} size={16} color={colors.mutedForeground} />
      <Text style={[styles.rowLabel, { color: colors.foreground }]}>{label}</Text>
      {busy ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  identity: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  name: { fontSize: 15, fontFamily: 'Geist_600SemiBold' },
  email: { fontSize: 12.5, fontFamily: 'Geist_400Regular', marginTop: 3 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  rowLabel: { flex: 1, fontSize: 15, fontFamily: 'Geist_500Medium' },
  divider: { height: StyleSheet.hairlineWidth },
});
