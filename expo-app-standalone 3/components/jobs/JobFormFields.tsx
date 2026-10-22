import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { EventDatePickerSheet, formatDateStamp } from '@/components/community/EventDateTimePicker';
import { OptionPickerSheet, type PickerOption } from '@/components/settings/OptionPickerSheet';
import { useColors } from '@/hooks/useColors';
import { hapticSelection } from '@/lib/haptics';
import {
  ALL_CITIES,
  ALL_SECTORS,
  EMPLOYMENT_TYPES,
  WORK_MODES,
  closingDateFromInstant,
  type EmploymentType,
  type JobMasterData,
  type JobPost,
  type WorkMode,
} from '@/lib/jobs';

export interface JobFormValues {
  title: string;
  /** A city id, ALL_CITIES, or '' while unchosen. */
  cityId: string;
  /** A sector id, ALL_SECTORS, or '' while unchosen. */
  sectorId: string;
  jobTitle: string;
  experienceLevel: string;
  workMode: WorkMode;
  employmentType: EmploymentType;
  salary: string;
  description: string;
  website: string;
  /** A plain date, '' for no deadline. */
  closesAt: string;
}

export const EMPTY_JOB_FORM: JobFormValues = {
  title: '',
  cityId: '',
  sectorId: '',
  jobTitle: '',
  experienceLevel: '',
  workMode: 'hybrid',
  employmentType: 'full_time',
  salary: '',
  description: '',
  website: '',
  closesAt: '',
};

/** A stored posting as the edit form opens on it. */
export function jobFormValuesFrom(job: JobPost, descriptionText: string): JobFormValues {
  return {
    title: job.title,
    cityId: job.city_id ?? ALL_CITIES,
    sectorId: job.sector_id ?? ALL_SECTORS,
    jobTitle: job.job_title,
    experienceLevel: job.experience_level,
    workMode: job.work_mode,
    employmentType: job.employment_type,
    salary: job.salary ?? '',
    description: descriptionText,
    website: job.website ?? '',
    closesAt: job.closes_at ? closingDateFromInstant(job.closes_at) : '',
  };
}

type PickerKey = 'city' | 'sector' | 'jobTitle' | 'experienceLevel';

/**
 * The role fields, shared by Post and Edit so the two surfaces can never
 * drift. The four targeting fields lock once anyone has applied — the form
 * only reflects the payload's `criteria_locked`; `update_job_post` enforces it.
 *
 * The description is a plain multiline field on mobile. The web editor's
 * formatting is preserved on an edit that does not change the words (the
 * edit screen sends the stored html back untouched); typing replaces it with
 * plain text, which the server stores in the same canonical form.
 */
