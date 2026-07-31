import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function JobsTab() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + 16 }]}>
      <Text style={[styles.text, { color: colors.mutedForeground }]}>Jobs — coming soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 15, fontFamily: 'Geist_400Regular' },
});
