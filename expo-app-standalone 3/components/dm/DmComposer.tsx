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
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import Svg, { Path } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';
import { MAX_MESSAGE_CHARS } from '@/lib/chat';
import type { ReplyDraft } from '@/lib/chatContentEvents';
import { prepareImageForUpload } from '@/lib/prepareImage';
import { EmojiPicker } from '@/components/chat/EmojiPicker';
import type { PendingImage } from '@/components/chat/ChatInput';
import { CHAT_COMPOSER_BOTTOM_INSET, type ChatImeLayout } from '@/hooks/useChatImeLayout';

/**
 * The DM composer — the community ChatInput without the community-only pieces
 * (mentions, content anchors). Same pill, reply banner, image preview, emoji
 * panel and send circle, so a DM reads and behaves like any other chat in the
 * app.
 */

function SendPlaneIcon({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <Svg viewBox="0 0 24 24" width={size} height={size}>
      <Path fill={color} d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </Svg>
  );
}

interface Props {
  replyTo: ReplyDraft | null;
  onCancelReply: () => void;
  onSend: (text: string, pendingImage?: PendingImage) => void;
  onTypingChange: (text: string) => void;
  disabled?: boolean;
  error?: string | null;
  leadingAccessory?: React.ReactNode;
  imeLayout: ChatImeLayout;
}

