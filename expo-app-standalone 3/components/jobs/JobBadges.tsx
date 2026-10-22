import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { jobKindLabel, type JobKind, type JobPost } from '@/lib/jobs';

/** Web `text-amber-500` / `text-indigo-400` — not theme colours. */
export const AMBER = '#F59E0B';
export const INDIGO = '#818CF8';

/** A neutral outlined chip for job facts (skills, work mode, …). */
export function MetaChip({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={[styles.chip, { borderColor: colors.border }]}>
      <Text style={[styles.chipText, { color: colors.foregroundMuted }]}>{children}</Text>
    </View>
  );
}

/** The posting's intent, as plain hashtag text. */
export function KindBadge({ kind }: { kind: JobKind }) {
  return (
    <Text style={[styles.kind, { color: kind === 'hiring' ? AMBER : INDIGO }]}>
      #{jobKindLabel(kind)}
    </Text>
  );
}

export function ClosedBadge() {
  const colors = useColors();
  return (
    <View style={[styles.stateBadge, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}>
      <Feather name="lock" size={10} color={colors.foregroundMuted} />
      <Text style={[styles.stateText, { color: colors.foregroundMuted }]}>Closed</Text>
    </View>
  );
}

export function ExpiredBadge() {
  return (
    <View style={[styles.stateBadge, { borderColor: 'rgba(245,158,11,0.4)', backgroundColor: 'rgba(245,158,11,0.10)' }]}>
      <Feather name="clock" size={10} color={AMBER} />
      <Text style={[styles.stateText, { color: AMBER }]}>Expired</Text>
    </View>
  );
}

/** The one lifecycle badge a posting earns; Closed wins over Expired. */
export function JobStateBadge({ job }: { job: Pick<JobPost, 'status' | 'deadline_expired'> }) {
  if (job.status === 'closed') return <ClosedBadge />;
  if (job.deadline_expired) return <ExpiredBadge />;
  return null;
}

/** The eligibility lock, shown wherever Apply is refused by the profile. */
export function LockedNote({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.locked}>
      <Feather name="lock" size={12} color={colors.foregroundMuted} />
      <Text style={[styles.lockedText, { color: colors.foregroundMuted }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: { fontFamily: 'Geist_500Medium', fontSize: 11 },
  kind: { fontFamily: 'Geist_500Medium', fontSize: 11 },
  stateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  stateText: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 9.5,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  locked: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lockedText: { fontFamily: 'Geist_400Regular', fontSize: 12 },
});
