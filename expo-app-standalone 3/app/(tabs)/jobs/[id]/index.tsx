import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CompanyMark, CompanyVerifiedMark } from '@/components/companies/CompanyMark';
import { ScreenHeader } from '@/components/settings/ScreenHeader';
import { PersonAvatar } from '@/components/PersonAvatar';
import { ApplyModal } from '@/components/jobs/ApplyModal';
import { ApplicationModal } from '@/components/jobs/ApplicationModal';
import { JobOwnerActions } from '@/components/jobs/JobOwnerActions';
import { LockedNote, MetaChip, JobStateBadge, KindBadge, AMBER } from '@/components/jobs/JobBadges';
import { RichText } from '@/components/jobs/RichText';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { hapticSelection } from '@/lib/haptics';
import {
  criteriaMismatches,
  experienceYearsLabel,
  fetchJob,
  gateDimensions,
  jobErrorMessage,
  listPhrase,
  loadJobViewer,
  workModeLabel,
  type JobPost,
  type JobViewer,
} from '@/lib/jobs';

/**
 * A posting as the viewer sees it — the web `JobDetail` port, on its own
 * screen (the mobile stack's reading of the board's detail pane).
 *
 * The Apply action follows `can_apply`, the flag the database computed with
 * the same rule its write enforces; a locked posting names the dimensions that
 * do not match. A posting that is not taking applications says so in place of
 * Apply rather than presenting a button that can only fail, and an existing
 * application is still named — neither closing nor a deadline is a withdrawal.
 */
