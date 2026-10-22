import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CompanyMark } from '@/components/companies/CompanyMark';
import {
  JobFormFields,
  jobFormValuesFrom,
  type JobFormValues,
} from '@/components/jobs/JobFormFields';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { ScreenHeader } from '@/components/settings/ScreenHeader';
import { useColors } from '@/hooks/useColors';
import { hapticSuccess } from '@/lib/haptics';
import {
  ALL_CITIES,
  ALL_SECTORS,
  closingInstantFromDate,
  fetchJob,
  jobErrorMessage,
  jobKindLabel,
  loadJobMasterData,
  updateJob,
  type JobMasterData,
  type JobPost,
} from '@/lib/jobs';
import { hasMarkup, richTextToPlainText } from '@/lib/jobRichText';

/**
 * Editing a posting the member owns — the web EditJobModal port, as a screen.
 *
 * The post type and the company are shown but not editable: they are the
 * verified proof the posting was made under, and changing either one is a new
 * posting, not an edit. The four targeting fields lock once anyone has applied
 * (`criteria_locked`), and `update_job_post` refuses the change regardless.
 *
 * The description's stored formatting survives an edit that does not change
 * the words: the form compares the text against its prefill and sends the
 * original html back when nothing was typed.
 */
export default function EditJobScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [job, setJob] = useState<JobPost | null>(null);
  const [master, setMaster] = useState<JobMasterData | null>(null);
  const [values, setValues] = useState<JobFormValues | null>(null);
  const [originalDescription, setOriginalDescription] = useState('');
  const [originalPlain, setOriginalPlain] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  /** A refusal is announced at the top of the form; bring it into view. */
  const fail = (message: string) => {
    setError(message);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  async function load() {
    if (!id) return;
    setLoadError(null);
    try {
      const [nextJob, masterData] = await Promise.all([fetchJob(id), loadJobMasterData()]);
      if (!nextJob.is_mine) {
        setLoadError('Only the member who posted this job can edit it.');
        return;
      }
      const plain = richTextToPlainText(nextJob.description);
      setJob(nextJob);
      setMaster(masterData);
      setOriginalDescription(nextJob.description);
      setOriginalPlain(plain);
      setValues(jobFormValuesFrom(nextJob, plain));
    } catch (cause) {
      setLoadError(jobErrorMessage(cause, 'This job could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const patch = (next: Partial<JobFormValues>) =>
    setValues((current) => (current ? { ...current, ...next } : current));

  async function save() {
    if (submitting || !job || !values) return;

    if (values.title.trim().length < 2) {
      fail('Add a role title.');
      return;
    }
    if (!values.cityId || !values.sectorId || !values.jobTitle || !values.experienceLevel) {
      fail('Choose the city, sector, job title and experience level — they decide who can apply.');
      return;
    }
    if (!values.description.trim()) {
      fail('Add a role description.');
      return;
    }
    if (values.website.trim() && !/^https?:\/\/\S+$/i.test(values.website.trim())) {
      fail('Website must start with http(s)://');
      return;
    }
    if (values.closesAt && closingInstantFromDate(values.closesAt) === null) {
      fail('Enter a valid closing date.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await updateJob(job.id, {
        title: values.title.trim(),
        city_id: values.cityId === ALL_CITIES ? null : values.cityId,
        sector_id: values.sectorId === ALL_SECTORS ? null : values.sectorId,
        job_title: values.jobTitle,
        experience_level: values.experienceLevel,
        work_mode: values.workMode,
        employment_type: values.employmentType,
        salary: values.salary.trim(),
        // Unchanged words keep the stored html (and its formatting) intact.
        description:
          values.description.trim() === originalPlain.trim()
            ? originalDescription
            : values.description,
        website: values.website.trim(),
        closes_at: values.closesAt.trim(),
      });
      hapticSuccess();
      router.back();
    } catch (cause) {
      fail(jobErrorMessage(cause, 'The changes could not be saved. Please try again.'));
      setSubmitting(false);
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      <ScreenHeader title="Edit job" subtitle={job?.company.name} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : !job || !master || !values ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={28} color={colors.foregroundMuted} />
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>
            {loadError ?? 'This job could not be loaded.'}
          </Text>
          <Pressable onPress={() => router.back()} accessibilityRole="button">
            <Text style={[styles.retry, { color: colors.accent }]}>Back</Text>
          </Pressable>
        </View>
      ) : (
        <KeyboardAwareScrollViewCompat
          ref={scrollRef}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          {error ? (
            <View
              style={[
                styles.errorBox,
                { borderColor: 'rgba(229,72,77,0.30)', backgroundColor: 'rgba(229,72,77,0.10)' },
              ]}
            >
              <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
            </View>
          ) : null}

          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.label, { color: colors.foreground }]}>Posted under</Text>
            <View style={styles.companyRow}>
              <CompanyMark name={job.company.name} logoUrl={job.company.logo_url} size={32} />
              <View style={styles.companyText}>
                <Text style={[styles.companyName, { color: colors.foreground }]} numberOfLines={1}>
                  {job.company.name}
                </Text>
                <Text style={[styles.companyNote, { color: colors.foregroundMuted }]}>
                  {jobKindLabel(job.kind)} — the post type and company can’t change. Post a new
                  role instead.
                </Text>
              </View>
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <JobFormFields
              values={values}
              onChange={patch}
              master={master}
              criteriaLocked={job.criteria_locked}
              descriptionIsFormatted={hasMarkup(originalDescription)}
            />
          </View>

          <View style={styles.footerActions}>
            <Pressable
              onPress={() => router.back()}
              disabled={submitting}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.secondaryButton,
                {
                  borderColor: colors.border,
                  backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
                },
              ]}
            >
              <Text style={[styles.secondaryText, { color: colors.foreground }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => void save()}
              disabled={submitting}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: pressed ? colors.accentHover : colors.accent,
                  opacity: submitting ? 0.7 : 1,
                },
              ]}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={colors.accentForeground} />
              ) : (
                <>
                  <Feather name="save" size={14} color={colors.accentForeground} />
                  <Text style={[styles.primaryText, { color: colors.accentForeground }]}>
                    Save changes
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        </KeyboardAwareScrollViewCompat>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 14 },
  center: {
    flex: 1,
    minHeight: 300,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 32,
  },
  stateTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 15, textAlign: 'center' },
  retry: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 10,
  },
  label: { fontFamily: 'Geist_500Medium', fontSize: 12 },
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  companyText: { flex: 1, gap: 2 },
  companyName: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  companyNote: { fontFamily: 'Geist_400Regular', fontSize: 11, lineHeight: 16 },
  footerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingTop: 4 },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minWidth: 140,
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 16,
  },
  primaryText: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  secondaryButton: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  secondaryText: { fontFamily: 'Geist_500Medium', fontSize: 14 },
  errorBox: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  errorText: { fontFamily: 'Geist_400Regular', fontSize: 12.5, lineHeight: 18 },
});
