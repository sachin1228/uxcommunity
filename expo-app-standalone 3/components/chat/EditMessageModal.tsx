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
import { Message } from '@/lib/communities';
import { MAX_MESSAGE_CHARS } from '@/lib/chat';

interface Props {
  message: Message | null;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (messageId: string, content: string) => void;
}

/**
 * Edit composer — a React Native port of the web `MessageEditModal`: the
 * original bubble is shown as a quote, the text is editable, and Save is
 * blocked while empty, unchanged or over the character limit.
 */
export function EditMessageModal({ message, isSaving, error, onClose, onSave }: Props) {
  const colors = useColors();
  const [draft, setDraft] = useState('');
  const inputRef = useRef<TextInput>(null);

  // Seed the draft from the message being edited, and focus the input.
  useEffect(() => {
    setDraft(message?.content ?? '');
    if (message) {
      const t = setTimeout(() => inputRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [message]);

  if (!message) return null;

  const trimmed = draft.trim();
  const overLimit = draft.length > MAX_MESSAGE_CHARS;
  const unchanged = trimmed === (message.content ?? '').trim();
  const canSave = !!trimmed && !overLimit && !unchanged && !isSaving;

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
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <Text style={[styles.title, { color: colors.foreground }]}>Edit message</Text>
              <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
                <Feather name="x" size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>

            {/* Original message quote — WhatsApp-style left tail, blue bubble */}
            <View style={styles.quoteWrap}>
              <View style={[styles.quote, { backgroundColor: colors.chatOwnBubble }]}>
                <Text style={styles.quoteText}>{message.content}</Text>
              </View>
            </View>

            <View style={[styles.inputBox, { backgroundColor: colors.surfaceRaised }]}>
              <TextInput
                ref={inputRef}
                value={draft}
                onChangeText={setDraft}
                multiline
                textAlignVertical="top"
                placeholder="Message…"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.input, { color: colors.foreground }]}
              />
            </View>

            {!!error && <Text style={styles.error}>{error}</Text>}

            <View style={styles.footer}>
              <Text
                style={[
                  styles.counter,
                  { color: overLimit ? colors.destructive : colors.mutedForeground },
                ]}
              >
                {draft.length}/{MAX_MESSAGE_CHARS}
              </Text>
              <Pressable
                onPress={() => onSave(message.id, trimmed)}
                disabled={!canSave}
                style={({ pressed }) => [
                  styles.saveBtn,
                  {
                    backgroundColor: canSave ? colors.chatOwnBubble : colors.subtle,
                    opacity: pressed && canSave ? 0.85 : 1,
                  },
                ]}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text
                    style={[
                      styles.saveText,
                      { color: canSave ? '#FFFFFF' : colors.mutedForeground },
                    ]}
                  >
                    Save
                  </Text>
                )}
              </Pressable>
            </View>

            {overLimit && (
              <Text style={styles.error}>
                Message is too long (max {MAX_MESSAGE_CHARS} characters) — remove{' '}
                {draft.length - MAX_MESSAGE_CHARS} to save.
              </Text>
            )}
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
    padding: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  panel: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 16, fontFamily: 'Geist_600SemiBold' },

  quoteWrap: { alignItems: 'flex-end', marginTop: 12, marginBottom: 12 },
  quote: {
    maxWidth: '85%',
    borderTopLeftRadius: 10,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  quoteText: { color: '#FFFFFF', fontSize: 14, lineHeight: 20, fontFamily: 'Geist_400Regular' },

  inputBox: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  input: {
    minHeight: 76,
    maxHeight: 180,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: 'Geist_400Regular',
    includeFontPadding: false,
  },

  error: {
    fontSize: 11,
    fontFamily: 'Geist_400Regular',
    color: '#EF4444',
    marginTop: 8,
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  counter: { fontSize: 10, fontFamily: 'Geist_400Regular' },
  saveBtn: {
    minWidth: 84,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  saveText: { fontSize: 14, fontFamily: 'Geist_600SemiBold' },
});
