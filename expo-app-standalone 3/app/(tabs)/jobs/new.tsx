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
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddCompanyModal } from '@/components/companies/AddCompanyModal';
import { CompanyMark, CompanyVerifiedMark } from '@/components/companies/CompanyMark';
import { JobFormFields, EMPTY_JOB_FORM, type JobFormValues } from '@/components/jobs/JobFormFields';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { ScreenHeader } from '@/components/settings/ScreenHeader';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { hapticSelection, hapticSuccess } from '@/lib/haptics';
import {
  ALL_CITIES,
  ALL_SECTORS,
  closingInstantFromDate,
  createJob,
  jobErrorMessage,
  jobViewerFromProfile,
  loadJobMasterData,
  type JobKind,
  type JobMasterData,
  type JobViewer,
} from '@/lib/jobs';
import type { PendingCompanyVerification } from '@/lib/companies';
import { getOwnProfile } from '@/lib/profile';

/**
 * Posting a job — the web `/dashboard/jobs/new` port.
 *
 * Both post types need the same proof: a company verified with a work email.
 * "Hiring" lets the poster verify a company in place through the shared
 * company modal (the Profile screen's); "Referral" posts under the company
 * already on their profile. The form never decides trust — the database
 * re-checks the membership and the master data before a row lands.
 *
 * The description is a plain multiline field on mobile: line breaks are kept,
 * and the server stores it in the same canonical rich-text form the web
 * editor writes.
 */
export default function NewJobScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const [viewer, setViewer] = useState<JobViewer | null>(null);
  const [pending, setPending] = useState<PendingCompanyVerification | null>(null);
  const [master, setMaster] = useState<JobMasterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [kind, setKind] = useState<JobKind>('hiring');
  const [values, setValues] = useState<JobFormValues>(EMPTY_JOB_FORM);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  /** A refusal is announced at the top of the form; bring it into view. */
  const fail = (message: string) => {
    setError(message);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  async function load() {
    if (!user?.id) return;
    setLoadError(null);
    try {
      const [profile, masterData] = await Promise.all([getOwnProfile(), loadJobMasterData()]);
      setViewer(jobViewerFromProfile(profile, user.id));
      setPending(profile.pendingCompany);
      setMaster(masterData);
    } catch (cause) {
      setLoadError(jobErrorMessage(cause, 'The form could not be loaded. Please try again.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const patch = (next: Partial<JobFormValues>) => setValues((current) => ({ ...current, ...next }));
  const company = viewer?.company ?? null;

  async function submit() {
    if (submitting || !company) {
      if (!company) fail('Verify your company with a work email before posting.');
      return;
    }
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
      const jobId = await createJob(kind, company.id, {
        title: values.title.trim(),
        city_id: values.cityId === ALL_CITIES ? null : values.cityId,
        sector_id: values.sectorId === ALL_SECTORS ? null : values.sectorId,
        job_title: values.jobTitle,
        experience_level: values.experienceLevel,
        work_mode: values.workMode,
        employment_type: values.employmentType,
        salary: values.salary.trim(),
        description: values.description,
        website: values.website.trim(),
        closes_at: values.closesAt.trim(),
      });
      hapticSuccess();
      router.replace(`/jobs/${jobId}`);
    } catch (cause) {
      fail(jobErrorMessage(cause, 'The job could not be posted. Please try again.'));
      setSubmitting(false);
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      <ScreenHeader title="Post a job" />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : !master || !viewer ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={28} color={colors.foregroundMuted} />
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>
            {loadError ?? 'The form could not be loaded.'}
          </Text>
          <Pressable
            onPress={() => {
              setLoading(true);
              void load();
            }}
            accessibilityRole="button"
          >
            <Text style={[styles.retry, { color: colors.accent }]}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <KeyboardAwareScrollViewCompat
            ref={scrollRef}
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.intro}>
              <Text style={[styles.introTitle, { color: colors.foreground }]}>Post a job</Text>
              <Text style={[styles.introBody, { color: colors.foregroundMuted }]}>
                A role at a company verified with a work email. Only members whose profile matches
                the four criteria you choose can apply.
              </Text>
            </View>

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
              <Text style={[styles.label, { color: colors.foreground }]}>Post type</Text>
              <View style={styles.typeRow}>
                <TypeCard
                  active={kind === 'hiring'}
                  onPress={() => {
                    hapticSelection();
                    setKind('hiring');
                  }}
                  title="Hiring"
                  description="An opening at your company, posted by a verified member."
                />
                <TypeCard
                  active={kind === 'referral'}
                  onPress={() => {
                    hapticSelection();
                    setKind('referral');
                  }}
                  title="Referral"
                  description="You're referring a role at the company on your profile."
                />
              </View>

              <Text style={[styles.label, { color: colors.foreground, marginTop: 6 }]}>Company</Text>
              {company ? (
                <View style={[styles.companyRow, { borderColor: colors.border }]}>
                  <CompanyMark name={company.name} logoUrl={company.logoUrl} size={32} />
                  <View style={styles.companyText}>
                    <Text style={[styles.companyName, { color: colors.foreground }]} numberOfLines={1}>
                      {company.name}
                    </Text>
                    <View style={styles.verifiedRow}>
                      <CompanyVerifiedMark size={11} color={colors.foregroundMuted} />
                      <Text style={[styles.verifiedText, { color: colors.foregroundMuted }]}>
                        Verified with your work email
                      </Text>
                    </View>
                  </View>
                  <Pressable
                    onPress={() => setCompanyOpen(true)}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.changeButton,
                      {
                        borderColor: colors.border,
                        backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
                      },
                    ]}
                  >
                    <Text style={[styles.changeText, { color: colors.foreground }]}>Change</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={() => setCompanyOpen(true)}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.verifyButton,
                    { borderColor: pressed ? colors.accent : colors.border },
                  ]}
                >
                  <Feather name="briefcase" size={15} color={colors.foregroundMuted} />
                  <Text style={[styles.verifyText, { color: colors.foregroundMuted }]}>
                    Verify your company with a work email to post
                  </Text>
                </Pressable>
              )}
            </View>

            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <JobFormFields values={values} onChange={patch} master={master} />
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
                onPress={() => void submit()}
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
                    <Feather name="plus" size={14} color={colors.accentForeground} />
                    <Text style={[styles.primaryText, { color: colors.accentForeground }]}>
                      Publish job
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          </KeyboardAwareScrollViewCompat>

          <AddCompanyModal
            visible={companyOpen}
            initialPending={pending}
            onClose={() => setCompanyOpen(false)}
            onVerified={() => {
              setCompanyOpen(false);
              void load();
            }}
          />
        </>
      )}
    </View>
  );
}

