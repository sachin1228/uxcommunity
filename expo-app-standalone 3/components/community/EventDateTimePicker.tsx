import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { hapticSelection } from '@/lib/haptics';

/**
 * The event form's date and time pickers.
 *
 * The web form uses the browser's native date and time inputs; a phone has no
 * such input, so these sheets stand in with the same contract: a plain
 * calendar day ("YYYY-MM-DD") and a plain wall clock ("HH:MM"). The event
 * editor is the only reader of either value, and it converts them to an
 * instant in the device's own zone exactly as the web form does.
 */

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const HOURS = Array.from({ length: 24 }, (_, index) => index);
const MINUTES = Array.from({ length: 60 }, (_, index) => index);
const TIME_ROW_HEIGHT = 40;

const pad = (value: number) => String(value).padStart(2, '0');

export function dateStamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDateStamp(stamp: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(stamp);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A date stamp shifted by whole days, pure UTC calendar math. */
export function addDaysToStamp(stamp: string, days: number): string {
  const date = parseDateStamp(stamp);
  if (!date) return stamp;
  const shifted = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate() + days));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** Whole days from one stamp to another (to − from). */
export function daysBetweenStamps(from: string, to: string): number {
  const day = (stamp: string) => {
    const date = parseDateStamp(stamp);
    return date ? Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000 : NaN;
  };
  return day(to) - day(from);
}

