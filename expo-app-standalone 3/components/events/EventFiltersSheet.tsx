import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Palette } from '@/constants/colors';
import { useColors } from '@/hooks/useColors';
import type {
  CityEventDateFilter,
  CityEventPhase,
  CityEventTypeFilter,
} from '@/lib/cityEvents';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

interface FilterOption {
  value: string;
  label: string;
  icon: FeatherName;
}

const PHASE_OPTIONS: FilterOption[] = [
  { value: 'upcoming', label: 'Upcoming', icon: 'clock' },
  { value: 'past', label: 'Past', icon: 'check-circle' },
];

const TYPE_OPTIONS: FilterOption[] = [
  { value: 'all', label: 'All', icon: 'layers' },
  { value: 'online', label: 'Online', icon: 'video' },
  { value: 'in-person', label: 'In person', icon: 'map-pin' },
];

const DATE_OPTIONS: FilterOption[] = [
  { value: 'any', label: 'Any date', icon: 'calendar' },
  { value: 'today', label: 'Today', icon: 'check-square' },
  { value: 'week', label: 'This week', icon: 'calendar' },
  { value: 'month', label: 'This month', icon: 'calendar' },
];

/**
 * One group of single-choice rows, mirroring the web dropdown's rows: muted
 * group label, icon + label, and a check on the value in force.
 */
function OptionGroup({
  label,
  options,
  selected,
  onSelect,
  colors,
}: {
  label: string;
  options: FilterOption[];
  selected: string;
  onSelect: (value: string) => void;
  colors: Palette;
}) {
  return (
    <View style={styles.group}>
      <Text style={[styles.groupLabel, { color: colors.foregroundMuted }]}>{label}</Text>
      {options.map((option) => {
        const active = option.value === selected;
        return (
          <Pressable
            key={option.value}
            onPress={() => onSelect(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              styles.row,
              pressed && { backgroundColor: colors.surfaceRaised },
            ]}
          >
            <Feather name={option.icon} size={16} color={colors.foregroundMuted} />
            <Text
              style={[
                styles.rowLabel,
                {
                  color: colors.foreground,
                  fontFamily: active ? 'Geist_600SemiBold' : 'Geist_400Regular',
                },
              ]}
            >
              {option.label}
            </Text>
            {active ? <Feather name="check" size={16} color={colors.foreground} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

interface EventFiltersSheetProps {
  visible: boolean;
  phase: CityEventPhase;
  type: CityEventTypeFilter;
  date: CityEventDateFilter;
  counts: Record<CityEventPhase, number>;
  /** True when any group is away from its default. */
  active: boolean;
  onChangePhase: (value: CityEventPhase) => void;
  onChangeType: (value: CityEventTypeFilter) => void;
  onChangeDate: (value: CityEventDateFilter) => void;
  onReset: () => void;
  onClose: () => void;
}

/**
 * The mobile Events filter — the web page's Upcoming/Past chips and its Type
 * and Date dropdown rolled into one sheet, opened from the button beside the
 * page heading. Picks apply immediately and leave the sheet open so the
 * groups can be set together; Done simply dismisses it.
 */
export function EventFiltersSheet({
  visible,
  phase,
  type,
  date,
  counts,
  active,
  onChangePhase,
  onChangeType,
  onChangeDate,
  onReset,
  onClose,
}: EventFiltersSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const phaseOptions = PHASE_OPTIONS.map((option) => ({
    ...option,
    label: `${option.label} (${counts[option.value as CityEventPhase]})`,
  }));

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: colors.overlayElevated,
              borderColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={[styles.header, { borderBottomColor: colors.borderSubtle }]}>
            <Text style={[styles.title, { color: colors.foreground }]}>Filter events</Text>
            <View style={styles.headerActions}>
              {active ? (
                <Pressable
                  onPress={onReset}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Reset filters"
                >
                  <Text style={[styles.reset, { color: colors.foregroundMuted }]}>Reset</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={onClose}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Close filters"
              >
                <Feather name="x" size={18} color={colors.foregroundMuted} />
              </Pressable>
            </View>
          </View>

          <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
            <OptionGroup
              label="Status"
              options={phaseOptions}
              selected={phase}
              onSelect={(value) => onChangePhase(value as CityEventPhase)}
              colors={colors}
            />
            <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />
            <OptionGroup
              label="Type"
              options={TYPE_OPTIONS}
              selected={type}
              onSelect={(value) => onChangeType(value as CityEventTypeFilter)}
              colors={colors}
            />
            <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />
            <OptionGroup
              label="Date"
              options={DATE_OPTIONS}
              selected={date}
              onSelect={(value) => onChangeDate(value as CityEventDateFilter)}
              colors={colors}
            />
          </ScrollView>

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.done,
              { backgroundColor: pressed ? colors.accentHover : colors.accent },
            ]}
          >
            <Text style={[styles.doneText, { color: colors.accentForeground }]}>Done</Text>
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
    maxHeight: '82%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
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
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 15, fontFamily: 'Geist_600SemiBold' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  reset: { fontSize: 13, fontFamily: 'Geist_500Medium' },
  group: { paddingHorizontal: 8, paddingVertical: 8 },
  groupLabel: {
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 6,
    fontSize: 12,
    fontFamily: 'Geist_400Regular',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 42,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  rowLabel: { flex: 1, fontSize: 15 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 8 },
  done: {
    marginHorizontal: 16,
    marginTop: 8,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: { fontSize: 14, fontFamily: 'Geist_600SemiBold' },
});
