import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { hapticSelection } from '@/lib/haptics';

/**
 * The event ticket's accent color — the web `AccentColorPicker`, ported to the
 * phone: the same eight presets (White is the form's default) plus a custom
 * hex. The chosen hex drives the card's date, RSVP button and stub tint.
 */
export const DEFAULT_EVENT_ACCENT = '#e2e8f0';

export const EVENT_ACCENT_PRESETS = [
  { value: DEFAULT_EVENT_ACCENT, label: 'White' },
  { value: '#e8e14a', label: 'Citron' },
  { value: '#a78bfa', label: 'Violet' },
  { value: '#38bdf8', label: 'Sky' },
  { value: '#34d399', label: 'Mint' },
  { value: '#fb923c', label: 'Orange' },
  { value: '#f472b6', label: 'Pink' },
  { value: '#f87171', label: 'Red' },
];

function normalizeHex(value: string): string | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
  return match ? `#${match[1].toLowerCase()}` : null;
}

export function EventAccentPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const colors = useColors();
  const isPreset = EVENT_ACCENT_PRESETS.some((preset) => preset.value === value.toLowerCase());
  const [customMode, setCustomMode] = useState(!isPreset);
  const [hex, setHex] = useState(value);

  useEffect(() => setHex(value), [value]);

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {EVENT_ACCENT_PRESETS.map((preset) => {
          const active = value.toLowerCase() === preset.value;
          return (
            <Pressable
              key={preset.value}
              onPress={() => {
                hapticSelection();
                setCustomMode(false);
                onChange(preset.value);
              }}
              style={[
                styles.dot,
                {
                  backgroundColor: preset.value,
                  borderColor: active ? colors.foreground : 'rgba(255,255,255,0.15)',
                  borderWidth: active ? 2 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={preset.label}
              accessibilityState={{ selected: active }}
            >
              {active ? <Feather name="check" size={14} color="#1c1917" /> : null}
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => {
            hapticSelection();
            setCustomMode((current) => !current);
          }}
          style={[
            styles.customChip,
            { borderColor: customMode ? colors.foreground : 'rgba(255,255,255,0.15)' },
          ]}
          accessibilityRole="button"
          accessibilityState={{ selected: customMode }}
          accessibilityLabel="Custom color"
        >
          <Text
            style={[
              styles.customText,
              { color: customMode ? colors.foreground : colors.foregroundMuted },
            ]}
          >
            Custom
          </Text>
        </Pressable>
      </View>

      {customMode ? (
        <View style={styles.hexRow}>
          <View
            style={[
              styles.hexSwatch,
              { backgroundColor: normalizeHex(hex) ?? colors.surfaceRaised },
            ]}
          />
          <TextInput
            value={hex}
            onChangeText={(text) => {
              setHex(text);
              const normalized = normalizeHex(text);
              if (normalized) onChange(normalized);
            }}
            maxLength={7}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="#e2e8f0"
            placeholderTextColor={colors.foregroundSubtle}
            style={[
              styles.hexInput,
              {
                color: colors.foreground,
                backgroundColor: colors.inputBackground,
                borderColor: colors.borderSubtle,
              },
            ]}
            accessibilityLabel="Custom accent hex color"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  dot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  customChip: {
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customText: { fontFamily: 'Geist_500Medium', fontSize: 11 },
  hexRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hexSwatch: { width: 40, height: 36, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  hexInput: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    fontFamily: 'Geist_500Medium',
    fontSize: 14,
  },
});
