import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

/**
 * The profile screens' fixed header: an opaque bar shaped like the tabs' own
 * AppHeader (same paddings, so the two are the same height), with its controls
 * pushed to the edges. Because it sits above the list, the dotted hero starts
 * right under it instead of behind the status bar.
 */
export function ProfilePageHeader({
  leading,
  trailing,
}: {
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.header,
        {
          paddingTop: insets.top + 8,
          backgroundColor: colors.background,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <View style={styles.slot}>{leading}</View>
      <View style={styles.slot}>{trailing}</View>
    </View>
  );
}

/** A header control — the AppHeader's 34dp icon button, 44dp touch target. */
export function ProfileHeaderButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { opacity: pressed ? 0.8 : 1 }]}
    >
      {icon}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  slot: { flexDirection: 'row', alignItems: 'center' },
  button: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
