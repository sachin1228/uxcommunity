import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Tabs, usePathname } from 'expo-router';
import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PlatformPressable } from '@react-navigation/elements';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';

/**
 * The rule above the selected item: a generous segment centred over the icon,
 * short of the item's full width.
 */
const INDICATOR_LENGTH = 56;
const INDICATOR_THICKNESS = 2;

/**
 * Does this tab own the current route? `/` is the index tab; the rest match
 * themselves or anything nested beneath them (`/communities/42`).
 */
function isActiveTab(pathname: string, path: string) {
  if (path === '/') return pathname === '/' || pathname === '';
  return pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * A tab item with the active rule above it.
 *
 * React Navigation hands the item's own pressable props through, so the button
 * keeps its platform feedback; the rule is absolutely positioned and reserves
 * no space, which is what keeps the icon and label from moving when the
 * selection — and with it the rule — changes items.
 */
function TabBarButton({
  active,
  color,
  children,
  ...props
}: BottomTabBarButtonProps & { active: boolean; color: string }) {
  return (
    <PlatformPressable {...props}>
      {active ? <View style={[styles.tabIndicator, { backgroundColor: color }]} /> : null}
      {children}
    </PlatformPressable>
  );
}

// iOS 26+ uses NativeTabs with liquid glass. Older iOS / Android / web fall back
// to the classic Tabs with a blurred tab bar.
function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="communities">
        <Icon sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }} />
        <Label>Chat</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: 'square.stack.3d.up', selected: 'square.stack.3d.up.fill' }} />
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
  const colors = useColors();
  const isDark = colors.isDark;
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';
  const insets = useSafeAreaInsets();
  const bottomInset = isWeb ? 0 : insets.bottom;
  const pathname = usePathname();

  // The rule lives on the button now, so the item carries no border and
  // nothing about the layout changes with the selection.
  const tabButton = (path: string) => (props: BottomTabBarButtonProps) => (
    <TabBarButton {...props} active={isActiveTab(pathname, path)} color={colors.primary} />
  );

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: isIOS ? 'transparent' : colors.background,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
          height: isWeb ? 84 : 56 + bottomInset,
          paddingBottom: bottomInset,
        },
        tabBarLabelStyle: {
          fontSize: 13,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.background },
              ]}
            />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="communities"
        options={{
          title: 'Chat',
          tabBarButton: tabButton('/communities'),
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="bubble.left.and.bubble.right" tintColor={color} size={28} />
            ) : (
              <Feather name="message-circle" size={26} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Feed',
          tabBarButton: tabButton('/'),
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="square.stack.3d.up" tintColor={color} size={28} />
            ) : (
              <Feather name="layers" size={26} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="jobs"
        options={{
          title: 'Jobs',
          tabBarButton: tabButton('/jobs'),
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="briefcase" tintColor={color} size={28} />
            ) : (
              <Feather name="briefcase" size={26} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Explore',
          tabBarButton: tabButton('/explore'),
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="binoculars" tintColor={color} size={28} />
            ) : (
              <Feather name="compass" size={26} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarButton: tabButton('/profile'),
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="person.crop.circle" tintColor={color} size={28} />
            ) : (
              <Feather name="user" size={26} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}

const styles = StyleSheet.create({
  tabIndicator: {
    position: 'absolute',
    top: 0,
    alignSelf: 'center',
    width: INDICATOR_LENGTH,
    height: INDICATOR_THICKNESS,
    borderRadius: INDICATOR_THICKNESS / 2,
  },
});
