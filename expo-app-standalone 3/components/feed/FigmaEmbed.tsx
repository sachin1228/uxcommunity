import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
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
  const [WebView, setWebView] = useState<any>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import('react-native-webview')
      .then((m) => {
        if (!cancelled) setWebView(() => m.WebView);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => { cancelled = true; };
  }, []);

  const openInBrowser = () => WebBrowser.openBrowserAsync(fallbackUrl);

  if (loadError || !WebView) {
    if (loadError) {
      return (
        <Pressable style={[styles.fallback, { backgroundColor: colors.mutedForeground + '10', borderColor: colors.border }]} onPress={openInBrowser}>
          <View style={styles.fallbackRow}>
            <View style={styles.iconBg}>
              <Text style={styles.iconText}>F</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.fallbackTitle, { color: colors.mutedForeground }]}>Figma prototype</Text>
              <Text style={[styles.fallbackSub, { color: colors.mutedForeground }]}>Tap to open in browser</Text>
            </View>
            <Feather name="external-link" size={16} color={colors.primary} />
          </View>
        </Pressable>
      );
    }
    return (
      <View style={[styles.fallback, { backgroundColor: colors.mutedForeground + '10', borderColor: colors.border }]}>
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.mutedForeground} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading prototype…</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { borderColor: colors.border }]}>
      <View style={styles.webviewWrap}>
        <WebView
          source={{ uri: embedUrl }}
          style={styles.webview}
          javaScriptEnabled
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loading}>
              <ActivityIndicator size="small" color={colors.mutedForeground} />
              <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading prototype…</Text>
            </View>
          )}
        />
      </View>
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <Text style={[styles.footerLabel, { color: colors.mutedForeground }]}>Interactive prototype</Text>
        <Pressable onPress={openInBrowser} style={styles.footerBtn}>
          <Text style={[styles.footerLink, { color: colors.primary }]}>View full screen</Text>
          <Feather name="maximize-2" size={12} color={colors.primary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', marginTop: 4 },
  webviewWrap: { aspectRatio: 16 / 10, backgroundColor: '#1e1e1e' },
  webview: { flex: 1 },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 6 },
  loadingText: { fontFamily: 'Geist_400Regular', fontSize: 12 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  footerLabel: { fontFamily: 'Geist_400Regular', fontSize: 12 },
  footerBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  footerLink: { fontFamily: 'Geist_500Medium', fontSize: 12 },
  fallback: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, padding: 12, marginTop: 4 },
  fallbackRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16 },
  iconBg: { width: 36, height: 36, borderRadius: 8, backgroundColor: '#a259ff', alignItems: 'center', justifyContent: 'center' },
  iconText: { color: '#fff', fontFamily: 'Geist_700Bold', fontSize: 18 },
  fallbackTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 13 },
  fallbackSub: { fontFamily: 'Geist_400Regular', fontSize: 11, marginTop: 1 },
});
