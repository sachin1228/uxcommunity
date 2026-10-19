import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';
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
 *
 * The panel itself is always this tall; what moves is the `animatedStyle`
 * space around it, which the composer animates in step with the IME (see
 * `useEmojiKeyboardSwap`). Growing that space clips the block from the bottom
 * up, so the panel rises out of the edge the way the keyboard does — and the
 * composer above it keeps still while the two trade places.
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
  /** The panel's full height — the height the IME takes on this screen, so the
   *  two are the same size when they trade places. */
  height?: number;
  /** The animated space around the panel (see `useEmojiKeyboardSwap`). */
  animatedStyle?: AnimatedStyle<ViewStyle>;
  /**
   * Whether to render the emoji grid. The panel's space stays mounted (at zero
   * height while shut) so opening it can never race the IME's own animation,
   * and the grid follows `open` — off while the panel is shut, so typing does
   * not pay for a couple of hundred emoji cells that nobody can see.
   */
  showContent?: boolean;
}

export function EmojiPicker({
  onSelect,
  height = styles.panel.height,
  animatedStyle,
  showContent = true,
}: Props) {
  const colors = useColors();

  return (
    <Animated.View style={[styles.clip, animatedStyle]}>
      {/* The space below the chat already stops at the safe area — the screen
          renders a spacer under it — so the panel needs no bottom padding of
          its own. */}
      <View style={[styles.panel, { height, backgroundColor: colors.background }]}>
        {showContent && (
          <>
            {/* No drag handle: the panel is not a sheet — it takes the
                keyboard's place and starts where the keyboard starts, so a
                handle would push the first row of emoji down out of step with
                the first row of keys. */}
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
          </>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /** The animated space the panel occupies — it starts at zero height while the
   *  keyboard still owns the strip, hence the clipping. The space is exactly the
   *  panel's height, and the composer's own bottom padding above it supplies the
   *  gap, so a shut panel adds nothing under the composer. */
  clip: { overflow: 'hidden' },
  /** No top border: the panel is a continuation of the chat, not a sheet over
   *  it — a hairline here would draw the one line the keyboard does not have. */
  panel: { height: 320 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Geist_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    // Tight, so the first emoji row lands on the keyboard's own first row
    // instead of a header's worth of black below the composer.
    marginTop: 8,
    marginBottom: 4,
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