export default function JobDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [job, setJob] = useState<JobPost | null>(null);
  const [viewer, setViewer] = useState<JobViewer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applicationOpen, setApplicationOpen] = useState(false);
  const focusedOnceRef = useRef(false);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!id) return;
      if (mode === 'initial') setLoading(true);
      try {
        const [nextJob, nextViewer] = await Promise.all([
          fetchJob(id),
          user?.id ? loadJobViewer(user.id) : Promise.resolve(null),
        ]);
        setJob(nextJob);
        setViewer(nextViewer);
        setError(null);
      } catch (cause) {
        if (mode === 'initial') {
          setError(jobErrorMessage(cause, 'This job could not be loaded.'));
        }
      } finally {
        setLoading(false);
      }
    },
    [id, user?.id],
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  // Returning from Edit or Apply re-reads the posting so the screen never
  // shows a state the server has already moved past.
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnceRef.current) {
        focusedOnceRef.current = true;
        return;
      }
      void load('refresh');
    }, [load]),
  );

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/jobs');
  };

  if (loading) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <StatusBar style={colors.isDark ? 'light' : 'dark'} />
        <ScreenHeader title="Job" />
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    );
  }

  if (!job || !viewer) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <StatusBar style={colors.isDark ? 'light' : 'dark'} />
        <ScreenHeader title="Job" />
        <View style={styles.center}>
          <Feather name="briefcase" size={28} color={colors.foregroundMuted} />
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>
            {error ?? 'This job could not be loaded.'}
          </Text>
          <Pressable onPress={() => void load('initial')} accessibilityRole="button">
            <Text style={[styles.retry, { color: colors.accent }]}>Try again</Text>
          </Pressable>
          <Pressable onPress={goBack} accessibilityRole="button">
            <Text style={[styles.retry, { color: colors.foregroundMuted }]}>Back to jobs</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const mismatches = criteriaMismatches(job, viewer);
  const gate = gateDimensions(job);
  const actionsHidden = job.applied && job.status === 'open' && !job.deadline_expired;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      <ScreenHeader title="Job" />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header card */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.headerTop}>
            <CompanyMark name={job.company.name} logoUrl={job.company.logo_url} size={54} />
            <View style={styles.headerText}>
              <View style={styles.titleRow}>
                <Text style={[styles.title, { color: colors.foreground }]}>{job.title}</Text>
                <Text style={[styles.years, { color: colors.foregroundMuted }]}>
                  {experienceYearsLabel(job.experience_level_label)}
                </Text>
              </View>
              <View style={styles.badgeRow}>
                <JobStateBadge job={job} />
                <KindBadge kind={job.kind} />
                {job.is_mine ? (
                  <JobOwnerActions
                    job={job}
                    onEdit={() => router.push(`/jobs/${job.id}/edit`)}
                    onChanged={() => void load('refresh')}
                    onDeleted={goBack}
                  />
                ) : null}
              </View>
            </View>
          </View>

          <View style={styles.metaLine}>
            <Text style={[styles.meta, { color: colors.foregroundMuted }]}>
              {job.company.name}
            </Text>
            {job.company.domain_verified ? (
              <CompanyVerifiedMark size={11} color={colors.foregroundMuted} />
            ) : null}
            <Text style={[styles.meta, { color: colors.foregroundSubtle }]}>•</Text>
            <Text style={[styles.meta, { color: colors.foregroundMuted }]}>
              {job.city_name} ({workModeLabel(job.work_mode)})
            </Text>
            {job.salary ? (
              <>
                <Text style={[styles.meta, { color: colors.foregroundSubtle }]}>•</Text>
                <Text style={[styles.meta, { color: colors.foregroundMuted }]}>{job.salary}</Text>
              </>
            ) : null}
          </View>

          <Text style={[styles.stamps, { color: colors.foregroundSubtle }]}>
            Posted {job.posted_label}
            {job.updated_label ? ` · ${job.updated_label}` : ''}
            {job.deadline_label ? (
              <Text style={job.deadline_expired ? { color: AMBER } : undefined}>
                {` · ${job.deadline_label}`}
              </Text>
            ) : null}
          </Text>

          {!actionsHidden ? (
            <View style={[styles.actions, { borderTopColor: colors.border }]}>
              {job.is_mine ? (
                <Pressable
                  onPress={() => {
                    hapticSelection();
                    router.push(`/jobs/${job.id}/applicants`);
                  }}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.primaryButton,
                    { backgroundColor: pressed ? colors.accentHover : colors.accent },
                  ]}
                >
                  <Feather name="users" size={14} color={colors.accentForeground} />
                  <Text style={[styles.primaryButtonText, { color: colors.accentForeground }]}>
                    View {job.applicant_count} applicant{job.applicant_count === 1 ? '' : 's'}
                  </Text>
                </Pressable>
              ) : job.status === 'closed' || job.deadline_expired ? (
                <View style={styles.closedBlock}>
                  <View style={styles.closedLine}>
                    <Feather
                      name={job.status === 'closed' ? 'lock' : 'clock'}
                      size={14}
                      color={job.status === 'closed' ? colors.foregroundMuted : AMBER}
                    />
                    <Text style={[styles.closedTitle, { color: colors.foreground }]}>
                      {job.status === 'closed'
                        ? 'This posting is closed'
                        : 'This posting has expired'}
                    </Text>
                  </View>
                  <Text style={[styles.closedBody, { color: colors.foregroundSubtle }]}>
                    {job.status === 'closed'
                      ? 'It is no longer accepting applications.'
                      : 'Its closing date has passed, so it is no longer accepting applications.'}
                    {appliedSentence(job)}
                  </Text>
                </View>
              ) : job.can_apply ? (
                <View style={styles.applyBlock}>
                  <Pressable
                    onPress={() => setApplyOpen(true)}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.primaryButton,
                      { backgroundColor: pressed ? colors.accentHover : colors.accent },
                    ]}
                  >
                    <Text style={[styles.primaryButtonText, { color: colors.accentForeground }]}>
                      Apply now
                    </Text>
                  </Pressable>
                  <Text style={[styles.applyHint, { color: colors.foregroundSubtle }]}>
                    Your profile matches this role.
                  </Text>
                </View>
              ) : (
                <View style={styles.lockedBlock}>
                  <LockedNote>Apply is locked for your profile</LockedNote>
                  <Text style={[styles.lockedBody, { color: colors.foregroundSubtle }]}>
                    Only members whose {listPhrase(gate)} match the posting can apply.
                    {mismatches.length > 0
                      ? ` Your profile differs in ${listPhrase(mismatches)}.`
                      : ''}
                  </Text>
                </View>
              )}
            </View>
          ) : null}
        </View>

        {/* Application status */}
        {job.applied && job.my_application ? (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitleSmall, { color: colors.foreground }]}>
              Application status
            </Text>
            <View style={styles.applicationRow}>
              <View style={[styles.greenDot, { backgroundColor: colors.success }]} />
              <View style={styles.applicationText}>
                <Text style={[styles.applicationTitle, { color: colors.foreground }]}>
                  Application submitted
                </Text>
                <Text style={[styles.applicationWhen, { color: colors.foregroundSubtle }]}>
                  {job.my_application.applied_label}
                </Text>
                <Pressable
                  onPress={() => setApplicationOpen(true)}
                  accessibilityRole="button"
                  hitSlop={6}
                >
                  <Text style={[styles.applicationLink, { color: colors.accent }]}>
                    View application
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}

        {/* Poster */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitleSmall, { color: colors.foreground }]}>
            {job.kind === 'referral' ? 'Referred by' : 'Posted by'}
          </Text>
          <Pressable
            onPress={() => {
              if (job.is_mine) return;
              hapticSelection();
              router.push(`/member/${job.poster.id}`);
            }}
            disabled={job.is_mine}
            accessibilityRole={job.is_mine ? undefined : 'button'}
            style={styles.posterRow}
          >
            <PersonAvatar name={job.poster.name} url={job.poster.avatar_url} size={36} />
            <View style={styles.posterText}>
              <Text style={[styles.posterName, { color: colors.foreground }]} numberOfLines={1}>
                {job.is_mine ? 'You' : job.poster.name}
              </Text>
              <Text style={[styles.posterMeta, { color: colors.foregroundMuted }]} numberOfLines={1}>
                {[job.poster.job_title_label, job.poster.company_name ? `@ ${job.poster.company_name}` : null]
                  .filter(Boolean)
                  .join(' ') || 'Member'}
              </Text>
            </View>
          </Pressable>
        </View>

        <Section title="About the role">
          <RichText html={job.description} />
        </Section>

        {job.responsibilities.length > 0 ? (
          <Section title="What you'll do">
            <BulletList items={job.responsibilities} />
          </Section>
        ) : null}

        {job.requirements.length > 0 ? (
          <Section title="What we're looking for">
            <BulletList items={job.requirements} />
          </Section>
        ) : null}

        {job.skills.length > 0 ? (
          <Section title="Skills">
            <View style={styles.skills}>
              {job.skills.map((skill) => (
                <MetaChip key={skill}>{skill}</MetaChip>
              ))}
            </View>
          </Section>
        ) : null}

        <Section title={`About ${job.company.name}`}>
          <View style={styles.companyLine}>
            <CompanyMark name={job.company.name} logoUrl={job.company.logo_url} size={18} />
            <Text style={[styles.companyName, { color: colors.foreground }]}>
              {job.company.name}
            </Text>
            {job.company.domain_verified ? (
              <CompanyVerifiedMark size={11} color={colors.foregroundMuted} />
            ) : null}
          </View>
          {job.website ? (
            <Pressable
              onPress={() => void Linking.openURL(job.website as string).catch(() => undefined)}
              accessibilityRole="link"
              style={styles.websiteRow}
            >
              <Feather name="globe" size={12} color={colors.link} />
              <Text style={[styles.website, { color: colors.link }]} numberOfLines={1}>
                {job.website.replace(/^https?:\/\//, '')}
              </Text>
            </Pressable>
          ) : null}
        </Section>
      </ScrollView>

      {/* Held open by `applyOpen` alone: the refresh after sending flips
          `can_apply` off, and the modal's own success screen must stay up until
          the member dismisses it. */}
      {applyOpen && !job.is_mine ? (
        <ApplyModal
          job={job}
          viewer={viewer}
          onClose={() => setApplyOpen(false)}
          onApplied={() => void load('refresh')}
        />
      ) : null}

      {applicationOpen && job.my_application ? (
        <ApplicationModal
          job={job}
          application={job.my_application}
          onClose={() => setApplicationOpen(false)}
        />
      ) : null}
    </View>
  );
}

