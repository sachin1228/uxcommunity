import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';
import { CHAT_MESSAGE_RETENTION_DAYS } from '@/lib/chat';

/** The web notice's Timer glyph (lucide), drawn with Svg — Feather has none. */
function TimerIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Line x1="10" x2="14" y1="2" y2="2" />
      <Line x1="12" x2="15" y1="14" y2="11" />
      <Circle cx="12" cy="14" r="8" />
    </Svg>
  );
}

/**
 * The disappearing-messages notice at the start of a community chat — a port
 * of the web `DisappearingNotice`: WhatsApp's system-message shape, centered,
 * muted, with no author and no timestamp. A policy note, not a message.
 *
 * Rendered only once the true start of the history is loaded (and above the
 * empty state of a fresh room), so it can never float mid-stream while older
 * pages are still unloaded. The window it names comes from the same constant
 * the server-side sweep deletes by (`lib/chat.ts`), so the promise cannot
 * drift from the enforcement.
 */
export function DisappearingNotice() {
  const colors = useColors();
  return (
    <View style={styles.wrap}>
      <View
        accessible
        style={[styles.pill, { backgroundColor: colors.surfaceRaised }]}
      >
        <View style={styles.icon}>
          <TimerIcon size={12} color={colors.mutedForeground} />
        </View>
        <Text style={[styles.text, { color: colors.mutedForeground }]}>
          All messages will disappear from this chat for everyone after{' '}
          {CHAT_MESSAGE_RETENTION_DAYS} days.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 6,
    maxWidth: '85%',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  icon: {
    marginTop: 1,
  },
  text: {
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 15,
    fontFamily: 'Geist_400Regular',
    textAlign: 'center',
  },
});
