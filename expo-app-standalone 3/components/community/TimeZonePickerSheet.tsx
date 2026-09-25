import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { hapticSelection } from '@/lib/haptics';
import type { TimeZoneChoice } from '@/lib/eventTimezone';

interface Props {
  visible: boolean;
  choices: TimeZoneChoice[];
  /** The zone the typed times are currently read in. */
  value: string | null;
  /** The phone's own zone, offered back as a one-tap reset. */
  deviceZone: string | null;
  onSelect: (zone: string) => void;
  onClose: () => void;
}

/**
 * The list behind the composer's Timezone field: searchable, because a host
 * hunting for one city should not scroll a hundred rows, and sorted by offset
 * before it is filtered, so scanning by "how far from UTC" also works.
 *
 * It is a page sheet rather than an inline list so the composer's keyboard and
 * scroll position survive being opened — the same shape the comments sheet uses.
 */
export function TimeZonePickerSheet({
  visible,
  choices,
  value,
  deviceZone,
  onSelect,
  onClose,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  // Each open starts clean: the last search has nothing to do with this one.
  useEffect(() => {
    if (visible) setQuery('');
  }, [visible]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? choices.filter((row) => row.label.toLowerCase().includes(needle)) : choices;
  }, [choices, query]);

  const pick = (zone: string) => {
    hapticSelection();
    onSelect(zone);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.header,
            { paddingTop: insets.top + 10, borderBottomColor: colors.borderSubtle },
          ]}
        >
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Timezone</Text>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close timezone picker"
            style={styles.headerClose}
          >
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
        </View>

        <Text style={[styles.context, { color: colors.foregroundMuted }]}>
          The clock your event&apos;s start and end times are written on.
        </Text>

        <View style={[styles.searchRow, { borderBottomColor: colors.borderSubtle }]}>
          <Feather name="search" size={15} color={colors.foregroundMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="City or offset, e.g. Kolkata or UTC+5:30"
            placeholderTextColor={colors.foregroundSubtle}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {deviceZone && value !== deviceZone ? (
          <Pressable
            onPress={() => pick(deviceZone)}
            accessibilityRole="button"
            accessibilityLabel="Use the phone's own timezone"
            style={[styles.useDevice, { borderBottomColor: colors.borderSubtle }]}
          >
            <Feather name="smartphone" size={15} color={colors.accent} />
            <Text style={[styles.useDeviceText, { color: colors.accent }]}>
              Use this phone&apos;s timezone
            </Text>
          </Pressable>
        ) : null}

        <FlatList
          data={filtered}
          keyExtractor={(row) => row.zone}
          // Taps must land on the first try while the keyboard is still up.
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: colors.foregroundMuted }]}>
              No timezone matches that.
            </Text>
          }
          renderItem={({ item }) => {
            const selected = item.zone === value;
            return (
              <Pressable
                onPress={() => pick(item.zone)}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                accessibilityState={{ selected }}
                style={[
                  styles.row,
                  { borderBottomColor: colors.borderSubtle },
                  selected ? { backgroundColor: colors.surfaceRaised } : null,
                ]}
              >
                <Text
                  style={[
                    styles.rowLabel,
                    { color: selected ? colors.accent : colors.foreground },
                  ]}
                >
                  {item.label}
                </Text>
                {selected ? <Feather name="check" size={16} color={colors.accent} /> : null}
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '600' },
  headerClose: { padding: 4 },
  context: { fontSize: 12, paddingHorizontal: 16, paddingTop: 10 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 4 },
  useDevice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  useDeviceText: { fontSize: 14, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { flex: 1, fontSize: 15 },
  empty: { textAlign: 'center', fontSize: 14, paddingVertical: 24 },
});