export function JobFormFields({
  values,
  onChange,
  master,
  criteriaLocked = false,
  descriptionIsFormatted = false,
}: {
  values: JobFormValues;
  onChange: (patch: Partial<JobFormValues>) => void;
  master: JobMasterData;
  criteriaLocked?: boolean;
  /** True when the prefill came from stored html rather than plain text. */
  descriptionIsFormatted?: boolean;
}) {
  const colors = useColors();
  const [picker, setPicker] = useState<PickerKey | null>(null);
  const [dateOpen, setDateOpen] = useState(false);

  const cityOptions: PickerOption[] = [
    { id: ALL_CITIES, name: 'All cities', image_url: null },
    ...master.cities.map((city) => ({ id: city.id, name: city.name, image_url: city.imageUrl })),
  ];
  const sectorOptions: PickerOption[] = [
    { id: ALL_SECTORS, name: 'All sectors', image_url: null },
    ...master.sectors.map((sector) => ({
      id: sector.id,
      name: sector.name,
      image_url: sector.imageUrl,
    })),
  ];
  const titleOptions: PickerOption[] = master.jobTitles.map((title) => ({
    id: title.slug,
    name: title.label,
    image_url: title.imageUrl,
  }));
  const levelOptions: PickerOption[] = master.experienceLevels.map((level) => ({
    id: level.slug,
    name: level.label,
    image_url: level.imageUrl,
  }));

  const cityLabel = cityOptions.find((option) => option.id === values.cityId)?.name ?? '';
  const sectorLabel = sectorOptions.find((option) => option.id === values.sectorId)?.name ?? '';
  const titleLabel = titleOptions.find((option) => option.id === values.jobTitle)?.name ?? '';
  const levelLabel = levelOptions.find((option) => option.id === values.experienceLevel)?.name ?? '';

  const pickerConfig: Record<
    PickerKey,
    { title: string; options: PickerOption[]; selectedId: string | null; onPick: (option: PickerOption) => void }
  > = {
    city: {
      title: 'City',
      options: cityOptions,
      selectedId: values.cityId || null,
      onPick: (option) => {
        onChange({ cityId: option.id });
        setPicker(null);
      },
    },
    sector: {
      title: 'Industry sector',
      options: sectorOptions,
      selectedId: values.sectorId || null,
      onPick: (option) => {
        onChange({ sectorId: option.id });
        setPicker(null);
      },
    },
    jobTitle: {
      title: 'Job title',
      options: titleOptions,
      selectedId: values.jobTitle || null,
      onPick: (option) => {
        onChange({ jobTitle: option.id });
        setPicker(null);
      },
    },
    experienceLevel: {
      title: 'Experience level',
      options: levelOptions,
      selectedId: values.experienceLevel || null,
      onPick: (option) => {
        onChange({ experienceLevel: option.id });
        setPicker(null);
      },
    },
  };

  const currentPicker = picker ? pickerConfig[picker] : null;

  return (
    <>
      <Field label="Role title" required colors={colors}>
        <TextInput
          value={values.title}
          onChangeText={(title) => onChange({ title })}
          placeholder="e.g. Senior Product Designer — Payments"
          placeholderTextColor={colors.foregroundSubtle}
          maxLength={140}
          style={inputStyle(colors)}
        />
      </Field>

      <Field label="About the role" required colors={colors}>
        <TextInput
          value={values.description}
          onChangeText={(description) => onChange({ description })}
          placeholder="What the team does, why this role exists, how you work…"
          placeholderTextColor={colors.foregroundSubtle}
          multiline
          textAlignVertical="top"
          style={[
            inputStyle(colors),
            styles.description,
          ]}
        />
        <Text style={[styles.hint, { color: colors.foregroundSubtle }]}>
          {descriptionIsFormatted
            ? 'Line breaks are kept. The stored formatting stays unless you change this text.'
            : 'Line breaks are kept. The web app adds headings and lists.'}
        </Text>
      </Field>

      <View style={styles.pair}>
        <Field label="Work mode" colors={colors} style={styles.pairItem}>
          <View style={styles.pills}>
            {WORK_MODES.map((mode) => {
              const active = values.workMode === mode.value;
              return (
                <Pressable
                  key={mode.value}
                  onPress={() => {
                    hapticSelection();
                    onChange({ workMode: mode.value });
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.pill,
                    {
                      borderColor: active ? colors.foreground : colors.border,
                      backgroundColor: active ? colors.foreground : 'transparent',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.pillText,
                      { color: active ? colors.background : colors.foregroundMuted },
                    ]}
                  >
                    {mode.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Field>
      </View>
      <Field label="Employment type" colors={colors}>
        <View style={styles.pills}>
          {EMPLOYMENT_TYPES.map((type) => {
            const active = values.employmentType === type.value;
            return (
              <Pressable
                key={type.value}
                onPress={() => {
                  hapticSelection();
                  onChange({ employmentType: type.value });
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[
                  styles.pill,
                  {
                    borderColor: active ? colors.foreground : colors.border,
                    backgroundColor: active ? colors.foreground : 'transparent',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.pillText,
                    { color: active ? colors.background : colors.foregroundMuted },
                  ]}
                >
                  {type.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Field>

      <View style={styles.criteriaHeader}>
        <Text style={[styles.label, { color: colors.foreground }]}>
          Who can apply <Text style={{ color: colors.destructive }}>*</Text>
        </Text>
        <Text style={[styles.hint, { color: colors.foregroundSubtle }]}>
          {criteriaLocked
            ? 'Locked — members have applied, and these criteria decide who could. Reopen them by posting a new role.'
            : 'Members must match the job title and experience level; the city and sector match too unless they are set to All.'}
        </Text>
      </View>

      <View style={[styles.grid, criteriaLocked ? styles.lockedFields : null]}>
        <SelectField
          label="City"
          value={cityLabel}
          placeholder="City"
          disabled={criteriaLocked}
          onPress={() => setPicker('city')}
        />
        <SelectField
          label="Industry sector"
          value={sectorLabel}
          placeholder="Industry sector"
          disabled={criteriaLocked}
          onPress={() => setPicker('sector')}
        />
        <SelectField
          label="Job title"
          value={titleLabel}
          placeholder="Job title"
          disabled={criteriaLocked}
          onPress={() => setPicker('jobTitle')}
        />
        <SelectField
          label="Experience level"
          value={levelLabel}
          placeholder="Experience level"
          disabled={criteriaLocked}
          onPress={() => setPicker('experienceLevel')}
        />
      </View>

      <Field label="Salary (optional)" colors={colors}>
        <TextInput
          value={values.salary}
          onChangeText={(salary) => onChange({ salary })}
          placeholder="e.g. ₹18–24L / year — leave empty for “Not disclosed”"
          placeholderTextColor={colors.foregroundSubtle}
          maxLength={80}
          style={inputStyle(colors)}
        />
      </Field>

      <Field label="Website (optional)" colors={colors}>
        <TextInput
          value={values.website}
          onChangeText={(website) => onChange({ website })}
          placeholder="https://…"
          placeholderTextColor={colors.foregroundSubtle}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={inputStyle(colors)}
        />
      </Field>

      <Field label="Closing date (optional)" colors={colors}>
        <View style={styles.dateRow}>
          <Pressable
            onPress={() => {
              hapticSelection();
              setDateOpen(true);
            }}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.select,
              {
                borderColor: colors.inputBorder,
                backgroundColor: pressed ? colors.surfaceRaised : colors.inputBackground,
              },
            ]}
          >
            <Feather name="calendar" size={14} color={colors.foregroundMuted} />
            <Text
              style={[
                styles.selectText,
                { color: values.closesAt ? colors.foreground : colors.foregroundSubtle },
              ]}
            >
              {values.closesAt ? formatDateStamp(values.closesAt) : 'No deadline'}
            </Text>
          </Pressable>
          {values.closesAt ? (
            <Pressable
              onPress={() => onChange({ closesAt: '' })}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.clearDate,
                { borderColor: colors.border, backgroundColor: pressed ? colors.surfaceRaised : 'transparent' },
              ]}
            >
              <Text style={[styles.clearDateText, { color: colors.foregroundMuted }]}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={[styles.hint, { color: colors.foregroundSubtle }]}>
          Applications stop at the end of this day. Leave it empty to keep the role open until you
          close it, or set a new date to reopen an expired one.
        </Text>
      </Field>

      {currentPicker ? (
        <OptionPickerSheet
          visible
          title={currentPicker.title}
          options={currentPicker.options}
          selectedId={currentPicker.selectedId}
          onPick={currentPicker.onPick}
          onClose={() => setPicker(null)}
        />
      ) : null}

      <Modal
        transparent
        animationType="fade"
        visible={dateOpen}
        onRequestClose={() => setDateOpen(false)}
      >
        <View style={styles.dateModal}>
          <EventDatePickerSheet
            visible
            value={values.closesAt}
            onSelect={(stamp) => {
              onChange({ closesAt: stamp });
              setDateOpen(false);
            }}
            onClose={() => setDateOpen(false)}
          />
        </View>
      </Modal>
    </>
  );
}

function Field({
  label,
  required,
  children,
  colors,
  style,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  colors: ReturnType<typeof useColors>;
  style?: object;
}) {
  return (
    <View style={[styles.field, style]}>
      <Text style={[styles.label, { color: colors.foreground }]}>
        {label} {required ? <Text style={{ color: colors.destructive }}>*</Text> : null}
      </Text>
      {children}
    </View>
  );
}

function SelectField({
  label,
  value,
  placeholder,
  disabled,
  onPress,
}: {
  label: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        hapticSelection();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.select,
        {
          borderColor: colors.inputBorder,
          backgroundColor: pressed && !disabled ? colors.surfaceRaised : colors.inputBackground,
        },
      ]}
    >
      <Text
        style={[
          styles.selectText,
          { color: value ? colors.foreground : colors.foregroundSubtle },
        ]}
        numberOfLines={1}
      >
        {value || placeholder}
      </Text>
      <Feather name="chevron-down" size={14} color={colors.foregroundMuted} />
    </Pressable>
  );
}

function inputStyle(colors: ReturnType<typeof useColors>) {
  return [
    styles.input,
    {
      color: colors.foreground,
      borderColor: colors.inputBorder,
      backgroundColor: colors.inputBackground,
    },
  ];
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  pair: { flexDirection: 'row', gap: 12 },
  pairItem: { flex: 1 },
  label: { fontFamily: 'Geist_500Medium', fontSize: 12 },
  hint: { fontFamily: 'Geist_400Regular', fontSize: 11, lineHeight: 16 },
  input: {
    minHeight: 42,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'Geist_400Regular',
    fontSize: 14,
  },
  description: { minHeight: 140 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pillText: { fontFamily: 'Geist_500Medium', fontSize: 12.5 },
  criteriaHeader: { gap: 4, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  lockedFields: { opacity: 0.55 },
  select: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 140,
    height: 42,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectText: { flex: 1, fontFamily: 'Geist_400Regular', fontSize: 13.5 },
  dateRow: { flexDirection: 'row', gap: 8 },
  clearDate: {
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  clearDateText: { fontFamily: 'Geist_500Medium', fontSize: 12.5 },
  dateModal: { flex: 1 },
});