export function DmComposer({
  replyTo,
  onCancelReply,
  onSend,
  onTypingChange,
  disabled,
  error,
  leadingAccessory,
  imeLayout,
}: Props) {
  const colors = useColors();
  const [text, setText] = useState('');
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const inputRef = useRef<TextInput>(null);
  const focusRequestIdRef = useRef(0);
  /** Caret/selection as last reported by the field — emoji insert here. */
  const selectionRef = useRef({ start: 0, end: 0 });

  const emojiPanelOpen = imeLayout.panelOpen;

  const overLimit = text.length > MAX_MESSAGE_CHARS;
  const canSend = (!!text.trim() || !!pendingImage) && !overLimit && !disabled;


  function handleChangeText(value: string) {
    setText(value);
    onTypingChange(value);
  }

  function handleSend() {
    if (!canSend) return;
    onSend(text.trim(), pendingImage ?? undefined);
    setText('');
    setPendingImage(null);
    imeLayout.closePanel();
    onTypingChange('');
    selectionRef.current = { start: 0, end: 0 };
  }

  function requestKeyboard() {
    const requestId = ++focusRequestIdRef.current;
    const restoreFocus = () => {
      if (focusRequestIdRef.current === requestId) inputRef.current?.focus();
    };
    imeLayout.requestKeyboard(restoreFocus);
  }

  function openEmojiPanel() {
    focusRequestIdRef.current += 1;
    imeLayout.openEmojiPanel();
  }

  /**
   * The panel and the keyboard take turns in the same space, WhatsApp-style:
   * opening the panel dismisses the IME, and the button becomes a keyboard
   * glyph that brings it back.
   */
  function togglePicker() {
    if (imeLayout.panelOpenRef.current) {
      // Ask for the keyboard first; the panel goes when the IME reports in, so
      // the two trade places in one motion rather than in two steps.
      requestKeyboard();
    } else {
      openEmojiPanel();
    }
  }

  function insertEmoji(emoji: string) {
    const from = Math.min(selectionRef.current.start, text.length);
    const to = Math.min(Math.max(selectionRef.current.end, from), text.length);
    const next = text.slice(0, from) + emoji + text.slice(to);
    const caret = from + emoji.length;
    selectionRef.current = { start: caret, end: caret };
    setText(next);
    onTypingChange(next);
    requestAnimationFrame(() => inputRef.current?.setSelection(caret, caret));
  }

  async function handlePickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    try {
      const prepared = await prepareImageForUpload(asset, `dm-image-${Date.now()}`);
      setPendingImage({ uri: prepared.uri, mimeType: prepared.mimeType });
    } catch {
      setPendingImage({ uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' });
    }
  }

  // The 8 dp inset is a margin under the composer row (see styles.composerRow),
  // so it sits between the pill and the panel as well as between the pill and
  // the keyboard — the same pixel either way.
  return (
    <View style={styles.root}>
      <View style={styles.stack} onLayout={imeLayout.onComposerStackLayout}>
        {leadingAccessory}
        {!!error && <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>}

        <View style={styles.composerRow}>
        <View style={[styles.box, { backgroundColor: colors.surfaceRaised }]}>
          {replyTo && (
            <View
              style={[
                styles.replyBanner,
                { backgroundColor: colors.background, borderLeftColor: colors.accent },
              ]}
            >
              <View style={styles.replyInfo}>
                <Text numberOfLines={1} style={[styles.replyName, { color: colors.accent }]}>
                  {replyTo.user_name}
                </Text>
                <Text
                  numberOfLines={2}
                  style={[styles.replyText, { color: colors.mutedForeground }]}
                >
                  {replyTo.content || '📷 Image'}
                </Text>
              </View>
              <Pressable onPress={onCancelReply} hitSlop={8} accessibilityLabel="Cancel reply">
                <Feather name="x" size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>
          )}

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

          <View style={styles.boxInner}>
            <Pressable
              onPress={togglePicker}
              disabled={disabled}
              hitSlop={6}
              accessibilityLabel={emojiPanelOpen ? 'Show keyboard' : 'Open emoji picker'}
              style={({ pressed }) => [styles.pillBtn, { opacity: pressed ? 0.5 : 1 }]}
            >
              {emojiPanelOpen ? (
                <MaterialCommunityIcons
                  name="keyboard-outline"
                  size={20}
                  color={colors.accent}
                />
              ) : (
                <Feather name="smile" size={19} color={colors.mutedForeground} />
              )}
            </Pressable>

            <TextInput
              ref={inputRef}
              style={[styles.textInput, { color: colors.foreground }]}
              placeholder="Message"
              placeholderTextColor={colors.mutedForeground}
              value={text}
              onChangeText={(value) => {
                if (imeLayout.panelOpenRef.current) requestKeyboard();
                handleChangeText(value);
              }}
              // The panel dismisses the IME rather than suppressing it, so a
              // tap always focuses the field and raises the keyboard in the
              // same gesture.
              onPressIn={() => requestKeyboard()}
              onSelectionChange={(e) => {
                selectionRef.current = e.nativeEvent.selection;
              }}
              multiline
              textAlignVertical="center"
              editable={!disabled}
            />

            {text.length >= MAX_MESSAGE_CHARS - 50 && (
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
              onPress={() => void handlePickImage()}
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
      </View>

      <EmojiPicker
        onSelect={insertEmoji}
        height={imeLayout.panelHeight}
        animatedStyle={imeLayout.panelStyle}
        showContent
        interactive={imeLayout.panelInteractive}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 12, paddingTop: 2, position: 'relative', overflow: 'visible' },
  stack: {
    gap: 6,
    // Keep the input a constant distance from either the keyboard or panel.
    marginBottom: CHAT_COMPOSER_BOTTOM_INSET,
  },
  errorText: {
    fontFamily: 'Geist_400Regular',
    fontSize: 12.5,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  box: {
    flex: 1,
    borderRadius: 22,
    paddingHorizontal: 8,
    paddingVertical: 6,
    minHeight: 44,
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderLeftWidth: 3,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 6,
  },
  replyInfo: { flex: 1, minWidth: 0 },
  replyName: { fontFamily: 'Geist_600SemiBold', fontSize: 12.5 },
  replyText: { fontFamily: 'Geist_400Regular', fontSize: 12, marginTop: 1 },
  imagePreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 6,
  },
  imageThumb: { width: 34, height: 34, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth },
  imageReady: { flex: 1, fontFamily: 'Geist_400Regular', fontSize: 12 },
  boxInner: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  pillBtn: {
    width: 30,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textInput: {
    flex: 1,
    maxHeight: 120,
    minHeight: 32,
    paddingTop: 6,
    paddingBottom: 6,
    paddingHorizontal: 2,
    fontFamily: 'Geist_400Regular',
    fontSize: 15,
  },
  counter: { fontFamily: 'Geist_400Regular', fontSize: 10.5, paddingBottom: 8, paddingRight: 2 },
  limitError: {
    fontFamily: 'Geist_400Regular',
    fontSize: 11,
    paddingHorizontal: 8,
    paddingBottom: 4,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
    flexShrink: 0,
  },
});
