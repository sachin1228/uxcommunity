import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { saveProfileLink } from '@/lib/profile';

const COPY = {
  linkedin: {
    title: 'Add your LinkedIn',
    description: 'Paste your LinkedIn profile link — it shows as a button on your profile.',
    label: 'LinkedIn profile link',
    placeholder: 'https://linkedin.com/in/yourname',
    field: 'linkedin_url',
  },
  portfolio: {
    title: 'Add your portfolio',
    description: 'Paste your portfolio link — it shows as a button on your profile.',
    label: 'Portfolio link',
    placeholder: 'https://yourportfolio.com',
    field: 'portfolio_url',
  },
} as const;

interface Props {
  /** Which profile link is being saved — LinkedIn or portfolio. */
  kind: keyof typeof COPY;
  /** The current stored link, so the prompt opens on what exists. */
  initialUrl: string;
  /** Fired with the trimmed link once the save landed. */
  onSaved: (url: string) => void;
  onClose: () => void;
}

/**
 * The profile hero's prompt for an outside link — the mobile port of the web
 * `AddLinkModal`: paste the URL, save, and the hollow circle under the city
 * turns live. Mounted only while open, so every visit starts from the stored
 * value. Settings keeps its own fields for both links.
 */
export function AddLinkModal({ kind, initialUrl, onSaved, onClose }: Props) {
  const colors = useColors();
  const copy = COPY[kind];
  const [url, setUrl] = useState(initialUrl);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, []);

  const trimmed = url.trim();

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await saveProfileLink(copy.field, trimmed);
      onSaved(trimmed);
    } catch (e) {
      const hasStatus = typeof (e as { status?: number }).status === 'number';
      setError(hasStatus ? "Couldn't save this link. Please try again." : 'Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable
            style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.body}>
              <Text style={[styles.title, { color: colors.foreground }]}>{copy.title}</Text>
              <Text style={[styles.description, { color: colors.mutedForeground }]}>
                {copy.description}
              </Text>

              {error ? (
                <View style={[styles.errorBox, { borderColor: colors.destructive }]}>
                  <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
                </View>
              ) : null}

              <Text style={[styles.label, { color: colors.foreground }]}>{copy.label}</Text>
              <TextInput
                ref={inputRef}
                value={url}
                onChangeText={setUrl}
                placeholder={copy.placeholder}
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                style={[
                  styles.input,
                  {
                    color: colors.foreground,
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
              />
            </View>

            <View style={[styles.footer, { borderTopColor: colors.border }]}>
              <Pressable
                onPress={onClose}
                disabled={saving}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.button,
                  styles.secondaryButton,
                  {
                    borderColor: colors.border,
                    backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
                  },
                ]}
              >
                <Text style={[styles.secondaryLabel, { color: colors.foreground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void handleSave()}
                disabled={saving || trimmed.length === 0}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.button,
                  {
                    backgroundColor: colors.primary,
                    opacity: saving || trimmed.length === 0 ? 0.5 : pressed ? 0.85 : 1,
                  },
                ]}
              >
                {saving ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : null}
                <Text style={[styles.primaryLabel, { color: colors.primaryForeground }]}>
                  {saving ? 'Saving…' : 'Save link'}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 16,
  },
  panel: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  body: { padding: 20 },
  title: { fontSize: 16, fontFamily: 'Geist_600SemiBold' },
  description: { fontSize: 13, fontFamily: 'Geist_400Regular', lineHeight: 19, marginTop: 6 },
  errorBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 14,
  },
  errorText: { fontSize: 12.5, fontFamily: 'Geist_400Regular', lineHeight: 18 },
  label: { fontSize: 12, fontFamily: 'Geist_500Medium', marginTop: 16, marginBottom: 6 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: 'Geist_400Regular',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryButton: { borderWidth: StyleSheet.hairlineWidth },
  secondaryLabel: { fontSize: 13.5, fontFamily: 'Geist_500Medium' },
  primaryLabel: { fontSize: 13.5, fontFamily: 'Geist_600SemiBold' },
});
