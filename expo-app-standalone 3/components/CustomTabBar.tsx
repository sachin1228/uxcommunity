import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { FeedIcon } from '@/components/icons/FeedIcon';

interface Tab {
  key: string;
  label: string;
  icon: (color: string, focused: boolean) => React.ReactNode;
}

const TABS: Tab[] = [
  {
    key: 'index',
    label: 'Home',
    icon: (color, focused) => <Feather name="home" size={22} color={color} />,
  },
  {
    key: 'communities',
    label: 'Communities',
    icon: (color, focused) => <Feather name={focused ? 'message-square' : 'message-circle'} size={22} color={color} />,
  },
  {
    key: 'library',
    label: 'Library',
    icon: (color, focused) => <Feather name="book-open" size={22} color={color} />,
  },
  {
    key: 'notifications',
    label: 'Notifications',
    icon: (color, focused) => <Feather name="bell" size={22} color={color} />,
  },
  {
    key: 'jobs',
    label: 'Jobs',
    icon: (color, focused) => <Feather name="briefcase" size={22} color={color} />,
  },
];

interface CustomTabBarProps {
  state: any;
  navigation: any;
}

export function CustomTabBar({ state, navigation }: CustomTabBarProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isIOS = Platform.OS === 'ios';
  const bottomInset = insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.subtle, borderTopColor: colors.border }]}>
      {isIOS && (
        <BlurView intensity={100} tint="dark" style={StyleSheet.absoluteFill} />
      )}
      <View style={[styles.tabs, { paddingBottom: bottomInset }]}>
        {TABS.map((tab) => {
          const index = state.routes.findIndex((r: any) => r.name === tab.key);
          const isFocused = state.index === index;
          const color = isFocused ? colors.foreground : colors.mutedForeground;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: state.routes[index].key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(state.routes[index].name);
            }
          };

          return (
            <Pressable key={tab.key} onPress={onPress} style={styles.tab}>
              {isFocused && <View style={[styles.indicator, { backgroundColor: colors.foreground }]} />}
              <View style={styles.tabContent}>
                {tab.icon(color, isFocused)}
                <Text style={[styles.label, { color }]} numberOfLines={1}>
                  {tab.label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  tabs: {
    flexDirection: 'row',
    paddingTop: 6,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
  },
  tabContent: {
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
  },
  indicator: {
    width: 20,
    height: 2,
    borderRadius: 1,
    marginBottom: 2,
  },
  label: {
    fontSize: 10,
    fontFamily: 'Geist_500Medium',
  },
});
