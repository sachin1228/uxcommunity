import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { EventChatPreviewRow } from './EventChatPreviewRow';
import { DialogSecondaryButton, EventModal } from './EventModal';

/**
 * Shown right after an event is created: the event exists, so its group chat
 * does too — the mobile port of the web `EventGroupCreatedModal`. The copy says
 * what the room is for, and the row draws it the way the sidebar will show it,
 * so the creator recognises it there, pinned. Okay is the only action; the room
 * opens from that pin.
 */
export function EventGroupCreatedModal({
  eventTitle,
  eventDate,
  eventEnd,
  coverImageUrl,
  onClose,
}: {
  eventTitle: string;
  eventDate: string;
  eventEnd: string | null;
  coverImageUrl: string | null;
  onClose: () => void;
}) {
  const colors = useColors();

  return (
    <EventModal
      title="A group chat for everyone going"
      onClose={onClose}
      footer={<DialogSecondaryButton label="Okay" onPress={onClose} />}
    >
      <Text style={[styles.copy, { color: colors.mutedForeground }]}>
        People RSVP to your event and join this chat — everyone going talks in one place.
      </Text>

      {/* The room the moment it is made: only the creator is in it. */}
      <EventChatPreviewRow
        eventTitle={eventTitle}
        eventDate={eventDate}
        eventEnd={eventEnd}
        coverImageUrl={coverImageUrl}
        memberCount={1}
      />
    </EventModal>
  );
}

const styles = StyleSheet.create({
  copy: { fontSize: 13, fontFamily: 'Geist_400Regular', lineHeight: 19, marginBottom: 20 },
});
