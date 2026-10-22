import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CompanyMark } from '@/components/companies/CompanyMark';
import { DecisionCluster } from '@/components/jobs/DecisionCluster';
import { JobStateBadge, KindBadge } from '@/components/jobs/JobBadges';
import { PersonAvatar } from '@/components/PersonAvatar';
import { ScreenHeader } from '@/components/settings/ScreenHeader';
import { useColors } from '@/hooks/useColors';
import { useApplicantDecision } from '@/hooks/useApplicantDecision';
import { hapticSelection } from '@/lib/haptics';
import {
  applicationStatusLabel,
  experienceYearsLabel,
  fetchJobApplicants,
  jobErrorMessage,
  workModeLabel,
  type ApplicationStatus,
  type JobApplicantDetail,
  type JobPost,
} from '@/lib/jobs';

type TriageTab = 'all' | ApplicationStatus;

const TRIAGE_TABS: { value: TriageTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'shortlisted', label: 'Shortlisted' },
  { value: 'rejected', label: 'Rejected' },
];

/**
 * The poster's applicant list, as a triage board — the web `ApplicantsBoard`
 * port. Every row is an application exactly as it was submitted, plus the
 * decision cluster that moves it between New, Shortlisted and Rejected.
 *
 * Every decision is the same reversible write, so nothing asks for a
 * confirmation; each change offers its own undo strip. The tabs count that
 * same standing — switching one never moves a card out of view by anything but
 * the decision itself.
 */
