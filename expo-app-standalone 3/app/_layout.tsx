import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
  useFonts,
} from '@expo-google-fonts/geist';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { AuthProvider } from '@/context/AuthContext';
import { PushNotificationsBridge } from '@/components/PushNotificationsBridge';
import { useColors } from '@/hooks/useColors';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

export default function RootLayout() {
  // The native window background is driven by the design-system page colour
  // (web `--color-background`), so there is no white flash between screens.
  const { background: bg } = useColors();

  const [fontsLoaded, fontError] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
  });

  // Keep the native window background in sync so there's no white flash
  // between screens during navigation transitions.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(bg);
  }, [bg]);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1, backgroundColor: bg }}>
            <KeyboardProvider>
              <AuthProvider>
                <PushNotificationsBridge />
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: bg },
                    animation: 'fade',
                  }}
                >
                  <Stack.Screen name="index" />
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="(auth)" />
                  <Stack.Screen
                    name="community/[id]"
                    options={{ animation: 'slide_from_right', contentStyle: { backgroundColor: bg } }}
                  />
                  <Stack.Screen
                    name="settings/notifications"
                    options={{ animation: 'slide_from_right', contentStyle: { backgroundColor: bg } }}
                  />
                  <Stack.Screen name="+not-found" />
                </Stack>
              </AuthProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
