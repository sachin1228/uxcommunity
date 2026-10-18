import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

/**
 * Composer emoji picker — the React Native counterpart of the web
 * `EmojiGifPicker` tab, reduced to emoji.
 *
 * Unlike a modal, the panel renders inline directly below the composer
 * (WhatsApp-style). It takes the keyboard's place rather than sharing the
 * screen with it: the composer dismisses the IME when the panel opens, and
 * the emoji button becomes a keyboard button to bring it back. The parent
 * decides when the panel closes (tapping the field, the keyboard button,
 * sending, or scrolling the chat), and tapping an emoji inserts it at the
 * caret while keeping the panel open for several picks in a row.
 */

const EMOJI_SECTIONS: Array<{ title: string; emoji: string[] }> = [
  {
    title: 'Smileys',
    emoji: [
      '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
      '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚',
      '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥳',
      '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '😣', '😖', '😫',
      '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳',
      '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭',
      '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😴', '🤤',
    ],
  },
  {
    title: 'Gestures',
    emoji: [
      '👍', '👎', '👌', '🤌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈',
      '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐️', '🖖', '👋', '🤝',
      '🙏', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '💪',
    ],
  },
  {
    title: 'Hearts & symbols',
    emoji: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
      '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '✨', '🔥',
      '⭐', '🌟', '💯', '✅', '❌', '⚠️', '🎉', '🎊', '🎈', '🏆',
      '🥇', '👑', '💡', '🚀', '⚡', '💎', '📌', '📎', '🔗', '🕐',
    ],
  },
  {
    title: 'Work & design',
    emoji: [
      '💻', '🖥️', '⌨️', '🖱️', '🎨', '🖌️', '🖍️', '📐', '📏', '✏️',
      '📝', '📄', '📁', '📊', '📈', '📉', '🗂️', '🧠', '🧩', '🔍',
      '🛠️', '⚙️', '🧑‍💻', '👩‍💻', '👨‍💻', '🧑‍🎨', '👩‍🎨', '👨‍🎨', '📱', '🕹️',
    ],
  },
];

interface Props {
  /** Called with the tapped emoji. The chat screen mounts the panel without
   *  a handler (ChatInput wires the insertion), so it is optional. */
  onSelect?: (emoji: string) => void;
  /** The height the IME last took up on this screen. The panel claims exactly
   *  that much, so swapping one for the other moves nothing above it; the
   *  320dp default covers the very first open, before the IME has been seen. */
  keyboardHeight?: number;
}

export function EmojiPicker({ onSelect, keyboardHeight = 0 }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.panel,
        {
          height: keyboardHeight || styles.panel.height,
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      {/* Drag handle — decorative, like the WhatsApp sticker drawer */}
      <View style={[styles.handle, { backgroundColor: colors.border }]} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {EMOJI_SECTIONS.map((section) => (
          <View key={section.title}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
              {section.title}
            </Text>
            <View style={styles.grid}>
              {section.emoji.map((emoji) => (
                <Pressable
                  key={emoji}
                  onPress={() => onSelect?.(emoji)}
                  style={({ pressed }) => [
                    styles.emojiCell,
                    { backgroundColor: pressed ? colors.subtle : 'transparent' },
                  ]}
                >
                  <Text style={styles.emoji}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    height: 320,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginTop: 8,
    marginBottom: 4,
  },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Geist_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 12,
    marginBottom: 6,
    marginLeft: 4,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  emojiCell: {
    width: '12.5%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  emoji: { fontSize: 24 },
});
