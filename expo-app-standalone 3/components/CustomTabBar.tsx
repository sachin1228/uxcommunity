import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

interface Tab {
  key: string;
  label: string;
  icon: (color: string) => React.ReactNode;
}

const TABS: Tab[] = [
  {
    key: 'index',
    label: 'Home',
    icon: (color) => <Feather name="home" size={24} color={color} />,
  },
  {
    key: 'communities',
    label: 'Communities',
    icon: (color) => <Feather name="message-circle" size={24} color={color} />,
  },
  {
    key: 'library',
    label: 'Library',
    icon: (color) => <Feather name="book-open" size={24} color={color} />,
  },
  {
    key: 'notifications',
    label: 'Notifications',
    icon: (color) => <Feather name="bell" size={24} color={color} />,
  },
  {
    key: 'jobs',
    label: 'Jobs',
    icon: (color) => <Feather name="briefcase" size={24} color={color} />,
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
              <View style={styles.tabContent}>
                {isFocused && <View style={[styles.indicator, { backgroundColor: colors.foreground }]} />}
                {tab.icon(color)}
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
  },
  tab: {
    flex: 1,
  },
  tabContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 8,
  },
  indicator: {
    position: 'absolute',
    top: 0,
    left: '20%',
    right: '20%',
    height: 2,
    borderRadius: 1,
  },
  label: {
    fontSize: 10,
    fontFamily: 'Geist_500Medium',
  },
});
