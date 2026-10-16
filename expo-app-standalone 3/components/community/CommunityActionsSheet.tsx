import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { hapticSelection } from '@/lib/haptics';

/**
 * The ⋯ options sheet of the chat header — the touch version of the web
 * header's dropdown, with the same two actions and the same confirm copy:
 *
 *   Delete chat      — removes the chat from your own list only
 *   Exit community   — removes your membership (the more destructive action,
 *                      so it sits last)
 *
 * Both confirms render in-sheet (like the message action sheet) so the touch
 * vocabulary inside chat stays one thing. The parent's `onConfirm` rejects on
 * failure — the sheet then stays open with its busy state cleared and the
 * parent raises the error toast.
 */

export type CommunityConfirmAction = 'delete' | 'leave';

const CONFIRM_COPY: Record<
  CommunityConfirmAction,
  { title: string; body: string; cta: string }
> = {
  delete: {
    title: 'Delete chat?',
    body: "This removes the chat from your sidebar. Other members won't be affected, and it'll reappear when a new message arrives.",
    cta: 'Delete chat',
  },
  leave: {
    title: 'Exit community?',
    body: "You'll no longer be able to view or send messages here.",
    cta: 'Exit',
  },
};

interface Props {
  open: boolean;
  onClose: () => void;
  /** Runs the action; must reject when the server refuses, so the sheet stays up. */
  onConfirm: (action: CommunityConfirmAction) => Promise<void>;
}

export function CommunityActionsSheet({ open, onClose, onConfirm }: Props) {
  const colors = useColors();
  const [confirming, setConfirming] = useState<CommunityConfirmAction | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    if (busy) return;
    setConfirming(null);
    onClose();
  };

  const run = async (action: CommunityConfirmAction) => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm(action);
      // Success navigates away — the sheet unmounts with the screen.
    } catch {
      // The parent raised the error toast; hand the sheet back to the user.
      setBusy(false);
    }
  };

  return (
    <Modal transparent animationType="fade" visible={open} onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          {confirming ? (
            /* ── Confirmation — the same copy as the web dialog ── */
            <View>
              <View style={[styles.confirmHeader, { borderBottomColor: colors.border }]}>
                <Text style={[styles.confirmTitle, { color: colors.foreground }]}>
                  {CONFIRM_COPY[confirming].title}
                </Text>
                <Text style={[styles.confirmBody, { color: colors.mutedForeground }]}>
                  {CONFIRM_COPY[confirming].body}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  hapticSelection();
                  void run(confirming);
                }}
                disabled={busy}
                accessibilityRole="menuitem"
                style={({ pressed }) => [
                  styles.confirmAction,
                  {
                    backgroundColor: pressed ? colors.destructive + '1A' : 'transparent',
                    opacity: busy ? 0.5 : 1,
                  },
                ]}
              >
                <View style={styles.confirmCtaRow}>
                  {busy ? (
                    <ActivityIndicator size="small" color={colors.destructive} />
                  ) : null}
                  <Text style={[styles.confirmActionText, { color: colors.destructive }]}>
                    {CONFIRM_COPY[confirming].cta}
                  </Text>
                </View>
              </Pressable>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <Pressable
                onPress={() => setConfirming(null)}
                disabled={busy}
                accessibilityRole="menuitem"
                style={({ pressed }) => [
                  styles.confirmAction,
                  { backgroundColor: pressed ? colors.subtle : 'transparent' },
                ]}
              >
                <Text style={[styles.confirmActionText, { color: colors.mutedForeground }]}>
                  Cancel
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.menu}>
              <MenuItem
                icon="trash-2"
                label="Delete chat"
                onPress={() => setConfirming('delete')}
              />
              {/* Most destructive last: exiting removes membership, deleting
                  only hides the chat from your list. */}
              <MenuItem
                icon="log-out"
                label="Exit community"
                onPress={() => setConfirming('leave')}
              />
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MenuItem({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={() => {
        hapticSelection();
        onPress();
      }}
      accessibilityRole="menuitem"
      style={({ pressed }) => [
        styles.menuRow,
        { backgroundColor: pressed ? colors.destructive + '14' : 'transparent' },
      ]}
    >
      <Feather name={icon} size={16} strokeWidth={2.5} color={colors.destructive} />
      <Text style={[styles.menuLabel, { color: colors.destructive }]}>{label}</Text>
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
    paddingVertical: 8,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -4 },
    elevation: 16,
  },
  menu: { paddingVertical: 0 },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  menuLabel: { fontSize: 15, fontFamily: 'Geist_500Medium' },
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
    lineHeight: 17,
  },
  confirmAction: { paddingHorizontal: 20, paddingVertical: 15, alignItems: 'center' },
  confirmCtaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  confirmActionText: { fontSize: 14, fontFamily: 'Geist_600SemiBold' },
  divider: { height: StyleSheet.hairlineWidth },
});
