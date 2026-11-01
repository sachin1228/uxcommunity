import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CommonActions } from '@react-navigation/native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { SymbolView } from 'expo-symbols';
import type { SFSymbol } from 'sf-symbols-typescript';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { hapticSelection } from '@/lib/haptics';

/**
 * The app's bottom bar, as a floating capsule over the content.
 *
 * The selected item is marked twice: a soft capsule slides beneath it and its
 * icon swaps to the filled counterpart. Nothing about the layout changes with
 * the selection — the icons and labels share one fixed grid — so the bar never
 * shifts while the highlight travels.
 */

const BAR_HEIGHT = 64;
const BAR_RADIUS = BAR_HEIGHT / 2;
const ICON_SIZE = 24;
const PILL_HORIZONTAL_INSET = 4;
const PILL_VERTICAL_INSET = 6;

const SLIDE_SPRING = { damping: 22, stiffness: 240, mass: 0.7 };
const SQUASH_SPRING = { damping: 16, stiffness: 240, mass: 0.6 };
const POP_SPRING = { damping: 13, stiffness: 260, mass: 0.6 };

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

type TabIcons = { sf: [SFSymbol, SFSymbol]; ion: [IoniconName, IoniconName] };

const TAB_ICONS: Record<string, TabIcons> = {
  communities: {
    sf: ['bubble.left.and.bubble.right', 'bubble.left.and.bubble.right.fill'],
    ion: ['chatbubble-ellipses-outline', 'chatbubble-ellipses'],
  },
  index: {
    sf: ['square.grid.2x2', 'square.grid.2x2.fill'],
    ion: ['grid-outline', 'grid'],
  },
  jobs: {
    sf: ['briefcase', 'briefcase.fill'],
    ion: ['briefcase-outline', 'briefcase'],
  },
  explore: {
    sf: ['binoculars', 'binoculars.fill'],
    ion: ['compass-outline', 'compass'],
  },
  profile: {
    sf: ['person.crop.circle', 'person.crop.circle.fill'],
    ion: ['person-outline', 'person'],
  },
};

function TabIcon({
  routeName,
  focused,
  color,
}: {
  routeName: string;
  focused: boolean;
  color: string;
}) {
  const icons = TAB_ICONS[routeName];
  if (!icons) return null;

  if (Platform.OS === 'ios') {
    return <SymbolView name={focused ? icons.sf[1] : icons.sf[0]} tintColor={color} size={ICON_SIZE} />;
  }
  return (
    <Ionicons
      name={focused ? icons.ion[1] : icons.ion[0]}
      size={ICON_SIZE}
      color={color}
    />
  );
}

function TabItem({
  label,
  routeName,
  accessibilityLabel,
  testID,
  focused,
  onPress,
  onLongPress,
}: {
  label: string;
  routeName: string;
  accessibilityLabel?: string;
  testID?: string;
  focused: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const colors = useColors();
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);

  // The filled glyph lands with a short dip — enough to read as a press, not
  // enough to make the icon jump out of the label's alignment.
  useEffect(() => {
    if (!focused || reducedMotion) {
      scale.value = 1;
      return;
    }
    scale.value = withSequence(
      withTiming(0.82, { duration: 90 }),
      withSpring(1, POP_SPRING),
    );
  }, [focused, reducedMotion, scale]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const color = focused ? colors.foreground : colors.foregroundMuted;

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.item, pressed ? styles.itemPressed : null]}
    >
      <Animated.View style={iconStyle}>
        <TabIcon routeName={routeName} focused={focused} color={color} />
      </Animated.View>
      <Text numberOfLines={1} style={[styles.label, { color }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [trackWidth, setTrackWidth] = useState(0);
  const itemWidth = trackWidth / state.routes.length;

  const position = useSharedValue(state.index);
  const squash = useSharedValue(1);
  const mounted = useRef(false);

  useEffect(() => {
    if (reducedMotion) {
      position.value = state.index;
      squash.value = 1;
      mounted.current = true;
      return;
    }

    position.value = withSpring(state.index, SLIDE_SPRING);

    // First placement is not a move: the capsule appears under the active tab
    // instead of travelling from index 0.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    squash.value = withSequence(
      withTiming(0.94, { duration: 80 }),
      withSpring(1, SQUASH_SPRING),
    );
  }, [state.index, reducedMotion, position, squash]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: position.value * itemWidth },
      { scaleX: squash.value },
    ],
  }));

  const onTrackLayout = useCallback((event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  }, []);

  const isIOS = Platform.OS === 'ios';
  const isDark = colors.isDark;
  const bottomInset = insets.bottom + (Platform.OS === 'web' ? 12 : 8);

  return (
    <View style={[styles.wrap, { paddingBottom: bottomInset }]} pointerEvents="box-none">
      <View
        style={[
          styles.bar,
          {
            backgroundColor: isIOS ? 'transparent' : colors.surface,
            borderColor: colors.border,
          },
        ]}
      >
        {isIOS ? (
          <View style={styles.blurClip}>
            <BlurView
              intensity={80}
              tint={isDark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: isDark
                    ? 'rgba(18, 18, 20, 0.72)'
                    : 'rgba(255, 255, 255, 0.72)',
                },
              ]}
            />
          </View>
        ) : null}

        <View style={styles.track} onLayout={onTrackLayout}>
          {itemWidth > 0 ? (
            <Animated.View
              style={[
                styles.pill,
                {
                  width: itemWidth - PILL_HORIZONTAL_INSET * 2,
                  backgroundColor: colors.accentSoft,
                },
                pillStyle,
              ]}
            />
          ) : null}

          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const { options } = descriptors[route.key];
            const label =
              typeof options.tabBarLabel === 'string'
                ? options.tabBarLabel
                : options.title ?? route.name;

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });

              if (focused) return;
              hapticSelection();
              if (!event.defaultPrevented) {
                navigation.dispatch({
                  ...CommonActions.navigate(route.name, route.params),
                  target: state.key,
                });
              }
            };

            const onLongPress = () => {
              navigation.emit({ type: 'tabLongPress', target: route.key });
            };

            return (
              <TabItem
                key={route.key}
                label={label}
                routeName={route.name}
                accessibilityLabel={options.tabBarAccessibilityLabel}
                testID={options.tabBarButtonTestID}
                focused={focused}
                onPress={onPress}
                onLongPress={onLongPress}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  bar: {
    width: '100%',
    maxWidth: 560,
    height: BAR_HEIGHT,
    borderRadius: BAR_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    shadowColor: '#000000',
    shadowOpacity: 0.32,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  blurClip: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: BAR_RADIUS,
    overflow: 'hidden',
  },
  track: {
    flex: 1,
    flexDirection: 'row',
    height: '100%',
  },
  pill: {
    position: 'absolute',
    left: PILL_HORIZONTAL_INSET,
    top: PILL_VERTICAL_INSET,
    bottom: PILL_VERTICAL_INSET,
    borderRadius: BAR_RADIUS,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  label: {
    fontFamily: 'Geist_500Medium',
    fontSize: 11,
    lineHeight: 13,
  },
  itemPressed: {
    opacity: 0.7,
  },
});
