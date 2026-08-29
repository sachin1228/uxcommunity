import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';

interface FigmaEmbedProps {
  embedUrl: string;
  fallbackUrl: string;
  colors: {
    mutedForeground: string;
    primary: string;
    border: string;
  };
}

export function FigmaEmbed({ embedUrl, fallbackUrl, colors }: FigmaEmbedProps) {
  const openInBrowser = () => WebBrowser.openBrowserAsync(fallbackUrl);

  return (
    <Pressable style={[styles.container, { backgroundColor: colors.mutedForeground + '10', borderColor: colors.border }]} onPress={openInBrowser}>
      <View style={styles.row}>
        <View style={styles.iconBg}>
          <Text style={styles.iconText}>F</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.mutedForeground }]}>Figma prototype</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>Tap to open interactive preview</Text>
        </View>
        <Feather name="external-link" size={16} color={colors.primary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, padding: 12, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBg: { width: 36, height: 36, borderRadius: 8, backgroundColor: '#a259ff', alignItems: 'center', justifyContent: 'center' },
  iconText: { color: '#fff', fontFamily: 'Geist_700Bold', fontSize: 18 },
  title: { fontFamily: 'Geist_600SemiBold', fontSize: 13 },
  sub: { fontFamily: 'Geist_400Regular', fontSize: 11, marginTop: 1 },
});
