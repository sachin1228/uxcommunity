/**
 * One posting on the jobs board — the mobile rendering of the web JobCard:
 * company logo (server-resolved, else initial), title with the years range,
 * the kind hashtag, the lifecycle badge, the meta line and the footer labels
 * (all server-rendered). The footer's right side carries the viewer's state:
 * applicant count (own post), Applied, the match note, or the profile lock.
 */

import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import {
  experienceYearsLabel,
  jobKindLabel,
  workModeLabel,
  type JobPost,
} from '@/lib/jobs';

const AMBER = '#F59E0B';
const INDIGO = '#818CF8';
const EMERALD = '#10B981';

export function JobCard({ job, onPress }: { job: JobPost; onPress: () => void }) {
  const colors = useColors();
  const [logoFailed, setLogoFailed] = useState(false);

  const logoUrl = job.company.logo_url && !logoFailed ? job.company.logo_url : null;
  const kindColor = job.kind === 'hiring' ? AMBER : INDIGO;

  const meta = [
    job.company.name,
    `${job.city_name} (${workModeLabel(job.work_mode)})`,
    job.salary ?? null,
  ]
    .filter(Boolean)
    .join(' • ');

  const footerLabels = [job.posted_label, job.updated_label, job.deadline_label].filter(
    Boolean,
  ) as string[];

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
        pressed && { backgroundColor: colors.surfaceRaised },
      ]}
    >
      <View style={styles.topRow}>
        {logoUrl ? (
          <Image
            source={{ uri: logoUrl }}
            style={[styles.logo, { borderColor: colors.border, backgroundColor: colors.surface }]}
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <View
            style={[
              styles.logo,
              styles.logoFallback,
              { borderColor: colors.border, backgroundColor: colors.surfaceRaised },
            ]}
          >
            <Text style={[styles.logoInitial, { color: colors.mutedForeground }]}>
              {job.company.name.trim()[0]?.toUpperCase() ?? '?'}
            </Text>
          </View>
        )}

        <View style={styles.titleBlock}>
          <View style={styles.titleRow}>
            <Text
              style={[styles.title, { color: colors.accent }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {job.title}
            </Text>
            <Text style={[styles.kind, { color: kindColor }]}>#{jobKindLabel(job.kind)}</Text>
          </View>
          <Text style={[styles.years, { color: colors.mutedForeground }]} numberOfLines={1}>
            {experienceYearsLabel(job.experience_level_label)}
          </Text>
        </View>

        {job.status === 'closed' ? (
          <View
            style={[
              styles.stateBadge,
              { borderColor: colors.border, backgroundColor: colors.surfaceRaised },
            ]}
          >
            <Feather name="lock" size={10} color={colors.mutedForeground} />
            <Text style={[styles.stateBadgeText, { color: colors.mutedForeground }]}>Closed</Text>
          </View>
        ) : job.deadline_expired ? (
          <View style={[styles.stateBadge, styles.expiredBadge]}>
            <Feather name="clock" size={10} color={AMBER} />
            <Text style={[styles.stateBadgeText, { color: AMBER }]}>Expired</Text>
          </View>
        ) : null}
      </View>

      <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
        {meta}
      </Text>

      <View style={styles.footer}>
        <Text
          style={[
            styles.footerLabels,
            { color: job.deadline_expired ? AMBER : colors.foregroundSubtle },
          ]}
          numberOfLines={1}
        >
          {footerLabels.join(' · ')}
        </Text>

        {job.is_mine ? (
          <Text style={[styles.footerNote, { color: colors.mutedForeground }]}>
            {job.applicant_count} {job.applicant_count === 1 ? 'applicant' : 'applicants'}
          </Text>
        ) : job.applied ? (
          <View style={styles.footerChip}>
            <Feather name="check" size={12} color={EMERALD} />
            <Text style={[styles.footerNote, { color: EMERALD }]}>Applied</Text>
          </View>
        ) : job.can_apply ? (
          <Text style={[styles.footerNote, { color: colors.accent }]}>You match this role</Text>
        ) : (
          <View style={styles.footerChip}>
            <Feather name="lock" size={11} color={colors.mutedForeground} />
            <Text style={[styles.footerNote, { color: colors.mutedForeground }]}>
              Locked for your profile
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 8,
  },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  logoFallback: { alignItems: 'center', justifyContent: 'center' },
  logoInitial: { fontFamily: 'Geist_600SemiBold', fontSize: 14, textTransform: 'uppercase' },
  titleBlock: { flex: 1, minWidth: 0, gap: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontFamily: 'Geist_600SemiBold', fontSize: 14.5 },
  kind: { fontFamily: 'Geist_500Medium', fontSize: 11.5 },
  years: { fontFamily: 'Geist_400Regular', fontSize: 12 },
  stateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  expiredBadge: { borderColor: 'rgba(245, 158, 11, 0.4)', backgroundColor: 'rgba(245, 158, 11, 0.1)' },
  stateBadgeText: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 9.5,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  meta: { fontFamily: 'Geist_400Regular', fontSize: 12.5 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  footerLabels: { flex: 1, fontFamily: 'Geist_400Regular', fontSize: 11.5 },
  footerChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  footerNote: { fontFamily: 'Geist_500Medium', fontSize: 11.5 },
});
