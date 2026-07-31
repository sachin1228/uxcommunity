import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Message } from '@/lib/communities';

const COMMON_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👏', '💯', '✅'];

interface Props {
  message: Message | null;
  onClose: () => void;
  onReact: (messageId: string, emoji: string) => void;
  onReply: (message: Message) => void;
}

export function EmojiPicker({ message, onClose, onReact, onReply }: Props) {
  const colors = useColors();

  if (!message) return null;

  return (
    <Modal
      transparent
      animationType="fade"
      visible={!!message}
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {/* Emoji row */}
          <View style={styles.emojiRow}>
            {COMMON_EMOJIS.map((emoji) => (
              <Pressable
                key={emoji}
                style={({ pressed }) => [
                  styles.emojiBtn,
                  { backgroundColor: pressed ? colors.subtle : 'transparent' },
                ]}
                onPress={() => {
                  onReact(message.id, emoji);
                  onClose();
                }}
              >
                <Text style={styles.emoji}>{emoji}</Text>
              </Pressable>
            ))}
          </View>

          {/* Divider */}
          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          {/* Actions */}
          <Pressable
            style={({ pressed }) => [
              styles.action,
              { backgroundColor: pressed ? colors.subtle : 'transparent' },
            ]}
            onPress={() => {
              onReply(message);
              onClose();
            }}
          >
            <Text style={[styles.actionText, { color: colors.foreground }]}>↩ Reply</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  emojiRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 12,
    gap: 4,
  },
  emojiBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 26,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 12,
  },
  action: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  actionText: {
    fontSize: 15,
    fontFamily: 'Geist_500Medium',
  },
});
