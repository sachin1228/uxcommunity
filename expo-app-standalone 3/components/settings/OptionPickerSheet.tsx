import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { resolveProfilePictureUri } from '@/lib/profilePicture';
import { hapticSelection } from '@/lib/haptics';

export interface PickerOption {
  id: string;
  name: string;
  image_url: string | null;
}

interface Props {
  visible: boolean;
  title: string;
  options: PickerOption[];
  selectedId: string | null;
  onPick: (option: PickerOption) => void;
  onClose: () => void;
}

/**
 * The identity editor's option picker — a bottom sheet with a search field
 * (only when the list is long enough to need one) and one row per master-data
 * value. Mirrors the web SearchableSelect's behavior: the picked value
 * replaces the field's value; the sheet itself holds no selection state.
 */
export function OptionPickerSheet({ visible, title, options, selectedId, onPick, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => option.name.toLowerCase().includes(q));
  }, [options, query]);

  const showSearch = options.length > 8;

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
          </View>

          {showSearch ? (
            <View style={[styles.searchBox, { backgroundColor: colors.surfaceRaised }]}>
              <Feather name="search" size={14} color={colors.mutedForeground} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.searchInput, { color: colors.foreground }]}
              />
            </View>
          ) : null}

          <FlatList
            data={filtered}
            keyExtractor={(option) => option.id}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const selected = item.id === selectedId;
              const uri = resolveProfilePictureUri(item.image_url);
              return (
                <Pressable
                  onPress={() => {
                    hapticSelection();
                    onPick(item);
                  }}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.row,
                    { backgroundColor: pressed ? colors.surfaceRaised : 'transparent' },
                  ]}
                >
                  {uri ? (
                    <Image source={{ uri }} style={styles.rowImage} />
                  ) : (
                    <View style={[styles.rowImage, styles.rowImageFallback, { backgroundColor: colors.surfaceRaised }]}>
                      <Text style={[styles.rowInitial, { color: colors.mutedForeground }]}>
                        {item.name[0]?.toUpperCase() ?? '?'}
                      </Text>
                    </View>
                  )}
                  <Text
                    style={[
                      styles.rowLabel,
                      { color: colors.foreground, fontFamily: selected ? 'Geist_600SemiBold' : 'Geist_400Regular' },
                    ]}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  {selected ? <Feather name="check" size={16} color={colors.accent} /> : null}
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: colors.mutedForeground }]}>No matches</Text>
            }
          />

          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.cancelRow,
              { backgroundColor: pressed ? colors.surfaceRaised : 'transparent' },
            ]}
          >
            <Text style={[styles.cancelLabel, { color: colors.mutedForeground }]}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    maxHeight: '78%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 4,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -4 },
    elevation: 16,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 15, fontFamily: 'Geist_600SemiBold' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Geist_400Regular', paddingVertical: 8 },
  list: { marginTop: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  rowImage: { width: 26, height: 26, borderRadius: 13 },
  rowImageFallback: { alignItems: 'center', justifyContent: 'center' },
  rowInitial: { fontSize: 12, fontFamily: 'Geist_600SemiBold' },
  rowLabel: { flex: 1, fontSize: 15 },
  empty: { padding: 24, textAlign: 'center', fontSize: 13, fontFamily: 'Geist_400Regular' },
  divider: { height: StyleSheet.hairlineWidth },
  cancelRow: { paddingVertical: 15, alignItems: 'center' },
  cancelLabel: { fontSize: 14, fontFamily: 'Geist_500Medium' },
});
