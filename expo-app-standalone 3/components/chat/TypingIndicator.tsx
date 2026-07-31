import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

export function TypingIndicator({ label }: { label: string | null }) {
  const colors = useColors();
  if (!label) return null;
  return (
    <View style={styles.row}>
      <Text style={[styles.text, { color: colors.primary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  text: {
    fontSize: 12,
    fontFamily: 'Geist_500Medium',
    fontStyle: 'italic',
  },
});
