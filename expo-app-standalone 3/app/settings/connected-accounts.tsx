import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/settings/ScreenHeader';
import { useColors } from '@/hooks/useColors';

/**
 * Connected accounts — deliberately empty for now, exactly like the web card.
 *
 * No OAuth exists anywhere in the product yet, so there is nothing to connect
 * and no control that would be a dead button. LinkedIn, the first account we
 * plan to offer, lives on the Profile settings page until the flow exists.
 */
export default function ConnectedAccountsSettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Connected accounts" />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Connected accounts</Text>
            <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>
              Link outside accounts to power applications and your profile.
            </Text>
          </View>

          <View style={[styles.emptyBox, { borderColor: colors.border, backgroundColor: colors.background }]}>
            <Text style={[styles.emptyTitle, { color: colors.mutedForeground }]}>
              No accounts connected yet.
            </Text>
            <Text style={[styles.emptyHint, { color: colors.foregroundSubtle }]}>
              We&apos;ll list them here as they become available.
            </Text>
          </View>
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
    padding: 18,
    gap: 16,
  },
  cardTitle: { fontSize: 15, fontFamily: 'Geist_600SemiBold' },
  cardSubtitle: { fontSize: 12, fontFamily: 'Geist_400Regular', lineHeight: 17, marginTop: 2 },
  emptyBox: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  emptyTitle: { fontSize: 14, fontFamily: 'Geist_400Regular' },
  emptyHint: { fontSize: 12, fontFamily: 'Geist_400Regular', marginTop: 4 },
});