function TypeCard({
  active,
  onPress,
  title,
  description,
}: {
  active: boolean;
  onPress: () => void;
  title: string;
  description: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[
        styles.typeCard,
        {
          borderColor: active ? colors.accent : colors.border,
          backgroundColor: active ? colors.accentSoft : 'transparent',
        },
      ]}
    >
      <Text style={[styles.typeTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.typeBody, { color: colors.foregroundMuted }]}>{description}</Text>
    </Pressable>
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
  intro: { gap: 4 },
  introTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 20 },
  introBody: { fontFamily: 'Geist_400Regular', fontSize: 13, lineHeight: 19 },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 10,
  },
  label: { fontFamily: 'Geist_500Medium', fontSize: 12 },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeCard: {
    flex: 1,
    gap: 3,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  typeTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 13.5 },
  typeBody: { fontFamily: 'Geist_400Regular', fontSize: 11.5, lineHeight: 16 },
  companyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  companyText: { flex: 1, gap: 2 },
  companyName: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  verifiedText: { fontFamily: 'Geist_400Regular', fontSize: 11 },
  changeButton: {
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  changeText: { fontFamily: 'Geist_500Medium', fontSize: 12 },
  verifyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    paddingVertical: 16,
    paddingHorizontal: 12,
  },
  verifyText: { fontFamily: 'Geist_400Regular', fontSize: 13, textAlign: 'center', flexShrink: 1 },
  footerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingTop: 4 },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minWidth: 130,
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
