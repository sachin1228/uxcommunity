import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';
import { apiFetch } from '@/lib/api';

/**
 * The creation budgets as a ring beside the bell — the mobile port of
 * `apps/web/app/dashboard/LimitsRing.tsx`.
 *
 * The ring is the member's tightest budget, the one closest to refusing the
 * next post, so a full circle means "something will be refused right now".
 * Opening it lists all six with what is used and what frees the slot.
 *
 * The numbers come from `/api/limits`, which reads the same live rows the
 * database triggers count; a budget the server could not read is left out
 * rather than shown as zero. The panel is the always-dark overlay surface the
 * web dropdown uses (`tone="overlay"`), so both clients show the same card.
 */

interface UsageRow {
  kind: string;
  used: number;
  limit: number;
}

interface Payload {
  limits: UsageRow[];
  pendingJoinRequests: number;
}

const LABELS: Record<string, { label: string; freedBy: string }> = {
  posts_daily: { label: 'Posts today', freedBy: 'Delete a post to write another' },
  events_monthly: { label: 'Events this month', freedBy: 'Delete an event to host another' },
  jobs_monthly: { label: 'Job posts this month', freedBy: 'Delete a posting to add another' },
  dms_monthly: { label: 'New DMs this month', freedBy: 'DMs already started stay open' },
  communities_total: { label: 'Your communities', freedBy: 'Delete one to create another' },
  community_joins: { label: 'Communities joined', freedBy: 'Leave one to join another' },
};

const ORDER = Object.keys(LABELS);

const RADIUS = 7;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function LimitsRing() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<Payload | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await apiFetch<Payload>('/api/limits');
      setPayload(data);
    } catch {
      // The header stays up; the ring simply has nothing to report.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = (payload?.limits ?? [])
    .filter((row) => LABELS[row.kind])
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));

  const tightest = rows.reduce<UsageRow | null>(
    (worst, row) => (!worst || row.used / row.limit > worst.used / worst.limit ? row : worst),
    null
  );
  const ratio = tightest ? Math.min(1, tightest.used / tightest.limit) : 0;
  const atCap = rows.some((row) => row.used >= row.limit);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          tightest
            ? `Creation limits — ${LABELS[tightest.kind].label.toLowerCase()}: ${tightest.used} of ${tightest.limit} used`
            : 'Creation limits'
        }
        hitSlop={6}
        onPress={() => {
          setOpen(true);
          void load();
        }}
        style={({ pressed }) => [styles.trigger, { opacity: pressed ? 0.8 : 1 }]}
      >
        <Svg width={20} height={20} viewBox="0 0 18 18">
          <Circle
            cx={9}
            cy={9}
            r={RADIUS}
            fill="none"
            stroke={colors.overlayElevated}
            strokeWidth={2}
          />
          <Circle
            cx={9}
            cy={9}
            r={RADIUS}
            fill="none"
            stroke={atCap ? colors.destructive : colors.accent}
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={`${ratio * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            rotation={-90}
            originX={9}
            originY={9}
          />
        </Svg>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          style={[styles.sheet, { paddingTop: insets.top + 58, paddingRight: 16 }]}
          onPress={() => setOpen(false)}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={[
              styles.card,
              {
                backgroundColor: colors.overlay,
                borderColor: colors.overlayElevated,
              },
            ]}
          >
            <View style={[styles.cardHeader, { borderBottomColor: colors.overlayElevated }]}>
              <Text style={[styles.cardTitle, { color: colors.overlayForeground }]}>
                Creation limits
              </Text>
              <Text style={[styles.cardSubtitle, { color: colors.overlayMuted }]}>
                What you have used of this month’s budgets.
              </Text>
            </View>

            <View style={styles.rows}>
              {rows.map((row) => {
                const meta = LABELS[row.kind];
                const full = row.used >= row.limit;
                const pending = payload?.pendingJoinRequests ?? 0;
                return (
                    <View key={row.kind}>
                    <View style={styles.rowTop}>
                      <Text style={[styles.rowLabel, { color: colors.overlayForeground }]}>
                        {meta.label}
                      </Text>
                      <Text
                        style={[
                          styles.rowCount,
                          { color: full ? colors.destructive : colors.overlayMuted },
                        ]}
                      >
                        {row.used} of {row.limit}
                      </Text>
                    </View>
                    <View style={[styles.track, { backgroundColor: colors.overlayElevated }]}>
                      <View
                        style={[
                          styles.fill,
                          {
                            backgroundColor: full ? colors.destructive : colors.overlayForeground,
                            width: `${Math.min(100, (row.used / row.limit) * 100)}%`,
                          },
                        ]}
                      />
                    </View>
                    {full ? (
                      <Text style={[styles.note, { color: colors.overlayMuted }]}>
                        {meta.freedBy}
                      </Text>
                    ) : null}
                    {row.kind === 'community_joins' && pending > 0 ? (
                      <Text style={[styles.note, { color: colors.overlayMuted }]}>
                        {pending} join request{pending === 1 ? '' : 's'} still pending.
                      </Text>
                    ) : null}
                  </View>
                );
              })}
              {rows.length === 0 ? (
                <Text style={[styles.note, { color: colors.overlayMuted }]}>
                  Limits are unavailable right now.
                </Text>
              ) : null}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The card hangs from the header's right edge, where the trigger sits.
  sheet: {
    flex: 1,
    alignItems: 'flex-end',
  },
  card: {
    width: 268,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },
  cardHeader: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cardTitle: { fontSize: 14, fontFamily: 'Geist_600SemiBold', lineHeight: 19 },
  cardSubtitle: {
    fontSize: 12,
    fontFamily: 'Geist_400Regular',
    lineHeight: 16,
    marginTop: 4,
  },
  rows: { paddingHorizontal: 16, paddingVertical: 14, gap: 13 },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowLabel: { fontSize: 12, fontFamily: 'Geist_400Regular', flexShrink: 1 },
  rowCount: { fontSize: 12, fontFamily: 'Geist_500Medium' },
  track: {
    height: 4,
    borderRadius: 2,
    marginTop: 6,
    overflow: 'hidden',
  },
  fill: { height: 4, borderRadius: 2 },
  note: {
    fontSize: 11,
    fontFamily: 'Geist_400Regular',
    lineHeight: 15,
    marginTop: 4,
  },
});
