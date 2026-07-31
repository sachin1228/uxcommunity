import React from 'react';
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Message } from '@/lib/communities';

const COMMON_EMOJIS = ['❤️', '👍', '👎', '😮', '🔥', '😂', '🎉', '👏', '💯', '✅'];

interface Props {
  message: Message | null;
  isOwn: boolean;
  onClose: () => void;
  onReact: (messageId: string, emoji: string) => void;
  onReply: (message: Message) => void;
  onDelete: (messageId: string) => void;
}

export function EmojiPicker({ message, isOwn, onClose, onReact, onReply, onDelete }: Props) {
  const colors = useColors();

  if (!message) return null;

  const isDeleted = !!message.deleted_at;
  const canReact = !isDeleted;
  const canReply = !isDeleted;
  const canDelete = isOwn && !isDeleted;

  function handleDelete() {
    if (!message) return;
    onClose();
    // Small delay so the modal closes first, then show the native alert
    setTimeout(() => {
      Alert.alert(
        'Delete message?',
        'This will delete the message for everyone in this chat.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete for everyone',
            style: 'destructive',
            onPress: () => onDelete(message.id),
          },
        ]
      );
    }, 200);
  }

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
          {/* Emoji row — only for non-deleted messages */}
          {canReact && (
            <>
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
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
            </>
          )}

          {/* Reply */}
          {canReply && (
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
          )}

          {/* Delete — own messages only */}
          {canDelete && (
            <>
              {canReply && (
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
              )}
              <Pressable
                style={({ pressed }) => [
                  styles.action,
                  { backgroundColor: pressed ? 'rgba(239,68,68,0.08)' : 'transparent' },
                ]}
                onPress={handleDelete}
              >
                <Text style={[styles.actionText, { color: colors.destructive }]}>
                  🗑 Delete
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 12,
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
    marginHorizontal: 0,
  },
  action: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  actionText: {
    fontSize: 15,
    fontFamily: 'Geist_500Medium',
  },
});
