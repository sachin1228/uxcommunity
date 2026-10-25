import React, { useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
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
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { PushNotificationsBridge } from '@/components/PushNotificationsBridge';
import { VerificationBannerGate } from '@/components/verification/VerificationBannerGate';
import { useColors } from '@/hooks/useColors';
import { queryClient } from '@/lib/queryClient';

SplashScreen.preventAutoHideAsync();

/**
 * The app-level session guard. The auth group only redirects a *signed-in*
 * member; this closes the other direction, so an expired cookie leaves the
 * tabs instead of a shell whose every request is rejected.
 */
function SessionGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const inAuth = segments[0] === '(auth)';
  /**
   * True from the moment a signed-out redirect is issued until the auth group
   * is actually on screen. `useSegments()` can briefly report a stale or empty
   * value while the navigation settles; without this latch each of those
   * renders would issue another `replace('/(auth)/login')`, and every one of
   * them re-animates the sign-in screen — the "login screen comes again"
   * flicker after signing out.
   */
  const redirecting = React.useRef(false);

  useEffect(() => {
    if (isLoading || user || inAuth) {
      redirecting.current = false;
      return;
    }
    if (redirecting.current) return;
    redirecting.current = true;
    router.replace('/(auth)/login');
  }, [inAuth, isLoading, router, user]);

  return <>{children}</>;
}

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
                <SessionGate>
                  <VerificationBannerGate>
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
                    name="create-community"
                    options={{ animation: 'slide_from_right', contentStyle: { backgroundColor: bg } }}
                  />
                  <Stack.Screen
                    name="community-settings/[id]"
                    options={{ animation: 'slide_from_right', contentStyle: { backgroundColor: bg } }}
                  />
                  <Stack.Screen
                    name="notifications"
                    options={{ animation: 'slide_from_right', contentStyle: { backgroundColor: bg } }}
                  />
                  <Stack.Screen
                    name="messages/index"
                    options={{ animation: 'slide_from_right', contentStyle: { backgroundColor: bg } }}
                  />
                  <Stack.Screen
                    name="messages/[id]"
                    options={{ animation: 'slide_from_right', contentStyle: { backgroundColor: bg } }}
                  />
                  <Stack.Screen
                    name="member/[id]"
                    options={{ animation: 'slide_from_right', contentStyle: { backgroundColor: bg } }}
                  />
                  <Stack.Screen
                    name="settings/notifications"
                    options={{ animation: 'slide_from_right', contentStyle: { backgroundColor: bg } }}
                  />
                  <Stack.Screen
                    name="settings/index"
                    options={{ animation: 'slide_from_right', contentStyle: { backgroundColor: bg } }}
                  />
                  <Stack.Screen
                    name="settings/profile"
                    options={{ animation: 'slide_from_right', contentStyle: { backgroundColor: bg } }}
                  />
                  <Stack.Screen
                    name="settings/account"
                    options={{ animation: 'slide_from_right', contentStyle: { backgroundColor: bg } }}
                  />
                  <Stack.Screen
                    name="settings/email"
                    options={{ animation: 'slide_from_right', contentStyle: { backgroundColor: bg } }}
                  />
                  <Stack.Screen
                    name="settings/connected-accounts"
                    options={{ animation: 'slide_from_right', contentStyle: { backgroundColor: bg } }}
                  />
                  <Stack.Screen
                    name="settings/job-profile"
                    options={{ animation: 'slide_from_right', contentStyle: { backgroundColor: bg } }}
                  />
                  <Stack.Screen
                    name="settings/verification"
                    options={{ animation: 'slide_from_right', contentStyle: { backgroundColor: bg } }}
                  />
                  <Stack.Screen name="+not-found" />
                </Stack>
                  </VerificationBannerGate>
                </SessionGate>
              </AuthProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
