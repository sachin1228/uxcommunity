import React from 'react';
import { Stack } from 'expo-router';
import { useColors } from '@/hooks/useColors';

/**
 * The Jobs tab's own stack. Keeping the posting screens inside the tab makes
 * Back return to the board (with its tab and scroll state), instead of
 * unwinding the root stack to whichever tab was first.
 */
export default function JobsStackLayout() {
  const { background } = useColors();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" options={{ animation: 'none' }} />
    </Stack>
  );
}
