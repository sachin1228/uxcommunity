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
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DecisionCluster } from '@/components/jobs/DecisionCluster';
import { PersonAvatar } from '@/components/PersonAvatar';
import { ScreenHeader } from '@/components/settings/ScreenHeader';
import { useColors } from '@/hooks/useColors';
import { useApplicantDecision } from '@/hooks/useApplicantDecision';
import { hapticSelection } from '@/lib/haptics';
import {
  applicationStatusLabel,
  fetchJobApplicants,
  jobErrorMessage,
  type ApplicationStatus,
  type JobApplicantDetail,
} from '@/lib/jobs';

type Section = 'resume' | 'portfolio' | 'linkedin';

/**
 * One applicant's application as the poster reviews it — the mobile reading of
 * the web design view. The applicant's own details, the decisions, the pager
 * and their filled links live on this screen; the links open in the in-app
 * browser (LinkedIn refuses to be embedded, and a phone has no iframe), so the
 * poster reads the real submitted page and comes straight back.
 *
 * The application id in the URL pins the applicant, and previous/next walk the
 * posting's applicants by rewriting it — the browser's own back button still
 * leaves the viewer.
 */
export default function ApplicationViewerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, applicationId } = useLocalSearchParams<{ id: string; applicationId: string }>();

  const [applicants, setApplicants] = useState<JobApplicantDetail[]>([]);
  const [currentId, setCurrentId] = useState(applicationId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ applicantId: string; previous: ApplicationStatus } | null>(
    null,
  );
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { decide, pendingId, error: decisionError } = useApplicantDecision(id ?? '');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await fetchJobApplicants(id);
      setApplicants(data.applicants);
      setError(null);
    } catch (cause) {
      setError(jobErrorMessage(cause, 'This application could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () => () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    },
    [],
  );

  const index = applicants.findIndex((applicant) => applicant.id === currentId);
  const applicant = index >= 0 ? applicants[index] : undefined;

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(`/jobs/${id}/applicants`);
  };

  const goTo = (next: number) => {
    if (next < 0 || next >= applicants.length) return;
    hapticSelection();
    setCurrentId(applicants[next].id);
    router.setParams({ applicationId: applicants[next].id });
  };

  const changeStatus = async (status: ApplicationStatus) => {
    if (!applicant) return;
    await decide(applicant, status, (settled) => {
      setApplicants((current) =>
        current.map((row) => (row.id === applicant.id ? { ...row, status: settled } : row)),
      );
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      setUndo({ applicantId: applicant.id, previous: applicant.status });
      undoTimerRef.current = setTimeout(() => setUndo(null), 6000);
    });
  };

  const undoStatus = async () => {
    if (!undo) return;
    const target = applicants.find((row) => row.id === undo.applicantId);
    if (target) {
      await decide(target, undo.previous, (settled) => {
        setApplicants((current) =>
          current.map((row) => (row.id === target.id ? { ...row, status: settled } : row)),
        );
      });
    }
    setUndo(null);
  };

  const openLink = async (url: string) => {
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      void Linking.openURL(url).catch(() => undefined);
    }
  };

  if (loading) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <StatusBar style={colors.isDark ? 'light' : 'dark'} />
        <ScreenHeader title="Application" />
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    );
  }

  if (!applicant) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <StatusBar style={colors.isDark ? 'light' : 'dark'} />
        <ScreenHeader title="Application" />
        <View style={styles.center}>
          <Feather name="file-text" size={28} color={colors.foregroundMuted} />
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>
            {error ?? 'This application is no longer available.'}
          </Text>
          <Pressable onPress={goBack} accessibilityRole="button">
            <Text style={[styles.retry, { color: colors.accent }]}>Back to applicants</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const links: { key: Section; label: string; icon: React.ComponentProps<typeof Feather>['name']; url: string }[] = [
    { key: 'portfolio', label: 'Portfolio', icon: 'globe', url: applicant.portfolio_url },
    { key: 'linkedin', label: 'LinkedIn', icon: 'linkedin', url: applicant.linkedin_url },
  ];
  if (applicant.resume_url) {
    links.unshift({
      key: 'resume',
      label: 'Resume',
      icon: 'file-text',
      url: applicant.resume_url,
    });
  }

  const decisionErrorForApplicant =
    decisionError?.id === applicant.id ? decisionError.message : null;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      <ScreenHeader title="Application" />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {error ? (
          <View
            style={[
              styles.notice,
              { borderColor: 'rgba(229,72,77,0.3)', backgroundColor: 'rgba(229,72,77,0.1)' },
            ]}
          >
            <Text style={[styles.noticeText, { color: colors.destructive }]}>{error}</Text>
          </View>
        ) : null}

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.identity}>
            <PersonAvatar name={applicant.name} url={applicant.avatar_url} size={96} />
            <Text style={[styles.name, { color: colors.foreground }]}>{applicant.name}</Text>
            {applicant.role_label ? (
              <Text style={[styles.role, { color: colors.foregroundMuted }]}>
                {applicant.role_label}
              </Text>
            ) : null}
            {applicant.city_name ? (
              <View style={styles.cityRow}>
                <Feather name="map-pin" size={11} color={colors.foregroundSubtle} />
                <Text style={[styles.city, { color: colors.foregroundSubtle }]}>
                  {applicant.city_name}
                </Text>
              </View>
            ) : null}
            <Text style={[styles.applied, { color: colors.foregroundSubtle }]}>
              Applied {applicant.applied_label}
            </Text>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.decisionBlock}>
            {pendingId === applicant.id ? (
              <ActivityIndicator color={colors.foregroundMuted} />
            ) : (
              <DecisionCluster
                status={applicant.status}
                onChange={(status) => void changeStatus(status)}
                size="md"
              />
            )}
            <Text style={[styles.statusLine, { color: colors.foregroundSubtle }]}>
              {applicant.status === 'new'
                ? 'Not reviewed yet'
                : `Standing: ${applicationStatusLabel(applicant.status)}`}
            </Text>
            {decisionErrorForApplicant ? (
              <Text
                style={[styles.errorText, { color: colors.destructive }]}
                accessibilityLiveRegion="polite"
              >
                {decisionErrorForApplicant}
              </Text>
            ) : null}
            {undo && undo.applicantId === applicant.id ? (
              <View style={[styles.undoInline, { borderColor: colors.border }]}>
                <Text style={[styles.undoInlineText, { color: colors.foregroundMuted }]}>
                  Decision saved.
                </Text>
                <Pressable onPress={() => void undoStatus()} accessibilityRole="button" hitSlop={6}>
                  <Text style={[styles.undoInlineAction, { color: colors.accent }]}>Undo</Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.pager}>
            <Pressable
              onPress={() => goTo(index - 1)}
              disabled={index === 0}
              accessibilityRole="button"
              accessibilityLabel="Previous applicant"
              style={({ pressed }) => [
                styles.pagerButton,
                {
                  backgroundColor: pressed && index > 0 ? colors.surfaceRaised : 'transparent',
                  opacity: index === 0 ? 0.3 : 1,
                },
              ]}
            >
              <Feather name="chevron-left" size={18} color={colors.foregroundMuted} />
            </Pressable>
            <Text style={[styles.pagerText, { color: colors.foregroundSubtle }]}>
              {index + 1} of {applicants.length}
            </Text>
            <Pressable
              onPress={() => goTo(index + 1)}
              disabled={index === applicants.length - 1}
              accessibilityRole="button"
              accessibilityLabel="Next applicant"
              style={({ pressed }) => [
                styles.pagerButton,
                {
                  backgroundColor:
                    pressed && index < applicants.length - 1 ? colors.surfaceRaised : 'transparent',
                  opacity: index === applicants.length - 1 ? 0.3 : 1,
                },
              ]}
            >
              <Feather name="chevron-right" size={18} color={colors.foregroundMuted} />
            </Pressable>
          </View>
        </View>

        <View style={styles.linksSection}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Submitted links
          </Text>
          <Text style={[styles.sectionHint, { color: colors.foregroundSubtle }]}>
            Each link opens in the in-app browser, exactly as the applicant submitted it.
          </Text>
          <View style={[styles.linkList, { borderColor: colors.border }]}>
            {links.map((link, linkIndex) => (
              <Pressable
                key={link.key}
                onPress={() => void openLink(link.url)}
                accessibilityRole="link"
                style={({ pressed }) => [
                  styles.linkRow,
                  linkIndex > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border } : null,
                  { backgroundColor: pressed ? colors.surfaceRaised : 'transparent' },
                ]}
              >
                <View style={[styles.linkIcon, { backgroundColor: colors.accentSoft }]}>
                  <Feather name={link.icon} size={15} color={colors.accent} />
                </View>
                <View style={styles.linkText}>
                  <Text style={[styles.linkTitle, { color: colors.foreground }]}>{link.label}</Text>
                  <Text style={[styles.linkUrl, { color: colors.foregroundMuted }]} numberOfLines={1}>
                    {link.url.replace(/^https?:\/\//, '')}
                  </Text>
                </View>
                <Feather name="arrow-up-right" size={15} color={colors.foregroundMuted} />
              </Pressable>
            ))}
          </View>
          {links.some((link) => link.key === 'linkedin') ? (
            <Text style={[styles.sectionHint, { color: colors.foregroundSubtle }]}>
              LinkedIn blocks embedding, so its profile opens in the browser rather than the page.
            </Text>
          ) : null}
        </View>
      </ScrollView>
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
  notice: { borderRadius: 10, borderWidth: 1, padding: 10 },
  noticeText: { fontFamily: 'Geist_400Regular', fontSize: 12, lineHeight: 17 },

  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 12,
  },
  identity: { alignItems: 'center', gap: 4, paddingVertical: 4 },
  name: { fontFamily: 'Geist_600SemiBold', fontSize: 21, marginTop: 6 },
  role: { fontFamily: 'Geist_400Regular', fontSize: 13 },
  cityRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  city: { fontFamily: 'Geist_400Regular', fontSize: 11.5 },
  applied: { fontFamily: 'Geist_400Regular', fontSize: 11.5 },
  divider: { height: StyleSheet.hairlineWidth, width: '100%' },
  decisionBlock: { gap: 8 },
  statusLine: { fontFamily: 'Geist_400Regular', fontSize: 11.5 },
  errorText: { fontFamily: 'Geist_400Regular', fontSize: 11.5, lineHeight: 16 },
  undoInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  undoInlineText: { flex: 1, fontFamily: 'Geist_400Regular', fontSize: 11.5 },
  undoInlineAction: { fontFamily: 'Geist_600SemiBold', fontSize: 12 },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pagerButton: {
    width: 40,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pagerText: { fontFamily: 'Geist_400Regular', fontSize: 12 },

  linksSection: { gap: 8 },
  sectionTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 15 },
  sectionHint: { fontFamily: 'Geist_400Regular', fontSize: 11.5, lineHeight: 16 },
  linkList: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  linkIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkText: { flex: 1, gap: 1 },
  linkTitle: { fontFamily: 'Geist_500Medium', fontSize: 13.5 },
  linkUrl: { fontFamily: 'Geist_400Regular', fontSize: 11.5 },
});
