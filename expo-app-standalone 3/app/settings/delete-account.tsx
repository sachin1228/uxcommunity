import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/settings/ScreenHeader';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { apiFetch } from '@/lib/api';
import { hapticSelection } from '@/lib/haptics';

/**
 * Delete account — the mobile twin of the web Account card's danger action.
 *
 * Requires the current password and the literal word DELETE, calls the same
 * `/api/account/delete` endpoint as the web, then clears the local session so
 * the auth gate returns to sign-in.
 */
export default function DeleteAccountScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = password.length > 0 && confirmation === 'DELETE' && !submitting;

  async function handleDelete() {
    if (!canSubmit) return;
    hapticSelection();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/api/account/delete', {
        method: 'POST',
        body: { password, confirmation },
      });
      await logout().catch(() => undefined);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401) {
        // The account is already gone or the session expired; clear locally.
        await logout().catch(() => undefined);
        return;
      }
      setError((e as Error).message || 'Your account could not be deleted. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Delete account" subtitle="This cannot be undone." />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.body, { color: colors.foreground }]}>
            This permanently deletes your profile, posts, comments, community
            messages, direct messages (for both participants), applications and
            uploaded files.
          </Text>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.foreground }]}>Your password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={!submitting}
              placeholder="Enter your password"
              placeholderTextColor={colors.mutedForeground}
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                },
              ]}
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.foreground }]}>
              Type DELETE to confirm
            </Text>
            <TextInput
              value={confirmation}
              onChangeText={setConfirmation}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!submitting}
              placeholder="DELETE"
              placeholderTextColor={colors.mutedForeground}
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                },
              ]}
            />
          </View>

          {error ? (
            <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
          ) : null}

          <Pressable
            onPress={() => void handleDelete()}
            disabled={!canSubmit}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.deleteButton,
              {
                borderColor: colors.destructive,
                backgroundColor: pressed ? `${colors.destructive}14` : 'transparent',
                opacity: canSubmit ? 1 : 0.5,
              },
            ]}
          >
            {submitting ? <ActivityIndicator size="small" color={colors.destructive} /> : null}
            <Text style={[styles.deleteLabel, { color: colors.destructive }]}>
              {submitting ? 'Deleting…' : 'Delete my account'}
            </Text>
          </Pressable>

          <Text style={[styles.help, { color: colors.mutedForeground }]}>
            If you cannot sign in, email hello@uxcommunity.in from the address on
            your account.
          </Text>
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
    gap: 18,
  },
  body: { fontSize: 14, fontFamily: 'Geist_400Regular', lineHeight: 21 },
  field: { gap: 6 },
  label: { fontSize: 12, fontFamily: 'Geist_500Medium' },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    fontFamily: 'Geist_400Regular',
  },
  error: { fontSize: 12, fontFamily: 'Geist_400Regular', lineHeight: 17 },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 12,
  },
  deleteLabel: { fontSize: 14, fontFamily: 'Geist_500Medium' },
  help: { fontSize: 12, fontFamily: 'Geist_400Regular', lineHeight: 17 },
});
