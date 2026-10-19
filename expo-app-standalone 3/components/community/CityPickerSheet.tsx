import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { hapticSelection } from '@/lib/haptics';
import type { CityOption } from '@/lib/cities';

/**
 * The event form's city picker — the web form's `<select>` as a searchable
 * sheet. The chosen city is what the city Events page lists the event under,
 * which is why the form asks for it whenever the event is public.
 *
 * Drawn as an overlay inside the composer's own modal: a nested `<Modal>`
 * dismisses the composer on Android.
 */
export function CityPickerSheet({
  visible,
  cities,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean;
  cities: CityOption[];
  value: string | null;
  onSelect: (cityId: string) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (visible) setQuery('');
  }, [visible]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return cities;
    return cities.filter((city) => city.name.toLowerCase().includes(needle));
  }, [cities, query]);

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close city picker">
        <Pressable
          style={[
            styles.sheet,
            { backgroundColor: colors.overlayElevated, paddingBottom: insets.bottom + 12 },
          ]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={[styles.header, { borderBottomColor: colors.borderSubtle }]}>
            <Text style={[styles.title, { color: colors.foreground }]}>Select city</Text>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close city picker"
            >
              <Feather name="x" size={18} color={colors.foregroundMuted} />
            </Pressable>
          </View>

          <View
            style={[
              styles.search,
              { backgroundColor: colors.inputBackground, borderColor: colors.borderSubtle },
            ]}
          >
            <Feather name="search" size={15} color={colors.foregroundSubtle} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search cities"
              placeholderTextColor={colors.foregroundSubtle}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.searchInput, { color: colors.foreground }]}
            />
          </View>

          <FlatList
            data={rows}
            keyExtractor={(city) => city.id}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const active = item.id === value;
              return (
                <Pressable
                  onPress={() => {
                    hapticSelection();
                    onSelect(item.id);
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    { backgroundColor: pressed ? colors.subtle : 'transparent' },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.rowText, { color: colors.foreground }]}>{item.name}</Text>
                  {active ? <Feather name="check" size={17} color={colors.accent} /> : null}
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: colors.foregroundSubtle }]}>
                No cities match “{query.trim()}”.
              </Text>
            }
          />
        </Pressable>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 60, elevation: 60 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    maxHeight: '72%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontFamily: 'Geist_600SemiBold', fontSize: 16 },
  closeButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  search: {
    marginTop: 12,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: { flex: 1, fontFamily: 'Geist_400Regular', fontSize: 15, paddingVertical: 8 },
  list: { marginTop: 8 },
  row: {
    minHeight: 50,
    borderRadius: 10,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowText: { fontFamily: 'Geist_500Medium', fontSize: 15 },
  empty: {
    fontFamily: 'Geist_400Regular',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 24,
  },
});
