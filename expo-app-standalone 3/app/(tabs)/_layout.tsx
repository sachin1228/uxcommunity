import React from 'react';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Tabs, usePathname } from 'expo-router';
import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';
import { FloatingTabBar } from '@/components/tabs/FloatingTabBar';

// iOS 26+ uses NativeTabs with liquid glass. Older iOS / Android / web use the
// app's floating capsule bar.
function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="communities">
        <Icon sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }} />
        <Label>Chat</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: 'square.grid.2x2', selected: 'square.grid.2x2.fill' }} />
        <Label>Feed</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="jobs">
        <Icon sf={{ default: 'briefcase', selected: 'briefcase.fill' }} />
        <Label>Jobs</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="explore">
        <Icon sf={{ default: 'binoculars', selected: 'binoculars.fill' }} />
        <Label>Explore</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} />
        <Label>Profile</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const pathname = usePathname();
  // Posting screens live in the Jobs tab's own stack; the bar steps aside so
  // they read as full pages, and returns with the board.
  const hideTabBar = pathname !== '/jobs' && pathname.startsWith('/jobs');

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => (hideTabBar ? null : <FloatingTabBar {...props} />)}
    >
      <Tabs.Screen name="communities" options={{ title: 'Chat' }} />
      <Tabs.Screen name="index" options={{ title: 'Feed' }} />
      <Tabs.Screen name="jobs" options={{ title: 'Jobs' }} />
      <Tabs.Screen name="explore" options={{ title: 'Explore' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