export default function JobApplicantsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [job, setJob] = useState<JobPost | null>(null);
  const [applicants, setApplicants] = useState<JobApplicantDetail[]>([]);
  const [tab, setTab] = useState<TriageTab>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<{
    applicantId: string;
    name: string;
    previous: ApplicationStatus;
    next: ApplicationStatus;
  } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusedOnceRef = useRef(false);

  const { decide, pendingId, error: decisionError } = useApplicantDecision(id ?? '');

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent') => {
      if (!id) return;
      if (mode === 'initial') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      try {
        const data = await fetchJobApplicants(id);
        setJob(data.job);
        setApplicants(data.applicants);
        setError(null);
      } catch (cause) {
        setError(jobErrorMessage(cause, 'The applicants could not be loaded.'));
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

  // A decision made inside the application viewer lands while this screen is
  // behind it, so returning re-reads the list.
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnceRef.current) {
        focusedOnceRef.current = true;
        return;
      }
      void load('silent');
    }, [load]),
  );

  useEffect(
    () => () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    },
    [],
  );

  const offerUndo = (
    applicant: JobApplicantDetail,
    previous: ApplicationStatus,
    next: ApplicationStatus,
  ) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndo({ applicantId: applicant.id, name: applicant.name, previous, next });
    undoTimerRef.current = setTimeout(() => setUndo(null), 6000);
  };

  const applyDecision = async (
    applicant: JobApplicantDetail,
    status: ApplicationStatus,
  ): Promise<void> => {
    const previous = applicant.status;
    await decide(applicant, status, (settled) => {
      setApplicants((current) =>
        current.map((row) => (row.id === applicant.id ? { ...row, status: settled } : row)),
      );
      offerUndo(applicant, previous, settled);
    });
  };

  const undoDecision = async () => {
    if (!undo) return;
    const target = applicants.find((applicant) => applicant.id === undo.applicantId);
    if (target) {
      await decide(target, undo.previous, (settled) => {
        setApplicants((current) =>
          current.map((row) => (row.id === target.id ? { ...row, status: settled } : row)),
        );
      });
    }
    setUndo(null);
  };

  const countFor = (value: TriageTab): number =>
    value === 'all' ? applicants.length : applicants.filter((row) => row.status === value).length;
  const visible = tab === 'all' ? applicants : applicants.filter((row) => row.status === tab);
  const lead = visible[0] ?? applicants[0];

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(`/jobs/${id}`);
  };

  if (loading) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <StatusBar style={colors.isDark ? 'light' : 'dark'} />
        <ScreenHeader title="Applicants" />
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    );
  }

  if (!job) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <StatusBar style={colors.isDark ? 'light' : 'dark'} />
        <ScreenHeader title="Applicants" />
        <View style={styles.center}>
          <Feather name="inbox" size={28} color={colors.foregroundMuted} />
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>
            {error ?? 'The applicants could not be loaded.'}
          </Text>
          <Pressable onPress={() => void load('initial')} accessibilityRole="button">
            <Text style={[styles.retry, { color: colors.accent }]}>Try again</Text>
          </Pressable>
          <Pressable onPress={goBack} accessibilityRole="button">
            <Text style={[styles.retry, { color: colors.foregroundMuted }]}>Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const header = (
    <View>
      {/* Posting summary — the JobCard shape, so the same role reads the same. */}
      <View style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <CompanyMark name={job.company.name} logoUrl={job.company.logo_url} size={40} />
        <View style={styles.summaryBody}>
          <View style={styles.titleRow}>
            <Text style={[styles.summaryTitle, { color: colors.accent }]} numberOfLines={1}>
              {job.title}
            </Text>
            <Text style={[styles.years, { color: colors.foregroundMuted }]}>
              {experienceYearsLabel(job.experience_level_label)}
            </Text>
            <View style={styles.summaryBadges}>
              <JobStateBadge job={job} />
              <KindBadge kind={job.kind} />
            </View>
          </View>
          <Text style={[styles.meta, { color: colors.foregroundMuted }]} numberOfLines={1}>
            {job.company.name} · {job.city_name} ({workModeLabel(job.work_mode)})
            {job.salary ? ` · ${job.salary}` : ''}
          </Text>
          <View style={styles.summaryFooter}>
            <Text style={[styles.stamps, { color: colors.foregroundSubtle }]}>
              {job.posted_label}
              {job.updated_label ? ` · ${job.updated_label}` : ''}
            </Text>
            <View style={styles.countRow}>
              <Feather name="users" size={11} color={colors.foregroundMuted} />
              <Text style={[styles.countText, { color: colors.foregroundMuted }]}>
                {applicants.length} applicant{applicants.length === 1 ? '' : 's'}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Design mode — the application as a page of its own. */}
      {lead ? (
        <Pressable
          onPress={() => {
            hapticSelection();
            router.push(`/jobs/${job.id}/applicants/${lead.id}`);
          }}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.designCard,
            {
              backgroundColor: pressed ? colors.surfaceRaised : colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={[styles.designIcon, { backgroundColor: colors.accentSoft }]}>
            <Feather name="star" size={17} color={colors.accent} />
          </View>
          <View style={styles.designText}>
            <Text style={[styles.designTitle, { color: colors.foreground }]}>
              View application in design mode
            </Text>
            <Text style={[styles.designBody, { color: colors.foregroundMuted }]}>
              Read {applicants.length === 1 ? 'the application' : 'the applications'} one at a
              time — details, links and decisions.
            </Text>
          </View>
          <View style={[styles.openPill, { backgroundColor: colors.accent }]}>
            <Text style={[styles.openPillText, { color: colors.accentForeground }]}>Open</Text>
          </View>
        </Pressable>
      ) : null}

      {applicants.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabStrip}
          contentContainerStyle={styles.tabStripContent}
        >
          {TRIAGE_TABS.map((item) => {
            const active = tab === item.value;
            return (
              <Pressable
                key={item.value}
                onPress={() => {
                  hapticSelection();
                  setTab(item.value);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.tab, { borderBottomColor: active ? colors.foreground : 'transparent' }]}
              >
                <Text
                  style={[
                    styles.tabLabel,
                    { color: active ? colors.foreground : colors.foregroundMuted },
                  ]}
                >
                  {item.label}
                </Text>
                <View
                  style={[
                    styles.tabChip,
                    { backgroundColor: active ? colors.accentSoft : colors.surfaceRaised },
                  ]}
                >
                  <Text
                    style={[
                      styles.tabChipText,
                      { color: active ? colors.foreground : colors.foregroundMuted },
                    ]}
                  >
                    {countFor(item.value)}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      <ScreenHeader title="Applicants" subtitle={job.title} />

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingBottom: insets.bottom + (undo ? 96 : 32) }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load('refresh')}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
        ListEmptyComponent={
          <EmptyList tab={tab} />
        }
        renderItem={({ item }) => (
          <ApplicantRow
            applicant={item}
            pending={pendingId === item.id}
            error={decisionError?.id === item.id ? decisionError.message : null}
            onOpenProfile={() => router.push(`/member/${item.applicant_id}`)}
            onDecide={(status) => void applyDecision(item, status)}
            onOpenDesign={() => router.push(`/jobs/${job.id}/applicants/${item.id}`)}
          />
        )}
      />

      {undo ? (
        <View
          style={[
            styles.undoBar,
            {
              backgroundColor: colors.overlayElevated,
              borderColor: colors.border,
              bottom: insets.bottom + 12,
            },
          ]}
        >
          <Text style={[styles.undoText, { color: colors.foreground }]} numberOfLines={2}>
            “{undo.name}” moved to {applicationStatusLabel(undo.next)}.
          </Text>
          <Pressable
            onPress={() => void undoDecision()}
            accessibilityRole="button"
            hitSlop={8}
          >
            <Text style={[styles.undoAction, { color: colors.accent }]}>Undo</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function ApplicantRow({
  applicant,
  pending,
  error,
  onOpenProfile,
  onDecide,
  onOpenDesign,
}: {
  applicant: JobApplicantDetail;
  pending: boolean;
  error: string | null;
  onOpenProfile: () => void;
  onDecide: (status: ApplicationStatus) => void;
  onOpenDesign: () => void;
}) {
  const colors = useColors();

  return (
    <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.identity}>
        <PersonAvatar name={applicant.name} url={applicant.avatar_url} size={40} />
        <View style={styles.identityText}>
          <Pressable onPress={onOpenProfile} accessibilityRole="button" hitSlop={4}>
            <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
              {applicant.name}
            </Text>
          </Pressable>
          <Text style={[styles.applied, { color: colors.foregroundSubtle }]}>
            Applied {applicant.applied_label}
          </Text>
        </View>
        <Pressable
          onPress={onOpenDesign}
          accessibilityRole="button"
          accessibilityLabel="View application"
          hitSlop={8}
          style={({ pressed }) => [
            styles.openButton,
            { borderColor: colors.border, backgroundColor: pressed ? colors.surfaceRaised : 'transparent' },
          ]}
        >
          <Feather name="arrow-up-right" size={14} color={colors.foregroundMuted} />
        </Pressable>
      </View>

      <View style={[styles.links, { borderTopColor: colors.border }]}>
        <LinkButton label="Portfolio" icon="globe" url={applicant.portfolio_url} />
        <LinkButton label="LinkedIn" icon="linkedin" url={applicant.linkedin_url} />
        {applicant.resume_url ? (
          <LinkButton label="Resume" icon="file-text" url={applicant.resume_url} />
        ) : null}
        <Pressable onPress={onOpenProfile} accessibilityRole="button" style={styles.linkButton}>
          <Feather name="user" size={12} color={colors.foregroundMuted} />
          <Text style={[styles.linkLabel, { color: colors.foregroundMuted }]}>Profile</Text>
        </Pressable>

        <View style={styles.decision}>
          {pending ? (
            <ActivityIndicator size="small" color={colors.foregroundMuted} />
          ) : (
            <DecisionCluster status={applicant.status} onChange={onDecide} />
          )}
        </View>
      </View>

      {error ? (
        <Text
          style={[styles.rowError, { color: colors.destructive }]}
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function LinkButton({
  label,
  icon,
  url,
}: {
  label: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  url: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={() => void Linking.openURL(url).catch(() => undefined)}
      accessibilityRole="link"
      style={styles.linkButton}
    >
      <Feather name={icon} size={12} color={colors.link} />
      <Text style={[styles.linkLabel, { color: colors.link }]}>{label}</Text>
    </Pressable>
  );
}

function EmptyList({ tab }: { tab: TriageTab }) {
  const colors = useColors();
  const title =
    tab === 'all'
      ? 'No applications yet'
      : tab === 'new'
        ? 'No new applicants'
        : tab === 'shortlisted'
          ? 'No shortlisted applicants yet'
          : 'No rejected applicants';
  const body =
    tab === 'all'
      ? 'Members whose profile matches this role can apply — they’ll show up here.'
      : tab === 'new'
        ? 'You’ve reviewed everyone — shortlisted and rejected applicants live in their tabs.'
        : tab === 'shortlisted'
          ? 'Shortlist the ones you want to follow up with.'
          : 'Applicants you pass on will collect here.';

  return (
    <View style={[styles.empty, { borderColor: colors.border }]}>
      <Feather name="inbox" size={26} color={colors.foregroundSubtle} />
      <Text style={[styles.stateTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: {
    flex: 1,
    minHeight: 300,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 32,
  },
  stateTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 15, textAlign: 'center' },
  stateBody: {
    fontFamily: 'Geist_400Regular',
    fontSize: 12.5,
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 300,
  },
  retry: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },

  summary: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  summaryBody: { flex: 1, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  summaryTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 15, flexShrink: 1 },
  years: { fontFamily: 'Geist_400Regular', fontSize: 11.5 },
  summaryBadges: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' },
  meta: { fontFamily: 'Geist_400Regular', fontSize: 12.5 },
  summaryFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 3,
  },
  stamps: { fontFamily: 'Geist_400Regular', fontSize: 11.5, flexShrink: 1 },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  countText: { fontFamily: 'Geist_500Medium', fontSize: 11 },

  designCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  designIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  designText: { flex: 1, gap: 2 },
  designTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 13.5 },
  designBody: { fontFamily: 'Geist_400Regular', fontSize: 11.5, lineHeight: 16 },
  openPill: { borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
  openPillText: { fontFamily: 'Geist_600SemiBold', fontSize: 12 },

  tabStrip: { flexGrow: 0, marginTop: 8 },
  tabStripContent: { paddingHorizontal: 12, gap: 2 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderBottomWidth: 2,
  },
  tabLabel: { fontFamily: 'Geist_500Medium', fontSize: 12.5 },
  tabChip: { borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1.5 },
  tabChipText: { fontFamily: 'Geist_500Medium', fontSize: 10 },

  row: {
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 10,
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  identityText: { flex: 1, gap: 2 },
  name: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  applied: { fontFamily: 'Geist_400Regular', fontSize: 11 },
  openButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  links: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
  },
  linkButton: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  linkLabel: { fontFamily: 'Geist_500Medium', fontSize: 11.5 },
  decision: { marginLeft: 'auto' },
  rowError: { fontFamily: 'Geist_400Regular', fontSize: 11.5, lineHeight: 16 },

  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginHorizontal: 16,
    marginTop: 16,
    paddingVertical: 44,
    paddingHorizontal: 24,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
  },

  undoBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  undoText: { flex: 1, fontFamily: 'Geist_400Regular', fontSize: 12.5, lineHeight: 18 },
  undoAction: { fontFamily: 'Geist_600SemiBold', fontSize: 13 },
});
