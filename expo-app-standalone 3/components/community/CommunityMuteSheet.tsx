import React from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import type { CommunityMuteDuration } from '@/lib/communities';
import { hapticSelection } from '@/lib/haptics';

/**
 * The mute sheet behind the ⋯ menu's "Mute notifications" row — the touch
 * version of the web header's dropdown:
 *
 *   unmuted → "8 hours" / "1 week" / "Always"
 *   muted   → "Unmute notifications" with the deadline (or "Muted" for the
 *             forever flag) beneath it
 *
 * The row carries a chevron while it opens this sheet; once muted it unmutes
 * in place instead. The durations are the same three the web menu offers; the
 * labels are the literal web copy.
 */

const MUTE_DURATIONS: Array<{ duration: CommunityMuteDuration; label: string }> = [
  { duration: '8h', label: '8 hours' },
  { duration: '1w', label: '1 week' },
  { duration: 'always', label: 'Always' },
];

interface Props {
  open: boolean;
  /** Effective mute (forever OR a live timed deadline — see isCommunityMuted). */
  muted: boolean;
  /** "Muted" for the forever flag, "Muted until …" for a timed one. */
  muteStateLabel: string | null;
  /** A save is in flight — rows wait. */
  busy: boolean;
  onChoose: (duration: CommunityMuteDuration) => void;
  onClose: () => void;
}

function SheetRow({
  icon,
  label,
  sublabel,
  disabled,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel?: string | null;
  disabled?: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={() => {
        hapticSelection();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="menuitem"
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colors.subtle : 'transparent',
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      {icon}
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: colors.foreground }]}>{label}</Text>
        {sublabel ? (
          <Text style={[styles.rowSublabel, { color: colors.mutedForeground }]}>
            {sublabel}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function CommunityMuteSheet({
  open,
  muted,
  muteStateLabel,
  busy,
  onChoose,
  onClose,
}: Props) {
  const colors = useColors();

  return (
    <Modal transparent animationType="fade" visible={open} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          {muted ? (
            /* Muted (forever or still-timed): one action, off, with the
               deadline — or the forever flag — beneath it. */
            <SheetRow
              icon={
                busy ? (
                  <ActivityIndicator size="small" color={colors.mutedForeground} />
                ) : (
                  <Feather
                    name="bell"
                    size={16}
                    strokeWidth={2.5}
                    color={colors.mutedForeground}
                  />
                )
              }
              label="Unmute notifications"
              sublabel={muteStateLabel}
              disabled={busy}
              onPress={() => onChoose('off')}
            />
          ) : (
            <>
              <Text style={[styles.title, { color: colors.foreground }]}>
                Mute notifications
              </Text>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              {MUTE_DURATIONS.map(({ duration, label }) => (
                <SheetRow
                  key={duration}
                  icon={
                    <Feather
                      name="bell-off"
                      size={16}
                      strokeWidth={2.5}
                      color={colors.mutedForeground}
                    />
                  }
                  label={label}
                  disabled={busy}
                  onPress={() => onChoose(duration)}
                />
              ))}
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
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  title: {
    fontSize: 16,
    fontFamily: 'Geist_600SemiBold',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  divider: { height: StyleSheet.hairlineWidth },
  rowText: { flexShrink: 1 },
  rowLabel: { fontSize: 15, fontFamily: 'Geist_500Medium' },
  rowSublabel: { fontSize: 12, fontFamily: 'Geist_400Regular', marginTop: 2 },
});
