import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { EventChatPreviewRow } from './EventChatPreviewRow';
import { DialogError, DialogPrimaryButton, DialogSecondaryButton, EventModal } from './EventModal';

/**
 * The confirmation in front of both halves of an RSVP — the mobile port of the
 * web `RsvpConfirmDialog`.
 *
 * RSVP-ing is not only a number: it is how somebody enters the event's group
 * chat, so the dialog's whole point is the room it shows, drawn exactly as the
 * sidebar will draw it. One line says what the button does to the RSVP; the row
 * shows what it does to the room. Neither direction happens under a stray tap —
 * the request leaves only from the confirm button.
 *
 * Mounted only while open, so every attempt starts from a clean slate.
 */
export type RsvpConfirmMode = 'join' | 'leave';

export function RsvpConfirmDialog({
  mode,
  onClose,
  onConfirm,
  eventTitle,
  eventDate,
  eventEnd,
  coverImageUrl,
  chatMemberCount = null,
  isOwner = false,
  pending,
  error,
}: {
  mode: RsvpConfirmMode;
  onClose: () => void;
  onConfirm: () => void;
  eventTitle: string;
  /** The event's start — the room face's date tile. */
  eventDate: string;
  /** The event's end (or its start when it has none) — the tile's LIVE window. */
  eventEnd: string | null;
  /** The event's cover, which the room wears as its own face. */
  coverImageUrl: string | null;
  /** Members in the room; null hides the line (e.g. no room yet). */
  chatMemberCount?: number | null;
  /** The host keeps their own group chat, so backing out costs them less. */
  isOwner?: boolean;
  pending: boolean;
  error?: string | null;
}) {
  const colors = useColors();
  const joining = mode === 'join';

  return (
    <EventModal
      title={joining ? 'Confirm your RSVP' : 'Withdraw your RSVP?'}
      onClose={onClose}
      dismissable={!pending}
      footer={
        <>
          <DialogSecondaryButton
            label={joining ? 'Cancel' : 'No, keep going'}
            onPress={onClose}
            disabled={pending}
          />
          <DialogPrimaryButton
            label={joining ? 'Confirm RSVP' : 'Yes, not going'}
            pendingLabel={joining ? 'Confirming…' : 'Withdrawing…'}
            icon={
              <Feather
                name={joining ? 'check' : 'user-x'}
                size={15}
                color={colors.primaryForeground}
              />
            }
            onPress={onConfirm}
            pending={pending}
          />
        </>
      }
    >
      <Text style={[styles.copy, { color: colors.mutedForeground }]}>
        {joining
          ? 'Your RSVP joins you to this chat — everyone going talks in one place.'
          : isOwner
            ? 'You host this event, so the chat stays yours — everyone going keeps talking in it.'
            : 'Withdrawing takes you out of this chat — your RSVP is what put you in it.'}
      </Text>

      <View style={styles.preview}>
        <EventChatPreviewRow
          eventTitle={eventTitle}
          eventDate={eventDate}
          eventEnd={eventEnd}
          coverImageUrl={coverImageUrl}
          memberCount={chatMemberCount}
        />
      </View>

      {error ? <DialogError message={error} /> : null}
    </EventModal>
  );
}

const styles = StyleSheet.create({
  copy: { fontSize: 13, fontFamily: 'Geist_400Regular', lineHeight: 19 },
  preview: { marginTop: 20 },
});
