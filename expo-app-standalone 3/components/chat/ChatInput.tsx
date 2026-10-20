import React, { useEffect, useRef, useState } from 'react';
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
import Svg, { Path } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';
import { MAX_MESSAGE_CHARS, extractFirstUrl, userNameColor, type MessageMention } from '@/lib/chat';
import type { ReplyDraft } from '@/lib/chatContentEvents';
import { useMemberMentions } from '@/hooks/useMemberMentions';
import { CHAT_COMPOSER_BOTTOM_INSET, type ChatImeLayout } from '@/hooks/useChatImeLayout';
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
  /** The draft being replied to — a message or a "created a …" card. */
  replyTo: ReplyDraft | null;
  onCancelReply: () => void;
  onSend: (text: string, pendingImage?: PendingImage, mentions?: MessageMention[]) => void;
  onTypingChange: (text: string) => void;
  disabled?: boolean;
  /** Populated by the parent so a send failure shows inside the composer, as on web. */
  error?: string | null;
  /** Shared bottom-dock layout owner created by the community screen. */
  imeLayout: ChatImeLayout;
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
  imeLayout,
}: Props) {
  const colors = useColors();
  const [text, setText] = useState('');
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const inputRef = useRef<TextInput>(null);
  const focusRequestIdRef = useRef(0);
  /** Caret/selection as last reported by the field — emoji insert here. */
  const selectionRef = useRef({ start: 0, end: 0 });

  // Starting a reply (sheet, swipe, or chip tap) drops the caret straight into
  // the composer so the keyboard opens on the action, as WhatsApp does.
  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  const pickerOpen = imeLayout.panelOpen;

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

  // The quote wears the replied author's chat name color — same deterministic
  // palette as the sender names inside bubbles, including your own message.
  const replyColor = !replyTo
    ? colors.accent
    : userNameColor(replyTo.user_id, colors);

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
    imeLayout.closePanel();
    onTypingChange('');
    resetMentions();
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
    // Invalidate any focus scheduled by a keyboard tap earlier in this
    // transition. Otherwise that stale RAF can reopen the IME after this panel.
    focusRequestIdRef.current += 1;
    imeLayout.openEmojiPanel();
  }

  /**
   * Emoji button — the panel and the keyboard take turns in the same space,
   * the way WhatsApp does it. Opening the panel dismisses the IME; the button
   * then wears a keyboard glyph, and tapping it (or the field) brings the IME
   * back and puts the panel away.
   */
  function togglePicker() {
    if (imeLayout.panelOpenRef.current) {
      requestKeyboard();
    } else {
      openEmojiPanel();
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
    // Insert at the caret (not the end) so emoji can be placed between
    // sentences; the panel stays open for several picks in a row.
    const from = Math.min(selectionRef.current.start, text.length);
    const to = Math.min(Math.max(selectionRef.current.end, from), text.length);
    const next = text.slice(0, from) + emoji + text.slice(to);
    const caret = from + emoji.length;
    selectionRef.current = { start: caret, end: caret };
    setText(next);
    onTypingChange(next);
    onComposerActivity(next, caret);
    requestAnimationFrame(() => inputRef.current?.setSelection(caret, caret));
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
      {/* The panel is a sibling of this stack, not a child of it, on purpose:
          it stays mounted at zero height while the keyboard is up, and a 6pt
          gap around a zero-height panel would show up as extra dead space
          under the composer. Its gap travels inside its animated space
          instead (see useChatImeLayout). */}
      <View style={styles.stack} onLayout={imeLayout.onComposerStackLayout}>
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
                  { backgroundColor: colors.background },
                ]}
              >
                <View style={[styles.replyBar, { backgroundColor: replyColor }]} />
                <View style={styles.replyInfo}>
                  <Text numberOfLines={1} style={[styles.replyName, { color: replyColor }]}>
                    {replyTo.content_kind
                      ? `Replying to ${replyTo.user_name}'s ${replyTo.content_kind}`
                      : replyTo.user_name}
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
                hitSlop={5}
                accessibilityLabel={pickerOpen ? 'Show keyboard' : 'Open emoji picker'}
                style={({ pressed }) => [
                  styles.pillBtn,
                  { backgroundColor: pressed ? colors.surfaceHover : 'transparent' },
                ]}
              >
                {pickerOpen ? (
                  <MaterialCommunityIcons
                    name="keyboard-outline"
                    size={22}
                    color={colors.mutedForeground}
                  />
                ) : (
                  <Feather name="smile" size={22} color={colors.mutedForeground} />
                )}
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
                  if (imeLayout.panelOpenRef.current) requestKeyboard();
                  handleChangeText(v);
                }}
                // The panel dismisses the IME rather than suppressing it, so the
                // field stays plain: a tap focuses it and the keyboard comes up
                // in the same gesture, replacing the panel.
                onPressIn={() => requestKeyboard()}
                onSelectionChange={(e) => {
                  selectionRef.current = e.nativeEvent.selection;
                  onComposerActivity(text, e.nativeEvent.selection.end);
                }}
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
                style={({ pressed }) => [
                  styles.pillBtn,
                  { backgroundColor: pressed ? colors.surfaceHover : 'transparent' },
                ]}
              >
                <Feather
                  name="image"
                  size={21}
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
              <SendPlaneIcon color={canSend ? '#FFFFFF' : colors.mutedForeground} size={22} />
            )}
          </Pressable>
        </View>
      </View>

      {/* Keep one clipped panel mounted so the same dock can hand its space to
          the system IME without mounting or removing children mid-swap. */}
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
  root: {
    paddingHorizontal: 12,
    paddingTop: 2,
    position: 'relative',
    overflow: 'visible',
  },

/** Everything above the panel: reply/error/mention/composer rows. */
  stack: {
    gap: 6,
    // The 8 dp strip lives *between* the composer and whatever is under it
    // (the panel, or nothing when the panel is shut), never below the panel —
    // that keeps the pill the same distance from the panel as from the
    // keyboard and puts the panel's top edge exactly on the keyboard's.
    marginBottom: CHAT_COMPOSER_BOTTOM_INSET,
  },

  box: {
    flex: 1,
    borderRadius: 22,
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
    paddingVertical: 5,
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
    borderRadius: 22,
    marginTop: 4,
    marginBottom: 2,
    marginHorizontal: 6,
    paddingRight: 6,
    gap: 8,
    overflow: 'hidden',
  },
  /** WhatsApp's accent — a full-height square bar, clipped into the chip's
   *  corners by the overflow above (their exact DOM pattern). */
  replyBar: { alignSelf: 'stretch', width: 3, flexShrink: 0 },
  replyInfo: { flex: 1, minWidth: 0, gap: 2, paddingVertical: 6 },
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
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  textInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 15.5,
    lineHeight: 24,
    fontFamily: 'Geist_500Medium',
    maxHeight: 120,
    paddingTop: 7,
    paddingBottom: 7,
    paddingHorizontal: 4,
    backgroundColor: 'transparent',
    includeFontPadding: false,
  },

  counter: { fontSize: 10, fontFamily: 'Geist_400Regular', marginBottom: 10, flexShrink: 0 },

  sendBtn: {
    // Keeps the send circle aligned with the pill's bottom edge.
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  errorText: { fontSize: 12, fontFamily: 'Geist_400Regular', paddingLeft: 4 },
  limitError: { fontSize: 11, fontFamily: 'Geist_400Regular', paddingHorizontal: 8, paddingBottom: 6 },
});
