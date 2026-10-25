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
  useWindowDimensions,
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
 * The sheet is sized to its content between a floor and a ceiling rather than
 * collapsing to whatever the list happens to contain: searching "pune" leaves
 * a single row, and a sheet that shrank to that row used to end up behind the
 * keyboard, leaving nothing visible at all. It is also lifted above the
 * keyboard — a `Modal` is its own window on Android, so the activity's
 * resize-to-keyboard mode does not reach it and the keyboard controller is
 * used there, exactly like the other modals in the app.
 */
export function OptionPickerSheet({ visible, title, options, selectedId, onPick, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
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

  // Enough room to read and scroll the list, without growing past most of the
  // screen when the list is long.
  const sheetMinHeight = Math.min(Math.round(windowHeight * 0.42), 360);
  const sheetMaxHeight = Math.round(windowHeight * 0.78);

  const panel = (
    <Pressable style={styles.backdrop} onPress={onClose}>
      <Pressable
        style={[
          styles.sheet,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            paddingBottom: Math.max(insets.bottom, 12),
            minHeight: sheetMinHeight,
            maxHeight: sheetMaxHeight,
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
          // Bounded by the sheet's maxHeight; without shrinking, a long list
          // only clips at the divider instead of scrolling.
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
    // Keeps the sheet on screen when the keyboard leaves less room than the
    // minimum height it would otherwise insist on.
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
  // Grows into the sheet's minimum height and shrinks when the list would run
  // past its maximum, so the divider and Cancel row stay pinned to the bottom.
  list: { flexGrow: 1, flexShrink: 1, marginTop: 6 },
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
  divider: { height: StyleSheet.hairlineWidth },
  cancelRow: { paddingVertical: 15, alignItems: 'center' },
  cancelLabel: { fontSize: 14, fontFamily: 'Geist_500Medium' },
});
