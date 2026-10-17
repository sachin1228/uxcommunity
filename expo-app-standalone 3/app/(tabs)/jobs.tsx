import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
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
        <Feather name="briefcase" size={32} color={colors.foregroundSubtle} />
        <Text style={[styles.title, { color: colors.foregroundMuted }]}>
          Jobs are coming soon
        </Text>
        <Text style={[styles.body, { color: colors.foregroundSubtle }]}>
          Role openings matched to your profile will appear here.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 32,
  },
  title: { fontSize: 16, fontFamily: 'Geist_600SemiBold', textAlign: 'center' },
  body: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: 'Geist_400Regular',
    textAlign: 'center',
  },
});
