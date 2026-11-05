import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

/**
 * The member profile's ⋯ menu — the mobile reading of the web ProfileCard
 * block menu: Block user and Report user, or the way back once blocked.
 */

interface Props {
  visible: boolean;
  blockedByMe: boolean;
  busy: boolean;
  onClose: () => void;
  onReport: () => void;
  onBlock: () => void;
  onUnblock: () => void;
}

export function MemberOptionsSheet({
  visible,
  blockedByMe,
  busy,
  onClose,
  onReport,
  onBlock,
  onUnblock,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
          onPress={(event) => event.stopPropagation()}
        >
          {blockedByMe ? (
            <Pressable
              onPress={onUnblock}
              disabled={busy}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: colors.surfaceRaised },
              ]}
            >
              <Feather name="shield-off" size={16} color={colors.mutedForeground} />
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>
                {busy ? 'Unblocking…' : 'Unblock user'}
              </Text>
            </Pressable>
          ) : (
            <>
              <Pressable
                onPress={onBlock}
                disabled={busy}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.row,
                  pressed && { backgroundColor: colors.destructive + '14' },
                ]}
              >
                <Feather name="slash" size={16} color={colors.destructive} />
                <Text style={[styles.rowLabel, { color: colors.destructive }]}>
                  {busy ? 'Blocking…' : 'Block user'}
                </Text>
              </Pressable>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <Pressable
                onPress={onReport}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.row,
                  pressed && { backgroundColor: colors.surfaceRaised },
                ]}
              >
                <Feather name="flag" size={16} color={colors.mutedForeground} />
                <Text style={[styles.rowLabel, { color: colors.foreground }]}>Report user</Text>
              </Pressable>
            </>
          )}
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
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  rowLabel: { fontFamily: 'Geist_500Medium', fontSize: 14.5 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
});
