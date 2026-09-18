import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { Message } from '@/lib/communities';
import { MAX_MESSAGE_CHARS, extractFirstUrl, type MessageMention } from '@/lib/chat';
import { useMemberMentions } from '@/hooks/useMemberMentions';
import * as ImagePicker from 'expo-image-picker';
import { prepareImageForUpload } from '@/lib/prepareImage';
import { EmojiPicker } from './EmojiPicker';
import { MentionSuggestions } from './MentionSuggestions';

export interface PendingImage {
  uri: string;
  mimeType: string;
}

interface Props {
  communityId: string;
  currentUserId: string;
  replyTo: Message | null;
  onCancelReply: () => void;
  onSend: (text: string, pendingImage?: PendingImage, mentions?: MessageMention[]) => void;
  onTypingChange: (text: string) => void;
  disabled?: boolean;
  /** Populated by the parent so a send failure shows inside the composer, as on web. */
  error?: string | null;
}

export function ChatInput({
  communityId,
  currentUserId,
  replyTo,
  onCancelReply,
  onSend,
  onTypingChange,
  disabled,
  error,
}: Props) {
  const colors = useColors();
  const [text, setText] = useState('');
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const {
    mentionOpen,
    mentionQuery,
    mentionOptions,
    onComposerActivity,
    pickMention,
    resolveMentions,
    resetMentions,
    closeMentions,
  } = useMemberMentions({ communityId, currentUserId });

  const overLimit = text.length > MAX_MESSAGE_CHARS;
  const canSend = (!!text.trim() || !!pendingImage) && !overLimit && !disabled;
  const nearLimit = text.length >= MAX_MESSAGE_CHARS - 50;
  const linkPreviewUrl = text.trim() ? extractFirstUrl(text) : null;

  function handleChangeText(val: string) {
    setText(val);
    onTypingChange(val);
    // The caret is always at the end of what was just typed in this flow.
    onComposerActivity(val, val.length);
  }

  function handleSend() {
    if (!canSend) return;
    const trimmed = text.trim();
    onSend(trimmed, pendingImage ?? undefined, resolveMentions(trimmed));
    setText('');
    setPendingImage(null);
    onTypingChange('');
    resetMentions();
  }

  function handlePickMention(candidate: Parameters<typeof pickMention>[0]) {
    const next = pickMention(candidate, text);
    if (!next) return;
    setText(next.text);
    onTypingChange(next.text);
    // Restore the caret to just after the inserted mention.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelection(next.caret, next.caret);
    });
  }

  function insertEmoji(emoji: string) {
    handleChangeText(text + emoji);
  }

  async function handlePickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      // No intermediate loss here — prepareImageForUpload applies the final
      // WebP quality-0.90 encode (max dimension 2560, never upscaled).
      quality: 1,
      allowsEditing: false,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    try {
      const prepared = await prepareImageForUpload(asset, `chat-image-${Date.now()}`);
      setPendingImage({ uri: prepared.uri, mimeType: prepared.mimeType });
    } catch {
      // Keep the original picked image as a last-resort fallback.
      setPendingImage({ uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' });
    }
  }

  return (
    <View style={styles.root}>
      {!!error && <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>}

      {/* ── @-mention picker — floats above the composer while typing ── */}
      {mentionOpen && (
        <MentionSuggestions
          options={mentionOptions}
          query={mentionQuery}
          onPick={handlePickMention}
        />
      )}

      {/* ── Composer box — web parity: surface-raised rounded panel ── */}
      <View style={[styles.box, { backgroundColor: colors.surfaceRaised }]}>
        {/* Reply quote inside the box */}
        {replyTo && (
          <View
            style={[
              styles.replyBanner,
              { backgroundColor: colors.background, borderLeftColor: colors.accent },
            ]}
          >
            <View style={styles.replyInfo}>
              <Text numberOfLines={1} style={[styles.replyName, { color: colors.accent }]}>
                {replyTo.users?.name ?? 'message'}
              </Text>
              <Text numberOfLines={2} style={[styles.replyText, { color: colors.mutedForeground }]}>
                {replyTo.content || '📷 Image'}
              </Text>
            </View>
            <Pressable onPress={onCancelReply} hitSlop={8} accessibilityLabel="Cancel reply">
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>
        )}

        {/* Pending image preview strip */}
        {pendingImage && (
          <View style={styles.imagePreviewRow}>
            <Image
              source={{ uri: pendingImage.uri }}
              style={[styles.imageThumb, { borderColor: colors.border }]}
              resizeMode="cover"
            />
            <Text numberOfLines={1} style={[styles.imageReady, { color: colors.mutedForeground }]}>
              Image ready to send
            </Text>
            <Pressable
              onPress={() => setPendingImage(null)}
              hitSlop={8}
              accessibilityLabel="Remove image"
            >
              <Feather name="x" size={14} color={colors.mutedForeground} />
            </Pressable>
          </View>
        )}

        {/* Link hint — shown while composing when a URL is detected */}
        {!!linkPreviewUrl && (
          <View style={styles.linkRow}>
            <Feather name="link" size={11} color={colors.mutedForeground} />
            <Text numberOfLines={1} style={[styles.linkText, { color: colors.mutedForeground }]}>
              {(() => {
                try {
                  return new URL(linkPreviewUrl).hostname.replace(/^www\./, '');
                } catch {
                  return linkPreviewUrl;
                }
              })()}
            </Text>
          </View>
        )}

        {/* Input row */}
        <View style={styles.inputRow}>
          <Pressable
            onPress={() => setPickerOpen(true)}
            disabled={disabled}
            hitSlop={6}
            accessibilityLabel="Open emoji picker"
            style={({ pressed }) => [styles.pillBtn, { opacity: pressed ? 0.5 : 1 }]}
          >
            <Feather name="smile" size={19} color={colors.mutedForeground} />
          </Pressable>

          <Pressable
            onPress={handlePickImage}
            disabled={disabled}
            hitSlop={6}
            accessibilityLabel="Attach image"
            style={({ pressed }) => [styles.pillBtn, { opacity: pressed ? 0.5 : 1 }]}
          >
            <Feather
              name="image"
              size={19}
              color={pendingImage ? colors.accent : colors.mutedForeground}
            />
          </Pressable>

          <TextInput
            ref={inputRef}
            style={[styles.textInput, { color: colors.foreground }]}
            placeholder="Type a message…"
            placeholderTextColor={colors.mutedForeground}
            value={text}
            onChangeText={handleChangeText}
            onSelectionChange={(e) => onComposerActivity(text, e.nativeEvent.selection.end)}
            multiline
            returnKeyType="default"
            editable={!disabled}
            textAlignVertical="center"
          />

          {nearLimit && (
            <Text
              style={[
                styles.counter,
                { color: overLimit ? colors.destructive : colors.mutedForeground },
              ]}
            >
              {text.length}/{MAX_MESSAGE_CHARS}
            </Text>
          )}

          <Pressable
            onPress={handleSend}
            disabled={!canSend}
            hitSlop={4}
            accessibilityLabel="Send"
            style={({ pressed }) => [
              styles.sendBtn,
              {
                backgroundColor: canSend ? colors.chatOwnBubble : colors.subtle,
                opacity: pressed && canSend ? 0.85 : 1,
              },
            ]}
          >
            {disabled ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Feather
                name="send"
                size={15}
                color={canSend ? '#FFFFFF' : colors.mutedForeground}
                style={{ marginLeft: 1 }}
              />
            )}
          </Pressable>
        </View>

        {overLimit && (
          <Text style={[styles.limitError, { color: colors.destructive }]}>
            Message is too long (max {MAX_MESSAGE_CHARS} characters) — remove{' '}
            {text.length - MAX_MESSAGE_CHARS} to send.
          </Text>
        )}
      </View>

      <EmojiPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={insertEmoji}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: 12,
    paddingTop: 2,
    paddingBottom: 8,
    gap: 6,
  },

  box: {
    borderRadius: 18,
    paddingHorizontal: 6,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },

  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderLeftWidth: 2,
    borderRadius: 6,
    marginTop: 4,
    marginBottom: 2,
    marginHorizontal: 6,
    paddingLeft: 8,
    paddingRight: 6,
    paddingVertical: 6,
    gap: 8,
  },
  replyInfo: { flex: 1, minWidth: 0, gap: 2 },
  replyName: { fontSize: 11, fontFamily: 'Geist_600SemiBold' },
  replyText: { fontSize: 11, fontFamily: 'Geist_400Regular' },

  imagePreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 6,
    paddingTop: 6,
  },
  imageThumb: { width: 56, height: 56, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  imageReady: { flex: 1, fontSize: 11, fontFamily: 'Geist_400Regular' },

  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingTop: 4,
  },
  linkText: { flex: 1, fontSize: 10, fontFamily: 'Geist_400Regular' },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingVertical: 6,
    paddingHorizontal: 2,
    gap: 2,
  },

  pillBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  textInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: 'Geist_400Regular',
    maxHeight: 120,
    paddingTop: 7,
    paddingBottom: 7,
    paddingHorizontal: 4,
    backgroundColor: 'transparent',
    includeFontPadding: false,
  },

  counter: { fontSize: 10, fontFamily: 'Geist_400Regular', marginBottom: 10, flexShrink: 0 },

  sendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
    flexShrink: 0,
  },

  errorText: { fontSize: 12, fontFamily: 'Geist_400Regular', paddingLeft: 4 },
  limitError: { fontSize: 11, fontFamily: 'Geist_400Regular', paddingHorizontal: 8, paddingBottom: 6 },
});
