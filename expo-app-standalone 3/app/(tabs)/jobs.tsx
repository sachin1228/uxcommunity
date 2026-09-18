import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AppHeader } from '@/components/AppHeader';
import { useColors } from '@/hooks/useColors';

export default function JobsTab() {
  const colors = useColors();

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      <AppHeader />
      <View style={styles.content}>
        <Text style={[styles.text, { color: colors.mutedForeground }]}>Jobs — coming soon</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 15, fontFamily: 'Geist_400Regular' },
});
