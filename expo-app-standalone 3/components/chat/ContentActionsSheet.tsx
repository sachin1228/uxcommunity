import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import type { ChatContentEvent } from '@/lib/chatContentEvents';
import { CHAT_REACTIONS } from './MessageActionsSheet';
import { hapticSelection } from '@/lib/haptics';

interface Props {
  event: ChatContentEvent | null;
  currentUserId: string;
  onClose: () => void;
  /** Toggle/replace the current user's emoji reaction on the card. */
  onReact: (event: ChatContentEvent, emoji: string) => void;
  /** Open the composer with the card as the reply anchor. */
  onReply: (event: ChatContentEvent) => void;
}

/**
 * Long-press action sheet for a chat timeline "created a …" card — the touch
 * equivalent of the web card's hover actions (NotificationHoverActions):
 * the five-emoji reaction picker and Reply, and nothing else. The underlying
 * content is managed in its own tab, so there is no delete/edit here.
 */
export function ContentActionsSheet({
  event,
  currentUserId,
  onClose,
  onReact,
  onReply,
}: Props) {
  const colors = useColors();

  if (!event) return null;

  const myEmoji = event.reactions
    ?.find((reaction) => reaction.user_ids.includes(currentUserId))?.emoji;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          {/* ── Quick reactions (web NOTIFICATION_REACTIONS set) ── */}
          <View style={[styles.reactionRow, { borderBottomColor: colors.border }]}>
            {CHAT_REACTIONS.map(({ emoji, label, bg }) => {
              const isActive = myEmoji === emoji;
              return (
                <Pressable
                  key={label}
                  accessibilityLabel={`${isActive ? 'Remove' : 'Add'} ${label} reaction`}
                  onPress={() => {
                    // Reacting and un-reacting are different gestures to the
                    // hand: the handler ticks by direction, so the tile itself
                    // does not, exactly like the message sheet's tiles.
                    onReact(event, emoji);
                    onClose();
                  }}
                  style={({ pressed }) => [
                    styles.reactionBtn,
                    {
                      backgroundColor: isActive ? bg : colors.subtle,
                      borderColor: isActive ? colors.foreground + '66' : 'transparent',
                      transform: [{ scale: pressed ? 0.9 : 1 }],
                    },
                  ]}
                >
                  <Text style={styles.reactionEmoji}>{emoji}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* ── Reply ── */}
          <Pressable
            onPress={() => {
              hapticSelection();
              onClose();
              onReply(event);
            }}
            accessibilityRole="menuitem"
            style={({ pressed }) => [
              styles.actionRow,
              { backgroundColor: pressed ? colors.subtle : 'transparent' },
            ]}
          >
            <Feather name="corner-up-left" size={16} color={colors.mutedForeground} />
            <Text style={[styles.actionLabel, { color: colors.foreground }]}>Reply</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingBottom: 8,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -4 },
    elevation: 16,
  },

  reactionRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  reactionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  reactionEmoji: { fontSize: 22 },

  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  actionLabel: { fontSize: 15, fontFamily: 'Geist_500Medium' },
});
