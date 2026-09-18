import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
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

/**
 * Filled paper-plane send icon — the same path the web composers use, so the
 * send button silhouette is identical on both clients (WhatsApp-style).
 */
function SendPlaneIcon({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <Svg viewBox="0 0 24 24" width={size} height={size}>
      <Path fill={color} d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </Svg>
  );
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
  /** Whether the inline emoji panel below the composer is open. Controlled by
   *  the parent screen so it can also close the panel (tab switch, scroll). */
  emojiPanelOpen?: boolean;
  /** Reports panel open/close so the parent can render the panel below the
   *  footer and close it from outside (scrolling, tab change). */
  onEmojiPanelOpenChange?: (open: boolean) => void;
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
  emojiPanelOpen = false,
  onEmojiPanelOpenChange,
}: Props) {
  const colors = useColors();
  const [text, setText] = useState('');
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const inputRef = useRef<TextInput>(null);

  // The emoji panel is owned by the parent screen (it renders the panel below
  // the footer and closes it on scroll/tab change); this is just a shorthand.
  const pickerOpen = emojiPanelOpen;
  const setPickerOpen = (open: boolean) => onEmojiPanelOpenChange?.(open);

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
    setPickerOpen(false);
    onTypingChange('');
    resetMentions();
  }

  /** Emoji button — opens the inline panel below the composer (dismissing
   *  the keyboard so the input stays visible above it, WhatsApp-style); a
   *  second tap closes the panel and puts the caret back in the input. */
  function togglePicker() {
    if (pickerOpen) {
      setPickerOpen(false);
      inputRef.current?.focus();
    } else {
      setPickerOpen(true);
      Keyboard.dismiss();
    }
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
    // Deliberately not handleChangeText — picking an emoji must not close
    // the panel, so several emoji can be added in a row.
    setText(text + emoji);
    onTypingChange(text + emoji);
    onComposerActivity(text + emoji, (text + emoji).length);
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
    <View
      style={[
        styles.root,
        // While the emoji panel is open it runs edge-to-edge to the screen
        // bottom, so the composer must not add its own bottom padding.
        { paddingBottom: pickerOpen ? 0 : 8 },
      ]}
    >
      {!!error && <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>}

      {/* ── @-mention picker — floats above the composer while typing ── */}
      {mentionOpen && (
        <MentionSuggestions
          options={mentionOptions}
          query={mentionQuery}
          onPick={handlePickMention}
        />
      )}

      {/* ── Composer row: the input pill with the send button as a sibling
          circle outside it, WhatsApp-style ── */}
      <View style={styles.composerRow}>
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
          <View style={styles.boxInner}>
            <Pressable
              onPress={togglePicker}
              disabled={disabled}
              hitSlop={6}
              accessibilityLabel="Open emoji picker"
              style={({ pressed }) => [
                styles.pillBtn,
                { opacity: pressed ? 0.5 : 1 },
              ]}
            >
              <Feather
                name="smile"
                size={19}
                color={pickerOpen ? colors.accent : colors.mutedForeground}
              />
            </Pressable>

            <TextInput
              ref={inputRef}
              style={[styles.textInput, { color: colors.foreground }]}
              placeholder="Type a message…"
              placeholderTextColor={colors.mutedForeground}
              value={text}
              onChangeText={(v) => {
                // Typing means the user wants the keyboard back — close the
                // emoji panel so keyboard and panel never fight for space.
                if (pickerOpen) setPickerOpen(false);
                handleChangeText(v);
              }}
              onFocus={() => {
                // Tapping the field directly also swaps the panel for the
                // keyboard, like WhatsApp.
                if (pickerOpen) setPickerOpen(false);
              }}
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

            {/* Gallery button — at the very end of the row, WhatsApp-style */}
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
          </View>

              {overLimit && (
              <Text style={[styles.limitError, { color: colors.destructive }]}>
                Message is too long (max {MAX_MESSAGE_CHARS} characters) — remove{' '}
                {text.length - MAX_MESSAGE_CHARS} to send.
              </Text>
            )}
          </View>

        <Pressable
          onPress={handleSend}
          disabled={!canSend}
          hitSlop={4}
          accessibilityLabel="Send"
          style={({ pressed }) => [
            styles.sendBtn,
            {
              backgroundColor: canSend ? colors.chatOwnBubble : colors.surfaceRaised,
              opacity: pressed && canSend ? 0.85 : 1,
            },
          ]}
        >
          {disabled ? (
            <ActivityIndicator size="small" color={colors.mutedForeground} />
          ) : (
            <SendPlaneIcon color={canSend ? '#FFFFFF' : colors.mutedForeground} size={20} />
          )}
        </Pressable>
      </View>

      {pickerOpen && <EmojiPicker onSelect={insertEmoji} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: 12,
    paddingTop: 2,
    gap: 6,
  },

  box: {
    flex: 1,
    borderRadius: 18,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },

  /** Inner padding of the composer pill (kept off `box` so the pill's
   * chrome and its content layout can be styled independently). */
  boxInner: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 6,
    paddingVertical: 4,
  },

  /** Pill + send-button row — the button is a sibling of the pill, not
   * inside it, so the pill never has to grow around the button. */
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
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
    // Matches the pill's single-line height (padding 4+4 + input 36) so the
    // circle is flush with the pill's bottom edge, exactly like WhatsApp.
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  errorText: { fontSize: 12, fontFamily: 'Geist_400Regular', paddingLeft: 4 },
  limitError: { fontSize: 11, fontFamily: 'Geist_400Regular', paddingHorizontal: 8, paddingBottom: 6 },
});
