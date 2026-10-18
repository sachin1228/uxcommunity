import React, { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { blue } from '@/constants/designSystem';
import { useColors } from '@/hooks/useColors';
import { hapticSelection } from '@/lib/haptics';
import {
  normalizePollCounts,
  percentageParts,
  pollOptionLetter,
  pollTotal,
  type PollViewState,
  type ThreadPoll,
} from '@/lib/communityPoll';

/**
 * The thread poll, ported from the web `PollResult`:
 *
 *  - Not voted: the question (unless it is already the post body) and plain
 *    selectable options only — no counts, percentages or bars, so the voter is
 *    not influenced.
 *  - Voted: results with percentage bars, the total, and the viewer's choice
 *    marked with a check. Votes are final.
 *  - One undo per poll, then the viewer may vote again; that second vote is
 *    final. The API enforces the rule, this component only offers the control.
 *
 * Voting is optimistic, exactly like the web card: the results appear on tap
 * and are reconciled with the server's counts (or rolled back on failure).
 */
export function ThreadPollView({
  poll,
  state,
  hideQuestion = false,
  onVote,
  onUndo,
}: {
  poll: ThreadPoll;
  state: PollViewState;
  /** The poll question is already the thread body — don't print it twice. */
  hideQuestion?: boolean;
  onVote: (optionIndex: number) => Promise<void>;
  onUndo: () => Promise<void>;
}) {
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // State flushes asynchronously, so a second tap in the same tick would get
  // past `busy` — this ref is the synchronous guard.
  const busyRef = useRef(false);

  const options = Array.isArray(poll.options) ? poll.options : [];
  const counts = normalizePollCounts(poll, state.counts);
  const totalVotes = pollTotal(counts);
  const selected = state.userVote;
  const hasVoted = selected !== null;
  const percents = percentageParts(counts, totalVotes);
  const canUndo = hasVoted && !state.undoUsed;
  const grid = options.length > 2;

  async function run(
    action: () => Promise<void>,
    options: { pendingOption?: number; undo?: boolean } = {},
  ) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setPending(options.pendingOption ?? null);
    setUndoBusy(Boolean(options.undo));
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      busyRef.current = false;
      setBusy(false);
      setPending(null);
      setUndoBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      {!hideQuestion && poll.question ? (
        <Text style={[styles.question, { color: colors.foreground }]}>
          {poll.question}
        </Text>
      ) : null}

      {options.length > 0 ? (
        hasVoted ? (
          <View style={[styles.options, grid ? styles.optionsGrid : null]}>
            {options.map((option, index) => {
              const isSelected = selected === index;
              return (
                <View
                  key={index}
                  style={[
                    styles.resultCard,
                    grid ? styles.half : null,
                    {
                      borderColor: isSelected ? colors.foregroundSubtle : colors.border,
                      backgroundColor: isSelected ? colors.accentSoft : colors.background,
                    },
                  ]}
                  accessibilityLabel={`${option}, ${percents[index]} percent${isSelected ? ', your vote' : ''}`}
                >
                  <View style={styles.resultTop}>
                    {isSelected ? (
                      <View style={[styles.badge, styles.badgeSelected]}>
                        <Feather name="check" size={12} color="#FFFFFF" />
                      </View>
                    ) : (
                      <View
                        style={[
                          styles.badge,
                          { borderColor: colors.border, backgroundColor: colors.surface },
                        ]}
                      >
                        <Text style={[styles.badgeLetter, { color: colors.foreground }]}>
                          {pollOptionLetter(index)}
                        </Text>
                      </View>
                    )}
                    <Text
                      style={[styles.optionText, styles.resultOptionText, { color: colors.foreground }]}
                    >
                      {option}
                    </Text>
                    <Text style={[styles.percent, { color: colors.foreground }]}>
                      {percents[index]}%
                    </Text>
                  </View>
                  <View style={[styles.barTrack, { backgroundColor: colors.border }]}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          width: `${percents[index]}%` as `${number}%`,
                          backgroundColor: colors.accent,
                        },
                      ]}
                    />
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <View
            style={[styles.options, grid ? styles.optionsGrid : null]}
            accessibilityRole="radiogroup"
            accessibilityLabel="Poll options"
          >
            {options.map((option, index) => (
              <Pressable
                key={index}
                onPress={() => {
                  hapticSelection();
                  void run(() => onVote(index), { pendingOption: index });
                }}
                disabled={busy}
                accessibilityRole="radio"
                accessibilityState={{ checked: false, disabled: busy }}
                accessibilityLabel={`Vote for ${pollOptionLetter(index)}. ${option}`}
                style={[
                  styles.optionButton,
                  grid ? styles.half : null,
                  { borderColor: colors.border, backgroundColor: colors.background },
                ]}
              >
                <View
                  style={[
                    styles.badge,
                    { borderColor: colors.border, backgroundColor: colors.surface },
                  ]}
                >
                  {pending === index ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Text style={[styles.badgeLetter, { color: colors.foregroundSubtle }]}>
                      {pollOptionLetter(index)}
                    </Text>
                  )}
                </View>
                <Text style={[styles.optionText, { color: colors.foreground }]}>
                  {option}
                </Text>
              </Pressable>
            ))}
          </View>
        )
      ) : null}

      <View style={styles.footer}>
        <Text
          style={[styles.meta, { color: colors.foregroundSubtle }]}
          accessibilityLiveRegion="polite"
        >
          <Text style={[styles.metaStrong, { color: colors.foreground }]}>
            {totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}
          </Text>
          {hasVoted ? ` · You voted for ${options[selected] ?? 'an option'}` : ''}
        </Text>
        {canUndo ? (
          <Pressable
            onPress={() => void run(onUndo, { undo: true })}
            disabled={busy}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Undo your vote — you can undo only once"
            accessibilityState={{ disabled: busy }}
          >
            <Text style={[styles.undo, { color: colors.accent }]}>
              {undoBusy ? 'Undoing…' : 'Undo'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <Text style={[styles.error, { color: colors.destructive }]} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  question: { fontFamily: 'Geist_500Medium', fontSize: 14, lineHeight: 20 },
  options: { gap: 8 },
  optionsGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  half: { width: '48.5%' },
  optionButton: {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  resultCard: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 7,
  },
  resultTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeSelected: { backgroundColor: blue[800], borderColor: blue[800] },
  badgeLetter: { fontFamily: 'Geist_600SemiBold', fontSize: 10 },
  optionText: { flex: 1, fontFamily: 'Geist_400Regular', fontSize: 14, lineHeight: 19 },
  // Web results use font-medium; the pre-vote options stay regular.
  resultOptionText: { fontFamily: 'Geist_500Medium' },
  percent: { fontFamily: 'Geist_500Medium', fontSize: 12 },
  barTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },
  footer: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  meta: { fontFamily: 'Geist_400Regular', fontSize: 11, lineHeight: 15, flexShrink: 1 },
  metaStrong: { fontFamily: 'Geist_600SemiBold' },
  undo: { fontFamily: 'Geist_500Medium', fontSize: 11 },
  error: { fontFamily: 'Geist_500Medium', fontSize: 12, lineHeight: 17 },
});
