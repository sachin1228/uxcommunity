import React, { useState } from 'react';
import {
  Clipboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { Message } from '@/lib/communities';
import { canEditMessage } from '@/lib/chat';

/**
 * The five quick reactions, in the same order and with the same active-state
 * treatment as the web `REACTIONS` list in MessageBubble.tsx.
 */
export const CHAT_REACTIONS: Array<{ emoji: string; label: string; bg: string }> = [
  { emoji: '❤️', label: 'Love', bg: '#EF4444' },
  { emoji: '👍', label: 'Like', bg: '#22C55E' },
  { emoji: '👎', label: 'Dislike', bg: '#F97316' },
  { emoji: '😮', label: 'Wow', bg: '#A855F7' },
  { emoji: '🔥', label: 'Fire', bg: '#3B82F6' },
];

interface Props {
  message: Message | null;
  currentUserId: string;
  /** Manager with `can_delete_messages` may delete other members' messages. */
  canModerate?: boolean;
  onClose: () => void;
  onReact: (messageId: string, emoji: string) => void;
  onReply: (message: Message) => void;
  onCopy: (message: Message) => void;
  onEdit: (message: Message) => void;
  onDelete: (messageId: string) => void;
}

/**
 * Long-press action sheet — the touch equivalent of the web message menu.
 *
 * Web shows hover buttons plus a dropdown (Reply / Copy / Edit / Delete) and a
 * five-emoji picker on desktop, and falls back to the same dropdown on touch.
 * Mobile reaches all of it from one sheet so the feature set is identical.
 */
export function MessageActionsSheet({
  message,
  currentUserId,
  canModerate = false,
  onClose,
  onReact,
  onReply,
  onCopy,
  onEdit,
  onDelete,
}: Props) {
  const colors = useColors();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const close = () => {
    setConfirmingDelete(false);
    onClose();
  };

  if (!message) return null;

  const isOwn = message.user_id === currentUserId;
  const isDeleted = !!message.deleted_at;
  const hasText = !!message.content;
  // Web only offers Edit on your own text message inside the 15-minute window.
  const editAvailable = isOwn && hasText && !isDeleted && canEditMessage(message.created_at);
  // Copy is offered for any message that still has text (mirrors web `canCopy`).
  const canCopy = hasText && !isDeleted;
  const canDelete = !isDeleted && (isOwn || canModerate);
  const canReply = !isDeleted;

  const myEmoji = message.reactions?.find((r) => r.user_ids.includes(currentUserId))?.emoji;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          {confirmingDelete ? (
            /* ── Delete confirmation — same copy as the web dialog ── */
            <View>
              <View style={[styles.confirmHeader, { borderBottomColor: colors.border }]}>
                <Text style={[styles.confirmTitle, { color: colors.foreground }]}>Delete message?</Text>
                <Text style={[styles.confirmBody, { color: colors.mutedForeground }]}>
                  This will delete the message for everyone in this chat.
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  const id = message.id;
                  setConfirmingDelete(false);
                  onClose();
                  onDelete(id);
                }}
                style={({ pressed }) => [
                  styles.confirmAction,
                  { backgroundColor: pressed ? colors.destructive + '1A' : 'transparent' },
                ]}
              >
                <Text style={[styles.confirmActionText, { color: colors.destructive }]}>
                  Delete for everyone
                </Text>
              </Pressable>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <Pressable
                onPress={() => setConfirmingDelete(false)}
                style={({ pressed }) => [
                  styles.confirmAction,
                  { backgroundColor: pressed ? colors.subtle : 'transparent' },
                ]}
              >
                <Text style={[styles.confirmActionText, { color: colors.mutedForeground }]}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView
              bounces={false}
              contentContainerStyle={styles.sheetContent}
              showsVerticalScrollIndicator={false}
            >
              {/* ── Quick reactions ── */}
              {!isDeleted && (
                <View style={[styles.reactionRow, { borderBottomColor: colors.border }]}>
                  {CHAT_REACTIONS.map(({ emoji, label, bg }) => {
                    const isActive = myEmoji === emoji;
                    return (
                      <Pressable
                        key={label}
                        accessibilityLabel={`${isActive ? 'Remove' : 'Add'} ${label} reaction`}
                        onPress={() => {
                          onReact(message.id, emoji);
                          close();
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
              )}

              {/* ── Reply ── */}
              {canReply && (
                <ActionRow
                  icon={<Feather name="corner-up-left" size={16} color={colors.mutedForeground} />}
                  label="Reply"
                  color={colors.foreground}
                  onPress={() => {
                    close();
                    onReply(message);
                  }}
                />
              )}

              {/* ── Copy ── */}
              {canCopy && (
                <ActionRow
                  icon={<Feather name="copy" size={16} color={colors.mutedForeground} />}
                  label="Copy"
                  color={colors.foreground}
                  onPress={() => {
                    Clipboard.setString(message.content ?? '');
                    close();
                    onCopy(message);
                  }}
                />
              )}

              {/* ── Edit (own text message, 15-minute window) ── */}
              {editAvailable && (
                <ActionRow
                  icon={<Feather name="edit-2" size={16} color={colors.mutedForeground} />}
                  label="Edit"
                  color={colors.foreground}
                  onPress={() => {
                    close();
                    onEdit(message);
                  }}
                />
              )}

              {/* ── Delete ── */}
              {canDelete && (
                <>
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <ActionRow
                    icon={<Feather name="trash-2" size={16} color={colors.destructive} />}
                    label={isOwn ? 'Delete' : 'Delete for everyone'}
                    color={colors.destructive}
                    onPress={() => setConfirmingDelete(true)}
                  />
                </>
              )}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ActionRow({
  icon,
  label,
  color,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  color: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="menuitem"
      style={({ pressed }) => [
        styles.actionRow,
        { backgroundColor: pressed ? colors.subtle : 'transparent' },
      ]}
    >
      {icon}
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
    </Pressable>
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
  sheetContent: { paddingBottom: 4 },

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

  divider: { height: StyleSheet.hairlineWidth },

  confirmHeader: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  confirmTitle: { fontSize: 16, fontFamily: 'Geist_600SemiBold' },
  confirmBody: {
    fontSize: 12,
    fontFamily: 'Geist_400Regular',
    textAlign: 'center',
    marginTop: 4,
  },
  confirmAction: { paddingHorizontal: 20, paddingVertical: 15, alignItems: 'center' },
  confirmActionText: { fontSize: 14, fontFamily: 'Geist_600SemiBold' },
});