/** "Sat, 15 Aug 2026" — how the closed date field reads. */
export function formatDateStamp(stamp: string): string {
  const date = parseDateStamp(stamp);
  if (!date) return stamp;
  return date.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** "6:30 PM" — how the closed time field reads. */
export function formatTimeValue(value: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return value;
  const hour = Number(match[1]);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${match[2]} ${suffix}`;
}

function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

interface SheetShellProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

function SheetShell({ visible, title, onClose, children }: SheetShellProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  // A plain overlay inside the editor's own full-screen modal. A nested
  // <Modal> here dismisses the composer on Android the moment it presents, so
  // the sheet is drawn above the form instead of opening a second window.
  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close picker">
        <Pressable
          style={[
            styles.sheet,
            { backgroundColor: colors.overlayElevated, paddingBottom: insets.bottom + 12 },
          ]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={[styles.sheetHeader, { borderBottomColor: colors.borderSubtle }]}>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>{title}</Text>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close picker"
            >
              <Feather name="x" size={18} color={colors.foregroundMuted} />
            </Pressable>
          </View>
          {children}
        </Pressable>
      </Pressable>
    </View>
  );
}

export function EventDatePickerSheet({
  visible,
  value,
  min,
  onSelect,
  onClose,
}: {
  visible: boolean;
  value: string;
  /** Earliest selectable day ("YYYY-MM-DD"); days before it are disabled. */
  min?: string;
  onSelect: (stamp: string) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const [anchor, setAnchor] = useState(() => monthStart(parseDateStamp(value) ?? new Date()));

  useEffect(() => {
    if (visible) setAnchor(monthStart(parseDateStamp(value) ?? new Date()));
  }, [visible, value]);

  const cells = useMemo(() => {
    const year = anchor.getFullYear();
    const month = anchor.getMonth();
    const lead = new Date(year, month, 1).getDay();
    const total = new Date(year, month + 1, 0).getDate();
    const rows: Array<number | null> = Array.from({ length: lead }, () => null);
    for (let day = 1; day <= total; day += 1) rows.push(day);
    while (rows.length % 7 !== 0) rows.push(null);
    return rows;
  }, [anchor]);

  const today = dateStamp(new Date());
  const monthLabel = `${MONTH_NAMES[anchor.getMonth()]} ${anchor.getFullYear()}`;

  const shiftMonth = (delta: number) => {
    hapticSelection();
    setAnchor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  };

  return (
    <SheetShell visible={visible} title="Select date" onClose={onClose}>
      <View style={styles.monthRow}>
        <Pressable
          onPress={() => shiftMonth(-1)}
          hitSlop={10}
          style={styles.monthButton}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
        >
          <Feather name="chevron-left" size={20} color={colors.foregroundMuted} />
        </Pressable>
        <Text style={[styles.monthLabel, { color: colors.foreground }]}>{monthLabel}</Text>
        <Pressable
          onPress={() => shiftMonth(1)}
          hitSlop={10}
          style={styles.monthButton}
          accessibilityRole="button"
          accessibilityLabel="Next month"
        >
          <Feather name="chevron-right" size={20} color={colors.foregroundMuted} />
        </Pressable>
      </View>

      <View style={styles.weekdayRow}>
        {WEEKDAY_LABELS.map((label, index) => (
          <Text
            key={`${label}-${index}`}
            style={[styles.weekday, { color: colors.foregroundSubtle }]}
          >
            {label}
          </Text>
        ))}
      </View>

      <View style={styles.dayGrid}>
        {cells.map((day, index) => {
          if (day === null) return <View key={`blank-${index}`} style={styles.dayCell} />;
          const stamp = `${anchor.getFullYear()}-${pad(anchor.getMonth() + 1)}-${pad(day)}`;
          const disabled = Boolean(min && stamp < min);
          const selected = stamp === value;
          const isToday = stamp === today;
          return (
            <Pressable
              key={stamp}
              style={styles.dayCell}
              disabled={disabled}
              onPress={() => {
                hapticSelection();
                onSelect(stamp);
              }}
              accessibilityRole="button"
              accessibilityState={{ disabled, selected }}
              accessibilityLabel={formatDateStamp(stamp)}
            >
              <View
                style={[
                  styles.dayCircle,
                  selected ? { backgroundColor: colors.accent } : null,
                  !selected && isToday ? { borderColor: colors.border, borderWidth: 1 } : null,
                ]}
              >
                <Text
                  style={[
                    styles.dayText,
                    {
                      color: disabled
                        ? colors.foregroundSubtle
                        : selected
                          ? colors.accentForeground
                          : colors.foreground,
                      opacity: disabled ? 0.4 : 1,
                    },
                  ]}
                >
                  {day}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </SheetShell>
  );
}

function TimeColumn({
  visible,
  label,
  values,
  selected,
  onSelect,
}: {
  visible: boolean;
  label: string;
  values: number[];
  selected: number;
  onSelect: (value: number) => void;
}) {
  const colors = useColors();
  const listRef = useRef<FlatList<number>>(null);
  const selectedIndex = Math.max(0, values.indexOf(selected));

  useEffect(() => {
    if (!visible) return;
    // The sheet stays mounted between opens; bring the chosen row back into
    // view rather than leaving whatever the last open scrolled to.
    const timer = setTimeout(() => {
      listRef.current?.scrollToOffset({
        offset: Math.max(0, selectedIndex * TIME_ROW_HEIGHT),
        animated: false,
      });
    }, 0);
    return () => clearTimeout(timer);
    // Only on open — picking a row must not shuffle the column under the thumb.
  }, [visible]);

  return (
    <View style={styles.timeColumn}>
      <Text style={[styles.timeColumnLabel, { color: colors.foregroundSubtle }]}>{label}</Text>
      <FlatList
        ref={listRef}
        data={values}
        keyExtractor={(value) => String(value)}
        showsVerticalScrollIndicator={false}
        getItemLayout={(_, index) => ({
          length: TIME_ROW_HEIGHT,
          offset: TIME_ROW_HEIGHT * index,
          index,
        })}
        style={styles.timeList}
        renderItem={({ item }) => {
          const active = item === selected;
          return (
            <Pressable
              onPress={() => {
                hapticSelection();
                onSelect(item);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[
                styles.timeRow,
                active ? { backgroundColor: colors.accentSoft } : null,
              ]}
            >
              <Text
                style={[
                  styles.timeRowText,
                  { color: active ? colors.foreground : colors.foregroundMuted },
                ]}
              >
                {pad(item)}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

export function EventTimePickerSheet({
  visible,
  value,
  title = 'Select time',
  onSelect,
  onClose,
}: {
  visible: boolean;
  value: string;
  title?: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  // An empty field opens on a sensible evening slot; nothing is committed
  // until Done, so the prefill never becomes the answer by accident.
  const initial = /^\d{2}:\d{2}$/.test(value) ? value : '18:00';
  const [hour, setHour] = useState(() => Number(initial.slice(0, 2)));
  const [minute, setMinute] = useState(() => Number(initial.slice(3, 5)));

  useEffect(() => {
    if (!visible) return;
    const next = /^\d{2}:\d{2}$/.test(value) ? value : '18:00';
    setHour(Number(next.slice(0, 2)));
    setMinute(Number(next.slice(3, 5)));
  }, [visible, value]);

  return (
    <SheetShell visible={visible} title={title} onClose={onClose}>
      <View style={styles.timeColumns}>
        <TimeColumn visible={visible} label="Hour" values={HOURS} selected={hour} onSelect={setHour} />
        <TimeColumn visible={visible} label="Minute" values={MINUTES} selected={minute} onSelect={setMinute} />
      </View>
      <Pressable
        onPress={() => {
          hapticSelection();
          onSelect(`${pad(hour)}:${pad(minute)}`);
        }}
        style={[styles.doneButton, { backgroundColor: colors.accent }]}
        accessibilityRole="button"
        accessibilityLabel="Done"
      >
        <Text style={[styles.doneText, { color: colors.accentForeground }]}>
          Done — {formatTimeValue(`${pad(hour)}:${pad(minute)}`)}
        </Text>
      </Pressable>
    </SheetShell>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 60, elevation: 60 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 14,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 16 },
  closeButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },

  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  monthButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  monthLabel: { fontFamily: 'Geist_600SemiBold', fontSize: 15 },
  weekdayRow: { flexDirection: 'row', paddingBottom: 6 },
  weekday: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    fontFamily: 'Geist_500Medium',
    fontSize: 11,
  },
  dayGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: {
    width: `${100 / 7}%`,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayText: { fontFamily: 'Geist_500Medium', fontSize: 14 },

  timeColumns: { flexDirection: 'row', gap: 12, paddingTop: 12 },
  timeColumn: { flex: 1, gap: 6 },
  timeColumnLabel: {
    fontFamily: 'Geist_500Medium',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
  },
  timeList: { height: TIME_ROW_HEIGHT * 5, borderRadius: 12 },
  timeRow: {
    height: TIME_ROW_HEIGHT,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeRowText: { fontFamily: 'Geist_500Medium', fontSize: 15 },
  doneButton: {
    marginTop: 16,
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: { fontFamily: 'Geist_600SemiBold', fontSize: 15 },
});
