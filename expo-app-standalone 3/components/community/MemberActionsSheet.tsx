import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { hapticSelection } from '@/lib/haptics';
import type { CommunityMemberRow } from '@/lib/communities';

/**
 * The Members tab's per-row menu — the touch reading of the web row dropdown:
 * Make moderator / Moderator permissions / Dismiss as moderator, then Remove
 * from community. Removal confirms inside the card, like the ⋯ menu's
 * destructive actions, so one surface owns the whole flow.
 */
interface Props {
  member: CommunityMemberRow | null;
  /** Manager holding member-management rights (or the owner). */
  canRemove: boolean;
  /** Manager tier (owner / admin) — appoints, edits and dismisses moderators. */
  canModerate: boolean;
  /** A write is in flight for this member. */
  busy: boolean;
  onClose: () => void;
  onMakeModerator: () => void;
  onEditPermissions: () => void;
  onDismissModerator: () => void;
  onRemove: () => void;
}

export function MemberActionsSheet({
  member,
  canRemove,
  canModerate,
  busy,
  onClose,
  onMakeModerator,
  onEditPermissions,
  onDismissModerator,
  onRemove,
}: Props) {
  const colors = useColors();
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  useEffect(() => {
    if (member) setConfirmingRemove(false);
  }, [member?.user_id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!member) return null;

  const isModerator = member.role === 'moderator';
  const firstName = member.name.split(' ')[0] || member.name;

  const run = (action: () => void) => {
    if (busy) return;
    hapticSelection();
    action();
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={busy ? undefined : onClose}>
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose}>
        <Pressable
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          {confirmingRemove ? (
            <View style={styles.confirmBody}>
              <Text style={[styles.title, styles.centerText, { color: colors.foreground }]}>
                Remove {firstName}?
              </Text>
              <Text style={[styles.confirmCopy, { color: colors.mutedForeground }]}>
                {member.name} will lose access to this community. They can request to join again
                {''} later.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => run(onRemove)}
                disabled={busy}
                style={({ pressed }) => [
                  styles.confirmAction,
                  {
                    backgroundColor: pressed ? colors.destructive + '2A' : colors.destructive + '14',
                    opacity: busy ? 0.6 : 1,
                  },
                ]}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={colors.destructive} />
                ) : (
                  <Text style={[styles.destructiveText, { color: colors.destructive }]}>
                    Remove from community
                  </Text>
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setConfirmingRemove(false)}
                disabled={busy}
                style={({ pressed }) => [
                  styles.secondaryAction,
                  { backgroundColor: pressed ? colors.surfaceRaised : 'transparent' },
                ]}
              >
                <Text style={[styles.secondaryText, { color: colors.mutedForeground }]}>
                  Cancel
                </Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
                {member.name}
              </Text>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              {canModerate && !isModerator && (
                <SheetRow
                  icon="shield"
                  label="Make moderator"
                  onPress={() => run(onMakeModerator)}
                  disabled={busy}
                />
              )}
              {canModerate && isModerator && (
                <>
                  <SheetRow
                    icon="sliders"
                    label="Moderator permissions"
                    onPress={() => run(onEditPermissions)}
                    disabled={busy}
                  />
                  <SheetRow
                    icon="shield-off"
                    label="Dismiss as moderator"
                    onPress={() => run(onDismissModerator)}
                    disabled={busy}
                  />
                </>
              )}
              {canRemove && (
                <>
                  {canModerate && (
                    <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  )}
                  <SheetRow
                    destructive
                    icon="user-x"
                    label="Remove from community"
                    onPress={() => {
                      hapticSelection();
                      setConfirmingRemove(true);
                    }}
                    disabled={busy}
                  />
                </>
              )}
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SheetRow({
  icon,
  label,
  destructive,
  disabled,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="menuitem"
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed
            ? destructive
              ? colors.destructive + '14'
              : colors.subtle
            : 'transparent',
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Feather
        name={icon}
        size={16}
        strokeWidth={2.5}
        color={destructive ? colors.destructive : colors.mutedForeground}
      />
      <Text
        style={[
          styles.rowLabel,
          { color: destructive ? colors.destructive : colors.foreground },
        ]}
      >
        {label}
      </Text>
      {disabled ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: {
    width: '100%',
    maxWidth: 330,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  title: {
    fontSize: 16,
    fontFamily: 'Geist_600SemiBold',
    paddingHorizontal: 20,
    paddingTop: 15,
    paddingBottom: 12,
  },
  centerText: { textAlign: 'center' },
  divider: { height: StyleSheet.hairlineWidth },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  rowLabel: { flex: 1, fontSize: 15, fontFamily: 'Geist_500Medium' },
  confirmBody: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 12, gap: 10 },
  confirmCopy: { fontSize: 12.5, fontFamily: 'Geist_400Regular', lineHeight: 18, textAlign: 'center' },
  confirmAction: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  destructiveText: { fontSize: 13.5, fontFamily: 'Geist_600SemiBold' },
  secondaryAction: {
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { fontSize: 13.5, fontFamily: 'Geist_500Medium' },
});