/** One line telling an applicant their application still stands. */
function appliedSentence(job: JobPost): string {
  if (!job.applied) return '';
  const when = job.my_application?.applied_label;
  return ` Your application was submitted${when ? ` ${when}` : ''}.`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
      {children}
    </View>
  );
}

function BulletList({ items }: { items: string[] }) {
  const colors = useColors();
  return (
    <View style={styles.bullets}>
      {items.map((item) => (
        <View key={item} style={styles.bulletRow}>
          <View style={[styles.bulletDot, { backgroundColor: colors.foregroundSubtle }]} />
          <Text style={[styles.bulletText, { color: colors.foregroundMuted }]}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 16 },
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
  headerTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  headerText: { flex: 1, gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  title: { fontFamily: 'Geist_600SemiBold', fontSize: 19, lineHeight: 25 },
  years: { fontFamily: 'Geist_400Regular', fontSize: 12.5 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  metaLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5 },
  meta: { fontFamily: 'Geist_400Regular', fontSize: 13 },
  stamps: { fontFamily: 'Geist_400Regular', fontSize: 11.5 },

  actions: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14, marginTop: 4 },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    alignSelf: 'flex-start',
    height: 40,
    borderRadius: 10,
    paddingHorizontal: 16,
  },
  primaryButtonText: { fontFamily: 'Geist_600SemiBold', fontSize: 13.5 },
  applyBlock: { gap: 6 },
  applyHint: { fontFamily: 'Geist_400Regular', fontSize: 11.5 },
  closedBlock: { gap: 5 },
  closedLine: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  closedTitle: { fontFamily: 'Geist_500Medium', fontSize: 13.5 },
  closedBody: { fontFamily: 'Geist_400Regular', fontSize: 12, lineHeight: 18 },
  lockedBlock: { gap: 5 },
  lockedBody: { fontFamily: 'Geist_400Regular', fontSize: 12, lineHeight: 18 },

  sectionTitleSmall: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  applicationRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  greenDot: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  applicationText: { flex: 1, gap: 2 },
  applicationTitle: { fontFamily: 'Geist_500Medium', fontSize: 13.5 },
  applicationWhen: { fontFamily: 'Geist_400Regular', fontSize: 11.5 },
  applicationLink: { fontFamily: 'Geist_500Medium', fontSize: 12, marginTop: 2 },

  posterRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  posterText: { flex: 1, gap: 1 },
  posterName: { fontFamily: 'Geist_500Medium', fontSize: 13.5 },
  posterMeta: { fontFamily: 'Geist_400Regular', fontSize: 11.5 },

  section: { gap: 9 },
  sectionTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 15 },
  bullets: { gap: 8 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  bulletDot: { width: 4, height: 4, borderRadius: 2, marginTop: 8 },
  bulletText: { flex: 1, fontFamily: 'Geist_400Regular', fontSize: 13.5, lineHeight: 20 },
  skills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  companyLine: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  companyName: { fontFamily: 'Geist_600SemiBold', fontSize: 13.5 },
  websiteRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  website: { fontFamily: 'Geist_500Medium', fontSize: 12, flexShrink: 1 },
});
