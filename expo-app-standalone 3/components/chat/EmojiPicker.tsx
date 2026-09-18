import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

/**
 * Composer emoji picker — the React Native counterpart of the web
 * `EmojiGifPicker` tab, reduced to emoji. Tapping an emoji inserts it at the
 * end of the draft and keeps the sheet open so several can be picked in a row
 * (same behaviour as the web composer).
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
  visible: boolean;
  onClose: () => void;
  onSelect: (emoji: string) => void;
}

export function EmojiPicker({ visible, onClose, onSelect }: Props) {
  const colors = useColors();

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={(e) => e.stopPropagation()}
        >
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
                      onPress={() => onSelect(emoji)}
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
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    height: 340,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -4 },
    elevation: 16,
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
