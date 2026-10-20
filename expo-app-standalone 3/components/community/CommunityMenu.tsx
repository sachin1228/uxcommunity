import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import type { CommunityMuteDuration } from '@/lib/communities';
import { hapticSelection } from '@/lib/haptics';

/**
 * The chat header's ⋯ menu — a card anchored under the header, the way
 * WhatsApp opens it, instead of a bottom sheet.
 *
 *   Mute notifications ›  opens the mute-duration sheet (or, while muted,
 *                         unmutes in place)
 *   Delete chat           — removes the chat from your own list only
 *   Exit community        — removes your membership (the more destructive
 *                           action, so it sits last)
 *
 * Delete and Exit confirm inside the card, so those flows stay on one surface;
 * the parent's `onConfirm` rejects on failure and the card hands itself back
 * with its busy state cleared.
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

export interface CommunityMenuAnchor {
  top: number;
  right: number;
}

interface Props {
  open: boolean;
  /** Position inside the chat screen — header height + right edge, both local. */
  anchor: CommunityMenuAnchor | null;
  /** Effective mute (forever OR a live timed deadline — see isCommunityMuted). */
  muted: boolean;
  /** "Muted" for the forever flag, "Muted until …" for a timed one. */
  muteStateLabel: string | null;
  /** Owner, or a manager granted "edit community settings". */
  canOpenSettings?: boolean;
  onOpenSettings?: () => void;
  onClose: () => void;
  /** The row's durations / off switch live in the mute sheet. */
  onOpenMuteOptions: () => void;
  /** Called with 'off' when the muted row is tapped. */
  onMute: (duration: CommunityMuteDuration) => void;
  /** Runs the action; must reject when the server refuses, so the card stays up. */
  onConfirm: (action: CommunityConfirmAction) => Promise<void>;
}

export function CommunityMenu({
  open,
  anchor,
  muted,
  muteStateLabel,
  canOpenSettings = false,
  onOpenSettings,
  onClose,
  onOpenMuteOptions,
  onMute,
  onConfirm,
}: Props) {
  const colors = useColors();
  const [confirming, setConfirming] = useState<CommunityConfirmAction | null>(null);
  const [busy, setBusy] = useState(false);

  // Every opening starts at the top level; a failed confirm leaves the card
  // up but unlocks it, exactly like the old in-sheet confirm. Reset on open
  // (not close) so the fading-out card keeps its last content.
  useEffect(() => {
    if (!open) return;
    setConfirming(null);
    setBusy(false);
  }, [open]);

  const close = () => {
    if (busy) return;
    onClose();
  };

  const run = async (action: CommunityConfirmAction) => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm(action);
      // Success navigates away — the menu unmounts with the screen.
    } catch {
      // The parent raised the error toast; hand the card back to the user.
      setBusy(false);
    }
  };

  // No Modal, so Android's back button needs the same dismissal explicitly.
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!busy) onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, busy, onClose]);

  if (!open || !anchor) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable
          style={[
            styles.card,
            confirming ? styles.cardConfirm : null,
            {
              top: anchor.top,
              right: anchor.right,
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          {confirming ? (
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
            <View>
              {canOpenSettings && onOpenSettings && (
                <>
                  <MenuRow
                    icon="settings"
                    label="Community settings"
                    chevron
                    onPress={() => {
                      onClose();
                      onOpenSettings();
                    }}
                  />
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                </>
              )}
              <MenuRow
                icon={muted ? 'bell' : 'bell-off'}
                label={muted ? 'Unmute notifications' : 'Mute notifications'}
                sublabel={muted ? muteStateLabel : null}
                chevron={!muted}
                onPress={() => {
                  if (muted) {
                    onMute('off');
                  } else {
                    onOpenMuteOptions();
                  }
                }}
              />
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <MenuRow
                destructive
                icon="trash-2"
                label="Delete chat"
                onPress={() => setConfirming('delete')}
              />
              {/* Most destructive last: exiting removes membership, deleting
                  only hides the chat from your list. */}
              <MenuRow
                destructive
                icon="log-out"
                label="Exit community"
                onPress={() => setConfirming('leave')}
              />
            </View>
          )}
        </Pressable>
      </Pressable>
    </View>
  );
}

function MenuRow({
  icon,
  label,
  sublabel,
  destructive,
  chevron,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  sublabel?: string | null;
  destructive?: boolean;
  /** Marks a row that opens another surface, like WhatsApp's "More ›". */
  chevron?: boolean;
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
        styles.row,
        {
          backgroundColor: pressed
            ? destructive
              ? colors.destructive + '14'
              : colors.subtle
            : 'transparent',
        },
      ]}
    >
      <Feather
        name={icon}
        size={16}
        strokeWidth={2.5}
        color={destructive ? colors.destructive : colors.mutedForeground}
      />
      <View style={styles.rowText}>
        <Text
          style={[
            styles.rowLabel,
            { color: destructive ? colors.destructive : colors.foreground },
          ]}
        >
          {label}
        </Text>
        {sublabel ? (
          <Text style={[styles.rowSublabel, { color: colors.mutedForeground }]}>
            {sublabel}
          </Text>
        ) : null}
      </View>
      {chevron ? (
        <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Transparent: the chat stays at full brightness behind the card, like the
  // WhatsApp menu, while the pressable layer catches the outside tap.
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  backdrop: { flex: 1 },
  card: {
    position: 'absolute',
    width: 232,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },
  cardConfirm: { width: 272 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 15, fontFamily: 'Geist_500Medium' },
  rowSublabel: { fontSize: 11.5, fontFamily: 'Geist_400Regular', marginTop: 2 },
  confirmHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
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
  confirmAction: { paddingHorizontal: 16, paddingVertical: 14, alignItems: 'center' },
  confirmCtaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  confirmActionText: { fontSize: 14, fontFamily: 'Geist_600SemiBold' },
  divider: { height: StyleSheet.hairlineWidth },
});
