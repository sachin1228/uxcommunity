import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { CHAT_MESSAGE_RETENTION_DAYS } from '@/lib/chat';

/**
 * The disappearing-messages notice at the start of a community chat — a port
 * of the web `DisappearingNotice`: WhatsApp's system-message shape, centered,
 * muted, with no author and no timestamp. A policy note, not a message.
 *
 * The timer rides inline in the text, exactly like WhatsApp's system notice:
 * it sits two spaces before the first word and the paragraph stays centered,
 * instead of a separate icon column opening a gap before the text.
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
        <Text style={[styles.text, { color: colors.mutedForeground }]}>
          <MaterialCommunityIcons
            name="timer-outline"
            size={12}
            color={colors.mutedForeground}
          />
          {'  '}
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
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  pill: {
    alignSelf: 'stretch',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  text: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: 'Geist_400Regular',
    textAlign: 'center',
  },
});
