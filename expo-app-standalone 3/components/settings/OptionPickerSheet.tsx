import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type StyleProp,
  type TextStyle,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { KeyboardAvoidingView as KeyboardControllerAvoidingView } from 'react-native-keyboard-controller';
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
 * The picture half of an option, used by both the sheet rows and the closed
 * field: the master-data image, or — matching the web SearchableSelect — the
 * value's initial when the row has no picture.
 */
function OptionMark({ option, size }: { option: PickerOption; size: number }) {
  const colors = useColors();
  const uri = resolveProfilePictureUri(option.image_url);
  const box = { width: size, height: size, borderRadius: size / 2 };

  if (uri) return <Image source={{ uri }} style={box} />;

  return (
    <View style={[styles.optionMarkFallback, box, { backgroundColor: colors.surfaceRaised }]}>
      <Text
        style={[
          styles.optionMarkInitial,
          { color: colors.mutedForeground, fontSize: Math.round(size * 0.46) },
        ]}
      >
        {option.name[0]?.toUpperCase() ?? '?'}
      </Text>
    </View>
  );
}

/**
 * The closed picker field's contents — the selected option's picture, its
 * name and the caret. The field itself stays with each form (their heights,
 * radii and surfaces differ), so all four master-data dropdowns in the app
 * show the same mark and truncation without a parallel Pressable to keep in
 * sync.
 */
export function OptionPickerValue({
  option,
  placeholder,
  textStyle,
  chevronSize = 16,
}: {
  option: PickerOption | null;
  placeholder: string;
  textStyle?: StyleProp<TextStyle>;
  chevronSize?: number;
}) {
  const colors = useColors();

  return (
    <>
      {option ? <OptionMark option={option} size={20} /> : null}
      <Text
        style={[
          styles.fieldText,
          { color: option ? colors.foreground : colors.mutedForeground },
          textStyle,
        ]}
        numberOfLines={1}
      >
        {option?.name ?? placeholder}
      </Text>
      <Feather name="chevron-down" size={chevronSize} color={colors.mutedForeground} />
    </>
  );
}

/**
 * The identity editor's option picker — a bottom sheet with a search field
 * (only when the list is long enough to need one) and one row per master-data
 * value. Mirrors the web SearchableSelect's behavior: the picked value
 * replaces the field's value; the sheet itself holds no selection state.
 *
 * The sheet hugs its content up to 78% of the screen and is lifted above the
 * keyboard — a `Modal` is its own window on Android, so the activity's
 * resize-to-keyboard mode does not reach it and the keyboard controller is
 * used there, exactly like the other modals in the app. The close button sits
 * in the header, the same place as the app's other sheets: a Cancel row at the
 * bottom of a content-sized sheet was left stranded under a one-result list.
 */
export function OptionPickerSheet({ visible, title, options, selectedId, onPick, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  // A filter left behind from the previous field must not apply to the next
  // one (city → sector); the sheet is closed between picks.
  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => option.name.toLowerCase().includes(q));
  }, [options, query]);

  const showSearch = options.length > 8;

  const panel = (
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
          <Text
            style={[styles.title, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {title}
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close picker"
            style={styles.closeButton}
          >
            <Feather name="x" size={18} color={colors.mutedForeground} />
          </Pressable>
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
          // Bounded by the sheet's maxHeight; without shrinking, a long list
          // only clips at the rounded edge instead of scrolling.
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={({ item }) => {
            const selected = item.id === selectedId;
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
                <OptionMark option={item} size={26} />
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
      </Pressable>
    </Pressable>
  );

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      {Platform.OS === 'android' ? (
        <KeyboardControllerAvoidingView style={styles.flex} behavior="height">
          {panel}
        </KeyboardControllerAvoidingView>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          {panel}
        </KeyboardAvoidingView>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    // Content-sized, capped at most of the screen; the list shrinks and
    // scrolls inside that cap when it is long.
    maxHeight: '78%',
    flexShrink: 1,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1, fontSize: 15, fontFamily: 'Geist_600SemiBold' },
  closeButton: { padding: 2 },
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
  // Shrinks when the list would run past the sheet's cap, so it scrolls
  // instead of clipping at the rounded edge.
  list: { flexShrink: 1, marginTop: 6 },
  listContent: { paddingBottom: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  optionMarkFallback: { alignItems: 'center', justifyContent: 'center' },
  optionMarkInitial: { fontFamily: 'Geist_600SemiBold' },
  rowLabel: { flex: 1, fontSize: 15 },
  fieldText: { flex: 1 },
  empty: { padding: 24, textAlign: 'center', fontSize: 13, fontFamily: 'Geist_400Regular' },
});
