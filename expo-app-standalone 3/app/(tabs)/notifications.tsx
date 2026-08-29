import React from 'react';
import { StyleSheet, Text, View, useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AppHeader } from '@/components/AppHeader';
import { useColors } from '@/hooks/useColors';

export default function NotificationsTab() {
  const colors = useColors();
  const colorScheme = useColorScheme();

  return (
    <View style={[styles.root, { backgroundColor: colors.subtle }]}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <AppHeader />
      <View style={styles.content}>
        <Text style={[styles.text, { color: colors.mutedForeground }]}>Notifications — coming soon</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 15, fontFamily: 'Geist_400Regular' },
});
