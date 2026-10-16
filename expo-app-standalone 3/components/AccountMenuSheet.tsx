import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { hapticSelection } from '@/lib/haptics';

/**
 * The avatar menu — the touch version of the web topbar's profile dropdown,
 * with the same identity block and the same three rows in the same order:
 *
 *   View profile — opens the member's own profile screen
 *   Settings     — opens the settings hub
 *   Sign out     — ends the session (realtime teardown, push detach and the
 *                  session cookie all happen in AuthContext.logout)
 *
 * Sign out wears the same normal row style as the links above it, exactly like
 * the web dropdown — it is a plain row there, not a red one.
 */

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AccountMenuSheet({ open, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const close = () => {
    if (signingOut) return;
    onClose();
  };

  const go = (path: '/profile' | '/settings') => {
    hapticSelection();
    onClose();
    router.push(path);
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
      router.replace('/(auth)/login');
    }
  }

  return (
    <Modal transparent animationType="fade" visible={open} onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Identity — the member's name and the email they sign in with */}
          <View style={[styles.identity, { borderBottomColor: colors.border }]}>
            <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
              {user?.name ?? 'Member'}
            </Text>
            <Text style={[styles.email, { color: colors.mutedForeground }]} numberOfLines={1}>
              {user?.email ?? ''}
            </Text>
          </View>

          <MenuItem
            colors={colors}
            icon="user"
            label="View profile"
            onPress={() => go('/profile')}
          />
          <MenuItem
            colors={colors}
            icon="settings"
            label="Settings"
            onPress={() => go('/settings')}
          />

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <Pressable
            onPress={() => void handleSignOut()}
            disabled={signingOut}
            accessibilityRole="menuitem"
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: pressed ? colors.surfaceRaised : 'transparent' },
            ]}
          >
            <Feather name="log-out" size={16} color={colors.mutedForeground} />
            <Text style={[styles.rowLabel, { color: colors.foreground }]}>
              {signingOut ? 'Signing out...' : 'Sign out'}
            </Text>
            {signingOut ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : null}
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MenuItem({
  colors,
  icon,
  label,
  onPress,
}: {
  colors: ReturnType<typeof useColors>;
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="menuitem"
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.surfaceRaised : 'transparent' },
      ]}
    >
      <Feather name={icon} size={16} color={colors.mutedForeground} />
      <Text style={[styles.rowLabel, { color: colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -4 },
    elevation: 16,
  },
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
