import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
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
 * The panel itself is always this tall. Its animated wrapper is absolutely
 * positioned immediately below the fixed-height composer, so growing the
 * panel never changes the dock's measured height or moves the composer.
 */

const EMOJI_COLUMNS = 8;
const EMOJI_GRID_PADDING = 16;

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
  /** The animated space around the panel (see `useChatImeLayout`). */
  animatedStyle?: AnimatedStyle<ViewStyle>;
  /**
   * Whether to render the emoji grid. The panel's space is mounted as soon as
   * a keyboard appears (at zero height) so opening it can never race the IME,
   * and the grid follows `open` — off while the panel is shut, so typing does
   * not pay for a couple of hundred emoji cells that nobody can see.
   */
  showContent?: boolean;
  /** Ignore presses until the panel has finished opening. */
  interactive?: boolean;
  /**
   * `screen` anchors to the bottom edge of the mount's parent (chat screens
   * mount it at dock level so Android can hit-test it). `inline` hangs the
   * panel directly below its parent, for composers inside scrolling sheets.
   */
  placement?: 'screen' | 'inline';
}

export function EmojiPicker({
  onSelect,
  height = styles.panel.height,
  animatedStyle,
  showContent = true,
  interactive = true,
  placement = 'screen',
}: Props) {
  const colors = useColors();
  const [panelWidth, setPanelWidth] = useState(0);
  const panelCornerRadius = Math.min(32, panelWidth / 2, height / 2);
  // Explicit square cells: a percentage width with aspectRatio was resolving
  // the height from the glyph's line box, leaving wide, short press targets
  // whose emoji did not look centred.
  const emojiCellSize =
    panelWidth > 0 ? (panelWidth - EMOJI_GRID_PADDING * 2) / EMOJI_COLUMNS : 0;

  return (
    <Animated.View
      pointerEvents={interactive ? 'auto' : 'none'}
      style={[styles.clip, placement === 'screen' ? styles.anchorBottom : styles.belowComposer, animatedStyle]}
    >
      {/* The space below the chat already stops at the safe area — the screen
          renders a spacer under it — so the panel needs no bottom padding of
          its own. */}
      <View
        onLayout={({ nativeEvent: { layout } }) => setPanelWidth(layout.width)}
        style={[
          styles.panel,
          {
            height,
          },
        ]}
      >
        {panelWidth > 0 && height > 0 && (
          <Svg
            pointerEvents="none"
            width={panelWidth}
            height={height}
            viewBox={`0 0 ${panelWidth} ${height}`}
            style={styles.panelBackground}
          >
            <Path
              d={`M 0 ${panelCornerRadius} A ${panelCornerRadius} ${panelCornerRadius} 0 0 1 ${panelCornerRadius} 0 H ${panelWidth - panelCornerRadius} A ${panelCornerRadius} ${panelCornerRadius} 0 0 1 ${panelWidth} ${panelCornerRadius} V ${height} H 0 Z`}
              fill={colors.card}
            />
          </Svg>
        )}
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
                          emojiCellSize > 0 && { width: emojiCellSize, height: emojiCellSize },
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
   *  keyboard still owns the strip, then grows upward from the screen's bottom
   *  edge to the keyboard's height. */
  clip: { overflow: 'hidden' },
  /** Anchored to the bottom of the screen-level dock area rather than inside
   *  the composer: a child laid out below its parent's native bounds never
   *  receives touches on Android, which makes the panel unable to scroll. */
  anchorBottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  belowComposer: { position: 'absolute', left: -8, right: -8, top: '100%' },
  panel: { height: 320, position: 'relative' },
  panelBackground: { position: 'absolute', top: 0, left: 0 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: EMOJI_GRID_PADDING, paddingBottom: 24 },
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
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  emoji: {
    fontSize: 24,
    lineHeight: 30,
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
});
