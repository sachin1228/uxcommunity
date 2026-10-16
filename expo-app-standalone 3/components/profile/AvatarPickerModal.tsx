import React from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

interface Props {
  visible: boolean;
  /** The picked (and re-encoded) image waiting to be uploaded. */
  previewUri: string | null;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onClose: () => void;
}

/**
 * The profile picture picker's confirm step — the mobile reading of the web
 * `ImagePickerModal`: the picked image is previewed in a rounded square, then
 * saved or discarded. On the phone the OS library sheet is the file chooser,
 * so this modal opens only once an image has actually been picked.
 */
export function AvatarPickerModal({ visible, previewUri, saving, error, onSave, onClose }: Props) {
  const colors = useColors();

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable
            style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <Text style={[styles.title, { color: colors.foreground }]}>
                Change profile picture
              </Text>
              <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
                <Feather name="x" size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>

            <View style={styles.body}>
              {error ? (
                <View style={[styles.errorBox, { borderColor: colors.destructive }]}>
                  <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
                </View>
              ) : null}

              {previewUri ? (
                <View style={styles.previewRow}>
                  <Image
                    source={{ uri: previewUri }}
                    style={[styles.previewImage, { borderColor: colors.accent }]}
                    accessibilityIgnoresInvertColors
                  />
                  <View style={styles.previewText}>
                    <Text style={[styles.previewTitle, { color: colors.foreground }]}>
                      Profile picture ready
                    </Text>
                    <Text style={[styles.previewHint, { color: colors.mutedForeground }]}>
                      JPEG, PNG or WebP · max 5 MB
                    </Text>
                  </View>
                </View>
              ) : null}
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
                onPress={onSave}
                disabled={saving || !previewUri}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.button,
                  {
                    backgroundColor: colors.primary,
                    opacity: saving || !previewUri ? 0.5 : pressed ? 0.85 : 1,
                  },
                ]}
              >
                {saving ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : null}
                <Text style={[styles.primaryLabel, { color: colors.primaryForeground }]}>
                  {saving ? 'Saving…' : 'Save profile picture'}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 15, fontFamily: 'Geist_600SemiBold' },
  body: { padding: 20 },
  errorBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  errorText: { fontSize: 12.5, fontFamily: 'Geist_400Regular', lineHeight: 18 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  previewImage: {
    width: 80,
    height: 80,
    borderRadius: 16,
    borderWidth: 2,
  },
  previewText: { flex: 1, gap: 3 },
  previewTitle: { fontSize: 14, fontFamily: 'Geist_500Medium' },
  previewHint: { fontSize: 12, fontFamily: 'Geist_400Regular' },
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
