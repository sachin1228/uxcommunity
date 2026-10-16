import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * The save-status line every autosaving settings field renders — the web
 * SaveStatus pattern kept identical: spinner while saving, check on success,
 * quiet error on failure.
 */
export function SaveStatus({ state }: { state: SaveState }) {
  const colors = useColors();

  if (state === 'idle') return null;

  if (state === 'saving') {
    return (
      <View style={styles.row}>
        <ActivityIndicator size="small" color={colors.mutedForeground} />
        <Text style={[styles.text, { color: colors.mutedForeground }]}>Saving…</Text>
      </View>
    );
  }

  if (state === 'saved') {
    return (
      <View style={styles.row}>
        <Feather name="check" size={12} color={colors.accent} />
        <Text style={[styles.text, { color: colors.accent }]}>Saved</Text>
      </View>
    );
  }

  return (
    <Text style={[styles.text, { color: colors.destructive }]}>
      Couldn&apos;t save — try again
    </Text>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  text: { fontSize: 11.5, fontFamily: 'Geist_400Regular' },
});
