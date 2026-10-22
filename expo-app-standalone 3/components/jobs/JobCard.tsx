import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { CompanyMark } from '@/components/companies/CompanyMark';
import { useColors } from '@/hooks/useColors';
import {
  experienceYearsLabel,
  workModeLabel,
  type JobPost,
  type JobStatus,
} from '@/lib/jobs';
import { AMBER, JobStateBadge, KindBadge, LockedNote } from './JobBadges';
import { JobOwnerActions } from './JobOwnerActions';

interface Props {
  job: JobPost;
  onPress: () => void;
  /** Only the owner's list shows the posting's menu. */
  showOwnerActions?: boolean;
  onEdit?: () => void;
  onOwnerChanged?: (jobId: string, status: JobStatus) => void;
  onOwnerDeleted?: () => void;
}

/**
 * The LinkedIn-shaped row the web board uses: the title leads, one line
 * carries company · city (work mode) · salary, and the posting's stamps sit
 * under it. The four targeting criteria live on the detail screen — the card
 * keeps the scan cheap.
 */
export function JobCard({
  job,
  onPress,
  showOwnerActions = false,
  onEdit,
  onOwnerChanged,
  onOwnerDeleted,
}: Props) {
  const colors = useColors();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${job.title} at ${job.company.name}`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <CompanyMark name={job.company.name} logoUrl={job.company.logo_url} size={40} />

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <View style={styles.titleText}>
            <Text style={[styles.title, { color: colors.accent }]} numberOfLines={1}>
              {job.title}
            </Text>
            <Text style={[styles.years, { color: colors.foregroundMuted }]} numberOfLines={1}>
              {experienceYearsLabel(job.experience_level_label)}
            </Text>
          </View>
          <View style={styles.badges}>
            <JobStateBadge job={job} />
            <KindBadge kind={job.kind} />
            {showOwnerActions && job.is_mine ? (
              <JobOwnerActions
                job={job}
                compact
                onEdit={onEdit}
                onChanged={onOwnerChanged}
                onDeleted={onOwnerDeleted}
              />
            ) : null}
          </View>
        </View>

        <Text style={[styles.meta, { color: colors.foregroundMuted }]} numberOfLines={1}>
          {job.company.name}
          <Text style={{ color: colors.foregroundSubtle }}>{'  •  '}</Text>
          {job.city_name} ({workModeLabel(job.work_mode)})
          {job.salary ? (
            <>
              <Text style={{ color: colors.foregroundSubtle }}>{'  •  '}</Text>
              {job.salary}
            </>
          ) : null}
        </Text>

        <View style={styles.footer}>
          <Text style={[styles.stamps, { color: colors.foregroundSubtle }]} numberOfLines={1}>
            {job.posted_label}
            {job.updated_label ? ` · ${job.updated_label}` : ''}
            {job.deadline_label ? (
              <Text style={job.deadline_expired ? { color: AMBER } : undefined}>
                {` · ${job.deadline_label}`}
              </Text>
            ) : null}
          </Text>

          {job.is_mine ? (
            <View style={styles.statusRow}>
              <Feather name="users" size={11} color={colors.foregroundMuted} />
              <Text style={[styles.statusText, { color: colors.foregroundMuted }]}>
                {job.applicant_count} applicant{job.applicant_count === 1 ? '' : 's'}
              </Text>
            </View>
          ) : job.applied ? (
            <View style={styles.statusRow}>
              <Feather name="check-circle" size={12} color={colors.success} />
              <Text style={[styles.statusText, { color: colors.success }]}>Applied</Text>
            </View>
          ) : job.can_apply ? (
            <Text style={[styles.statusText, { color: colors.accent }]}>You match this role</Text>
          ) : (
            <LockedNote>Locked for your profile</LockedNote>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  body: { flex: 1, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  titleText: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontFamily: 'Geist_600SemiBold', fontSize: 15, flexShrink: 1 },
  years: { fontFamily: 'Geist_400Regular', fontSize: 11.5 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingTop: 1 },
  meta: { fontFamily: 'Geist_400Regular', fontSize: 12.5, lineHeight: 18 },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 12,
    rowGap: 4,
    marginTop: 3,
  },
  stamps: { fontFamily: 'Geist_400Regular', fontSize: 11.5, flexShrink: 1 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusText: { fontFamily: 'Geist_500Medium', fontSize: 11 },
});
