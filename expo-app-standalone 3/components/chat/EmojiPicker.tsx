import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

/**
 * Composer emoji picker — the React Native counterpart of the web
 * `EmojiGifPicker` tab, reduced to emoji.
 *
 * Unlike a modal, the panel renders inline directly below the composer
 * (WhatsApp-style): the input stays visible and usable above it, the panel
 * runs edge-to-edge to the bottom of the screen, and the parent decides when
 * it closes (tapping the input again, sending, or scrolling the chat).
 * Tapping an emoji inserts it at the end of the draft and keeps the panel
 * open so several can be picked in a row (same behaviour as the web composer).
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
}

export function EmojiPicker({ onSelect }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.panel,
        {
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
