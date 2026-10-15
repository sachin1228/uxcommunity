/**
 * Job detail — the mobile rendering of the web /dashboard/jobs/[jobId].
 *
 * Same payload, same rules: the Apply action appears only when the server's
 * `can_apply` is true; the locked state names the mismatching dimensions (the
 * profile is only used for that copy — `can_apply` stays the authority); the
 * applied state shows the submitted application; closed/expired postings say
 * so instead of offering Apply. The jobs surfaces have no realtime room, so
 * the screen refetches on focus like the web page does on navigation.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApplySheet } from '@/components/jobs/ApplySheet';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import {
  criteriaMismatches,
  employmentTypeLabel,
  experienceYearsLabel,
  jobKindLabel,
  listPhrase,
  richTextToPlain,
  workModeLabel,
  type JobPost,
} from '@/lib/jobs';
import { getApplyPrefill, getJobDetail, type ApplyPrefill } from '@/lib/jobsApi';

const AMBER = '#F59E0B';
const INDIGO = '#818CF8';
const EMERALD = '#10B981';

export default function JobDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [job, setJob] = useState<JobPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<ApplyPrefill | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const focusLoadedRef = useRef(false);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!id) return;
      if (mode === 'initial') setLoading(true);
      else setRefreshing(true);
      try {
        const fetched = await getJobDetail(id);
        setJob(fetched);
        setError(null);
        setNotFound(false);
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 404) {
          setNotFound(true);
        } else if (mode === 'initial') {
          setError(e instanceof Error ? e.message : 'Failed to load this job.');
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [id],
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  // Profile facts for the lock copy and the apply prefill — non-blocking.
  useEffect(() => {
    void getApplyPrefill(user?.name ?? '').then(setPrefill);
  }, [user?.name]);

  // No realtime on jobs: re-read when the screen comes back to the front.
  useFocusEffect(
    useCallback(() => {
      if (!focusLoadedRef.current) {
        focusLoadedRef.current = true;
        return; // the mount effect just fetched
      }
      void load('refresh');
    }, [load]),
  );

  const openLink = useCallback((url: string) => {
    void WebBrowser.openBrowserAsync(url);
  }, []);

  const mismatches =
    job && prefill && !job.can_apply && !job.is_mine && !job.applied
      ? criteriaMismatches(job, prefill)
      : [];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />

      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
            paddingTop: insets.top + 8,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
          Job
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : notFound ? (
        <View style={styles.center}>
          <Feather name="briefcase" size={30} color={colors.foregroundSubtle} />
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>
            This job no longer exists
          </Text>
          <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>
            The posting was removed by its owner or an admin.
          </Text>
        </View>
      ) : error || !job ? (
        <View style={styles.center}>
          <Feather name="wifi-off" size={28} color={colors.foregroundMuted} />
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>
            Couldn&apos;t load this job
          </Text>
          <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>{error}</Text>
          <Pressable onPress={() => void load('initial')} accessibilityRole="button">
            <Text style={[styles.retry, { color: colors.accent }]}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <ScrollView
            contentContainerStyle={[
              styles.content,
              { paddingBottom: insets.bottom + (job.can_apply && !job.applied && !job.is_mine ? 96 : 40) },
            ]}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void load('refresh')}
                tintColor={colors.foregroundMuted}
              />
            }
          >
            {/* ── Posting header ── */}
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.companyRow}>
                <View style={styles.companyInfo}>
                  <Text style={[styles.companyName, { color: colors.foreground }]} numberOfLines={1}>
                    {job.company.name}
                  </Text>
                  {job.company.domain_verified && (
                    <View style={styles.verifiedRow}>
                      <Feather name="check-circle" size={12} color={colors.accent} />
                      <Text style={[styles.verifiedText, { color: colors.accent }]}>Verified</Text>
                    </View>
                  )}
                </View>
                {job.status === 'closed' ? (
                  <View
                    style={[
                      styles.stateBadge,
                      { borderColor: colors.border, backgroundColor: colors.surfaceRaised },
                    ]}
                  >
                    <Feather name="lock" size={10} color={colors.mutedForeground} />
                    <Text style={[styles.stateBadgeText, { color: colors.mutedForeground }]}>
                      Closed
                    </Text>
                  </View>
                ) : job.deadline_expired ? (
                  <View style={[styles.stateBadge, styles.expiredBadge]}>
                    <Feather name="clock" size={10} color={AMBER} />
                    <Text style={[styles.stateBadgeText, { color: AMBER }]}>Expired</Text>
                  </View>
                ) : null}
              </View>

              <Text style={[styles.title, { color: colors.foreground }]}>{job.title}</Text>
              <View style={styles.titleMeta}>
                <Text style={[styles.years, { color: colors.mutedForeground }]}>
                  {experienceYearsLabel(job.experience_level_label)}
                </Text>
                <Text
                  style={[
                    styles.kind,
                    { color: job.kind === 'hiring' ? AMBER : INDIGO },
                  ]}
                >
                  #{jobKindLabel(job.kind)}
                </Text>
              </View>

              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {[job.company.name, `${job.city_name} (${workModeLabel(job.work_mode)})`, job.salary]
                  .filter(Boolean)
                  .join(' • ')}
              </Text>
              <Text
                style={[
                  styles.labels,
                  { color: job.deadline_expired ? AMBER : colors.foregroundSubtle },
                ]}
              >
                {[job.posted_label, job.updated_label, job.deadline_label]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>

            {/* ── Viewer state ── */}
            {job.is_mine ? (
              <StateCard
                icon="users"
                title={`${job.applicant_count} ${job.applicant_count === 1 ? 'applicant' : 'applicants'}`}
                body="Applications to your posting land here as members who match the role apply."
              />
            ) : job.applied && job.my_application ? (
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.appliedHeader}>
                  <View style={styles.appliedChip}>
                    <Feather name="check" size={13} color={EMERALD} />
                    <Text style={[styles.appliedChipText, { color: EMERALD }]}>
                      Application submitted
                    </Text>
                  </View>
                  {job.my_application.applied_label ? (
                    <Text style={[styles.foregroundSubtle, { color: colors.foregroundSubtle }]}>
                      {job.my_application.applied_label}
                    </Text>
                  ) : null}
                </View>
                <Text style={[styles.aboutText, { color: colors.mutedForeground }]}>
                  {job.my_application.name}
                </Text>
                <LinkRow label="Portfolio" url={job.my_application.portfolio_url} onOpen={openLink} />
                <LinkRow label="LinkedIn" url={job.my_application.linkedin_url} onOpen={openLink} />
                {job.my_application.resume_url ? (
                  <LinkRow label="Resume" url={job.my_application.resume_url} onOpen={openLink} />
                ) : null}
                {(job.status === 'closed' || job.deadline_expired) && (
                  <Text style={[styles.labels, { color: colors.mutedForeground, marginTop: 8 }]}>
                    {job.status === 'closed'
                      ? 'This posting is closed — it is no longer accepting applications.'
                      : "This posting's closing date has passed — it is no longer accepting applications."}
                  </Text>
                )}
              </View>
            ) : job.status === 'closed' ? (
              <StateCard
                icon="lock"
                title="This posting is closed"
                body="It is no longer accepting applications."
              />
            ) : job.deadline_expired ? (
              <StateCard
                icon="clock"
                title="This posting has expired"
                body="Its closing date has passed — it is no longer accepting applications."
              />
            ) : job.can_apply ? (
              <StateCard
                icon="check-circle"
                title="You match this role"
                body="Your profile matches — apply below."
                positive
              />
            ) : (
              <StateCard
                icon="lock"
                title="Locked for your profile"
                body={
                  mismatches.length > 0
                    ? `This role is open to members whose ${listPhrase(mismatches)} ${mismatches.length === 1 ? 'matches' : 'match'} the posting. Keep your profile current — roles matching it land in your Jobs tab.`
                    : 'This role is open to members whose city, sector, job title and experience level match the posting.'
                }
              />
            )}

            {/* ── About ── */}
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>About this role</Text>
              <Text style={[styles.aboutText, { color: colors.foregroundMuted ?? colors.mutedForeground }]}>
                {richTextToPlain(job.description)}
              </Text>

              {job.responsibilities.length > 0 && (
                <BulletList
                  title="Responsibilities"
                  items={job.responsibilities}
                />
              )}
              {job.requirements.length > 0 && (
                <BulletList
                  title="Requirements"
                  items={job.requirements}
                />
              )}
              {job.skills.length > 0 && (
                <>
                  <Text style={[styles.sectionSubtitle, { color: colors.foreground }]}>Skills</Text>
                  <View style={styles.skillsRow}>
                    {job.skills.map((skill) => (
                      <View
                        key={skill}
                        style={[styles.skillChip, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}
                      >
                        <Text style={[styles.skillText, { color: colors.mutedForeground }]}>{skill}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </View>

            {/* ── Details ── */}
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Details</Text>
              <DetailRow label="Work mode" value={workModeLabel(job.work_mode)} />
              <DetailRow label="Employment" value={employmentTypeLabel(job.employment_type)} />
              {job.salary ? <DetailRow label="Salary" value={job.salary} /> : null}
              <DetailRow label="City" value={job.city_name} />
              <DetailRow label="Sector" value={job.sector_name} />
              <DetailRow label="Experience" value={job.experience_level_label} />
              <DetailRow label="Role" value={job.job_title_label} />
              {job.closes_at && !job.deadline_expired && job.status === 'open' && job.deadline_label ? (
                <DetailRow label="Closes" value={job.deadline_label.replace(/^Closes /, '')} />
              ) : null}
              {job.website ? (
                <Pressable
                  accessibilityRole="link"
                  onPress={() => openLink(job.website!)}
                  style={styles.detailRow}
                >
                  <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Website</Text>
                  <Text style={[styles.detailLink, { color: colors.accent }]} numberOfLines={1}>
                    {job.website}
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {/* ── Poster ── */}
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                {job.kind === 'referral' ? 'Referred by' : 'Posted by'}
              </Text>
              <View style={styles.posterRow}>
                <View
                  style={[
                    styles.posterAvatar,
                    { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.posterInitial, { color: colors.mutedForeground }]}>
                    {job.poster.name.trim()[0]?.toUpperCase() ?? '?'}
                  </Text>
                </View>
                <View style={styles.posterInfo}>
                  <Text style={[styles.posterName, { color: colors.foreground }]} numberOfLines={1}>
                    {job.is_mine ? 'You' : job.poster.name}
                  </Text>
                  {job.poster.experience_level_label ? (
                    <Text style={[styles.posterRole, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {job.poster.experience_level_label}
                    </Text>
                  ) : null}
                </View>
              </View>
            </View>
          </ScrollView>

          {job.can_apply && !job.applied && !job.is_mine && (
            <View
              style={[
                styles.footer,
                {
                  backgroundColor: colors.background,
                  borderTopColor: colors.border,
                  paddingBottom: insets.bottom + 12,
                },
              ]}
            >
              <Pressable
                accessibilityRole="button"
                onPress={() => setApplyOpen(true)}
                style={[styles.applyButton, { backgroundColor: colors.accent }]}
              >
                <Text style={[styles.applyButtonText, { color: colors.accentForeground }]}>
                  Apply
                </Text>
              </Pressable>
            </View>
          )}

          <ApplySheet
            job={job}
            visible={applyOpen}
            onClose={() => {
              setApplyOpen(false);
              void load('refresh');
            }}
            onSubmitted={() => void load('refresh')}
          />
        </>
      )}
    </View>
  );
}

function StateCard({
  icon,
  title,
  body,
  positive,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  title: string;
  body: string;
  positive?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.stateCardRow}>
        <Feather name={icon} size={15} color={positive ? colors.accent : colors.mutedForeground} />
        <Text
          style={[
            styles.stateCardTitle,
            { color: positive ? colors.accent : colors.foreground },
          ]}
        >
          {title}
        </Text>
      </View>
      <Text style={[styles.aboutText, { color: colors.mutedForeground }]}>{body}</Text>
    </View>
  );
}

function BulletList({ title, items }: { title: string; items: string[] }) {
  const colors = useColors();
  return (
    <View style={styles.bulletBlock}>
      <Text style={[styles.sectionSubtitle, { color: colors.foreground }]}>{title}</Text>
      {items.map((item) => (
        <View key={item} style={styles.bulletRow}>
          <View style={[styles.bulletDot, { backgroundColor: colors.foregroundSubtle }]} />
          <Text style={[styles.bulletText, { color: colors.mutedForeground }]}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: colors.foreground }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function LinkRow({
  label,
  url,
  onOpen,
}: {
  label: string;
  url: string;
  onOpen: (url: string) => void;
}) {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="link" onPress={() => onOpen(url)} style={styles.linkRow}>
      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.detailLink, { color: colors.accent }]} numberOfLines={1}>
        {url}
      </Text>
      <Feather name="external-link" size={13} color={colors.accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: { padding: 2 },
  headerTitle: { flex: 1, fontFamily: 'Geist_600SemiBold', fontSize: 17, textAlign: 'center' },
  headerSpacer: { width: 26 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 32,
  },
  stateTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 16, textAlign: 'center' },
  stateBody: { fontFamily: 'Geist_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retry: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  content: { padding: 14, gap: 12 },
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 8,
  },
  companyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  companyInfo: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
  companyName: { fontFamily: 'Geist_500Medium', fontSize: 13, flexShrink: 1 },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  verifiedText: { fontFamily: 'Geist_500Medium', fontSize: 11.5 },
  stateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  expiredBadge: {
    borderColor: 'rgba(245, 158, 11, 0.4)',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
  },
  stateBadgeText: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 9.5,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  title: { fontFamily: 'Geist_700Bold', fontSize: 19, lineHeight: 25 },
  titleMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  years: { fontFamily: 'Geist_400Regular', fontSize: 12.5 },
  kind: { fontFamily: 'Geist_500Medium', fontSize: 12.5 },
  meta: { fontFamily: 'Geist_400Regular', fontSize: 12.5 },
  labels: { fontFamily: 'Geist_400Regular', fontSize: 11.5 },
  foregroundSubtle: { fontFamily: 'Geist_400Regular', fontSize: 11.5 },
  stateCardRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stateCardTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 14.5 },
  sectionTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 15 },
  sectionSubtitle: { fontFamily: 'Geist_600SemiBold', fontSize: 13, marginTop: 10 },
  aboutText: { fontFamily: 'Geist_400Regular', fontSize: 13.5, lineHeight: 20 },
  bulletBlock: { marginTop: 2 },
  bulletRow: { flexDirection: 'row', gap: 8, marginTop: 6, paddingRight: 4 },
  bulletDot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 7 },
  bulletText: { flex: 1, fontFamily: 'Geist_400Regular', fontSize: 13.5, lineHeight: 20 },
  skillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  skillChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  skillText: { fontFamily: 'Geist_500Medium', fontSize: 11.5 },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 5,
  },
  detailLabel: { fontFamily: 'Geist_400Regular', fontSize: 13 },
  detailValue: { fontFamily: 'Geist_500Medium', fontSize: 13, flexShrink: 1, textAlign: 'right' },
  detailLink: { flex: 1, textAlign: 'right', fontFamily: 'Geist_400Regular', fontSize: 13 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  appliedHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  appliedChip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  appliedChipText: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  posterRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  posterAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterInitial: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  posterInfo: { flex: 1, minWidth: 0 },
  posterName: { fontFamily: 'Geist_500Medium', fontSize: 14 },
  posterRole: { fontFamily: 'Geist_400Regular', fontSize: 12, marginTop: 1 },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  applyButton: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyButtonText: { fontFamily: 'Geist_600SemiBold', fontSize: 15.5 },
});
