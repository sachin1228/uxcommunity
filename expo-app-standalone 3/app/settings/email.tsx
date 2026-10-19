import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/settings/ScreenHeader';
import { SaveStatus, type SaveState } from '@/components/settings/SaveStatus';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import {
  DEFAULT_PREFERENCES,
  fetchNotificationSettings,
  saveNotificationPreferences,
  type NotificationPreferences,
} from '@/lib/notificationSettings';

/**
 * Email — the mobile reading of the web Email card: the three optional email
 * streams, stored on the same `notification_preferences` row as the chat
 * switches and saved through the same partial PATCH, one key per change with
 * the control reverting on failure.
 */

type EmailKey = 'emailJobUpdates' | 'emailCommunityActivity' | 'emailProductNews';

const ROWS: { key: EmailKey; title: string; description: string }[] = [
  {
    key: 'emailJobUpdates',
    title: 'Job application updates',
    description: 'Shortlist and decision emails for roles you apply to.',
  },
  {
    key: 'emailCommunityActivity',
    title: 'Community activity',
    description: "Invitations and highlights from communities you're in.",
  },
  {
    key: 'emailProductNews',
    title: 'Product news',
    description: 'Occasional updates about new features.',
  },
];

export default function EmailSettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const settings = await fetchNotificationSettings();
      setPrefs(settings.preferences);
    } catch {
      setPrefs(DEFAULT_PREFERENCES);
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (key: EmailKey, next: boolean) => {
      setPrefs((current) => (current ? { ...current, [key]: next } : current));
      setSaveState('saving');
      try {
        await saveNotificationPreferences({ [key]: next });
        setSaveState('saved');
      } catch {
        // Revert only while the field still holds the attempted value.
        setPrefs((current) => (current && current[key] === next ? { ...current, [key]: !next } : current));
        setSaveState('error');
      }
    },
    [],
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Email" subtitle="Which emails we send you." />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderText}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Email</Text>
              <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
                Sent to {user?.email ?? 'your email'}.
              </Text>
            </View>
            <SaveStatus state={saveState} />
          </View>

          {!prefs ? (
            <ActivityIndicator color={colors.primary} style={styles.spinner} />
          ) : (
            <>
              {loadFailed ? (
                <Pressable onPress={() => void load()} accessibilityRole="button">
                  <Text style={[styles.hint, { color: colors.destructive }]}>
                    Couldn&apos;t load your current choices — showing defaults. Tap to retry.
                  </Text>
                </Pressable>
              ) : null}

              {ROWS.map((row, index) => (
                <View key={row.key}>
                  {index > 0 ? (
                    <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  ) : null}
                  <View style={styles.row}>
                    <View style={styles.rowText}>
                      <Text style={[styles.rowTitle, { color: colors.foreground }]}>{row.title}</Text>
                      <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                        {row.description}
                      </Text>
                    </View>
                    <Switch
                      value={prefs[row.key]}
                      onValueChange={(value) => void save(row.key, value)}
                      trackColor={{ true: colors.chatOwnBubble, false: colors.border }}
                      thumbColor={prefs[row.key] ? '#FFFFFF' : colors.foregroundSubtle}
                      ios_backgroundColor={colors.border}
                    />
                  </View>
                </View>
              ))}
            </>
          )}
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
    gap: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  cardHeaderText: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 15, fontFamily: 'Geist_600SemiBold' },
  cardSubtitle: { fontSize: 12, fontFamily: 'Geist_400Regular', marginTop: 1 },
  spinner: { alignSelf: 'flex-start' },
  hint: { fontSize: 12, fontFamily: 'Geist_400Regular', lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14, fontFamily: 'Geist_500Medium' },
  rowDescription: { fontSize: 12, fontFamily: 'Geist_400Regular', lineHeight: 17, marginTop: 1 },
  divider: { height: StyleSheet.hairlineWidth },
});
