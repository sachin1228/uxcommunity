import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AccountMenuSheet } from '@/components/AccountMenuSheet';
import { BrandLogo } from '@/components/BrandLogo';
import { PersonAvatar } from '@/components/PersonAvatar';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

export function AppHeader() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

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
        <BrandLogo size={30} />
        <Text style={[styles.logo, { color: colors.foreground }]}>uxcommunity</Text>
      </View>

      {/* The avatar is the account menu's trigger — the touch version of the
          web topbar's profile dropdown (identity, View profile, Settings,
          Sign out). Notifications live in Settings; the header carries no
          duplicate shortcut. */}
      <View style={styles.actions}>
        <Pressable
          accessibilityLabel="Profile menu"
          accessibilityRole="button"
          hitSlop={6}
          onPress={() => setMenuOpen(true)}
          style={({ pressed }) => [styles.avatarButton, { opacity: pressed ? 0.8 : 1 }]}
        >
          <PersonAvatar
            name={user?.name}
            url={user?.avatar_url}
            size={34}
            style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}
          />
        </Pressable>
      </View>

      <AccountMenuSheet open={menuOpen} onClose={() => setMenuOpen(false)} />
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
    gap: 8,
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
  avatarButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
