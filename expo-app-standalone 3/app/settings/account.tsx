import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/settings/ScreenHeader';
import { useColors } from '@/hooks/useColors';
import { apiFetch } from '@/lib/api';
import { getOwnProfile } from '@/lib/profile';

/**
 * Account — the mobile reading of the web Account card: who the member is
 * (the email they sign in with, when they joined) and the one action this
 * page can take: asking for a password reset link.
 *
 * Both identity rows are read-only on purpose — the email is the account's
 * anchor — so they are rendered as text, not disabled inputs.
 */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "October 2026", exactly like the web's member-since line. */
function memberSinceLabel(createdAt: string | null | undefined): string | null {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export default function AccountSettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [email, setEmail] = useState<string | null>(null);
  const [memberSince, setMemberSince] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const profile = await getOwnProfile();
      setEmail(profile.user?.email ?? null);
      setMemberSince(memberSinceLabel(profile.user?.created_at));
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sendResetLink = useCallback(async () => {
    if (sending || !email) return;
    setSending(true);
    setMessage(null);
    setError(null);
    try {
      // The reset route rate-limits by IP and answers a generic success so an
      // email can never be probed; its own message is what we show.
      const { data } = await apiFetch<{ success?: boolean; message?: string }>(
        '/api/auth/reset-request',
        { method: 'POST', body: { email } },
      );
      setMessage(
        data.message ?? "If an account with that email exists, you'll receive a reset link shortly.",
      );
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (typeof status === 'number') {
        const data = (e as { data?: { message?: string; error?: string } }).data;
        setError(data?.message ?? data?.error ?? 'The reset link could not be sent. Please try again.');
      } else {
        setError('The reset link could not be sent. Check your connection and try again.');
      }
    } finally {
      setSending(false);
    }
  }, [email, sending]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Account" />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Account</Text>

          {loadFailed && !email ? (
            <Pressable onPress={() => void load()} accessibilityRole="button">
              <Text style={[styles.rowValue, { color: colors.destructive }]}>
                Couldn&apos;t load your account. Tap to retry.
              </Text>
            </Pressable>
          ) : !email ? (
            <ActivityIndicator color={colors.primary} style={styles.spinner} />
          ) : (
            <>
              <View>
                <Text style={[styles.rowLabel, { color: colors.foreground }]}>Email</Text>
                <Text style={[styles.rowValue, { color: colors.foreground }]} numberOfLines={1}>
                  {email}
                </Text>
              </View>

              {memberSince ? (
                <View>
                  <Text style={[styles.rowLabel, { color: colors.foreground }]}>Member since</Text>
                  <Text style={[styles.rowValue, { color: colors.foreground }]}>{memberSince}</Text>
                </View>
              ) : null}

              <View style={[styles.passwordBlock, { borderTopColor: colors.border }]}>
                <View style={styles.passwordRow}>
                  <View style={styles.passwordText}>
                    <Text style={[styles.rowLabel, { color: colors.foreground }]}>Password</Text>
                    <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                      Send a reset link to your email.
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => void sendResetLink()}
                    disabled={sending}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.resetButton,
                      {
                        borderColor: colors.border,
                        backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
                        opacity: sending ? 0.6 : 1,
                      },
                    ]}
                  >
                    {sending ? <ActivityIndicator size="small" color={colors.foreground} /> : null}
                    <Text style={[styles.resetLabel, { color: colors.foreground }]}>
                      {sending ? 'Sending…' : 'Send reset link'}
                    </Text>
                  </Pressable>
                </View>

                {message ? (
                  <Text style={[styles.feedback, { color: colors.success }]}>{message}</Text>
                ) : null}
                {error ? (
                  <Text style={[styles.feedback, { color: colors.destructive }]}>{error}</Text>
                ) : null}
              </View>

              <View style={[styles.passwordBlock, { borderTopColor: colors.border }]}>
                <View style={styles.passwordRow}>
                  <View style={styles.passwordText}>
                    <Text style={[styles.rowLabel, { color: colors.foreground }]}>
                      Delete account
                    </Text>
                    <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                      Permanently remove your account and content.
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => router.push('/settings/delete-account' as Href)}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.resetButton,
                      {
                        borderColor: colors.destructive,
                        backgroundColor: pressed ? `${colors.destructive}14` : 'transparent',
                      },
                    ]}
                  >
                    <Text style={[styles.resetLabel, { color: colors.destructive }]}>
                      Delete
                    </Text>
                  </Pressable>
                </View>
              </View>
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
    gap: 16,
  },
  cardTitle: { fontSize: 15, fontFamily: 'Geist_600SemiBold' },
  spinner: { alignSelf: 'flex-start' },
  rowLabel: { fontSize: 12, fontFamily: 'Geist_500Medium' },
  rowValue: { fontSize: 14, fontFamily: 'Geist_400Regular', marginTop: 3 },
  passwordBlock: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16 },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  passwordText: { flex: 1, minWidth: 0 },
  hint: { fontSize: 12, fontFamily: 'Geist_400Regular', marginTop: 2 },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  resetLabel: { fontSize: 13, fontFamily: 'Geist_500Medium' },
  feedback: { fontSize: 12, fontFamily: 'Geist_400Regular', lineHeight: 17, marginTop: 10 },
});
