import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useColors } from '@/hooks/useColors';
import { DpWithEventDate } from '@/components/communities/DpWithEventDate';
import { Initials, PinIcon } from '@/components/communities/CommunityRow';
import { eventChatName } from '@/lib/eventChatRules';

/**
 * An event's group chat drawn the way the sidebar will show it — the mobile
 * port of the web `EventChatPreviewRow`: same face (date tile included), same
 * name, the pin mark and the member count.
 *
 * Always static: a preview, not a control. Every surface that announces or
 * confirms the room (the created-event notice, the RSVP confirm) says the same
 * thing about it, so the room the member meets there is the room they scroll
 * past afterwards.
 */
export function EventChatPreviewRow({
  eventTitle,
  eventDate,
  eventEnd,
  coverImageUrl,
  memberCount,
}: {
  eventTitle: string;
  /** The event's start — the face's date tile. */
  eventDate: string;
  /** The event's end (or its start when it has none) — the tile's LIVE window. */
  eventEnd: string | null;
  /** The event's cover, which the room wears as its own face. */
  coverImageUrl: string | null;
  /** The room's current member count; null hides the line. */
  memberCount?: number | null;
}) {
  const colors = useColors();
  const roomName = eventChatName(eventTitle);

  return (
    <View style={[styles.row, { borderColor: colors.border }]}>
      <DpWithEventDate date={eventDate} endsAt={eventEnd} dpSize={36}>
        {coverImageUrl ? (
          <Image
            source={{ uri: coverImageUrl }}
            style={[styles.face, styles.faceImage, { borderColor: colors.border }]}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Initials name={roomName} size={36} colors={colors} />
        )}
      </DpWithEventDate>

      <View style={styles.copy}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
            {roomName}
          </Text>
          <View accessible accessibilityLabel="Pinned until the event" style={styles.pin}>
            <PinIcon size={11} color={colors.mutedForeground} />
          </View>
        </View>
        {typeof memberCount === 'number' ? (
          <Text style={[styles.members, { color: colors.mutedForeground }]}>
            {memberCount === 1 ? '1 member' : `${memberCount} members`}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const FACE = 36;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 9,
  },
  face: {
    width: FACE,
    height: FACE,
    borderRadius: FACE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  faceImage: { backgroundColor: 'transparent' },
  copy: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  name: { fontSize: 14, fontFamily: 'Geist_500Medium', flexShrink: 1 },
  pin: { flexShrink: 0 },
  members: { fontSize: 11, fontFamily: 'Geist_400Regular', lineHeight: 13 },
});
