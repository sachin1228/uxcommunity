import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import Svg, { Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

const STEPS = [
  { at: 10, label: 'Creating your account' },
  { at: 30, label: 'Adding your profile details' },
  { at: 55, label: 'Joining your communities' },
  { at: 80, label: 'Preparing your dashboard' },
];

const RING_SIZE = 132;
const RING_STROKE = 6;
const RADIUS = (RING_SIZE - RING_STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function currentStepIndex(progress: number): number {
  let index = -1;
  STEPS.forEach((step, i) => {
    if (progress >= step.at) index = i;
  });
  return index;
}

/**
 * The mobile port of the web's `SignupWelcome` overlay: the setup screen the
 * member sees while the account is created, then the all-set screen with the
 * way into the app. Progress is a believable fake, exactly like the web —
 * it crawls toward 92% until the real request answers.
 */
export function SignupWelcome({
  phase,
  firstName,
  joinedCommunities,
  onGoToDashboard,
}: {
  phase: 'loading' | 'ready';
  firstName: string;
  joinedCommunities: number;
  onGoToDashboard: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top,
          paddingBottom: Math.max(insets.bottom, 16),
        },
      ]}
    >
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      {phase === 'loading' ? (
        <LoadingPhase firstName={firstName} />
      ) : (
        <ReadyPhase
          firstName={firstName}
          joinedCommunities={joinedCommunities}
          onGoToDashboard={onGoToDashboard}
        />
      )}
    </View>
  );
}

function LoadingPhase({ firstName }: { firstName: string }) {
  const colors = useColors();
  const [progress, setProgress] = useState(4);

  useEffect(() => {
    const timer = setInterval(() => {
      setProgress((previous) => {
        if (previous >= 92) return previous;
        const remaining = 92 - previous;
        const step = Math.max(
          1,
          Math.min(7, Math.round(remaining / 14) + (Math.random() > 0.7 ? 2 : 0)),
        );
        return Math.min(92, previous + step);
      });
    }, 130);
    return () => clearInterval(timer);
  }, []);

  const activeIndex = currentStepIndex(progress);
  const dashOffset = CIRCUMFERENCE * (1 - progress / 100);

  return (
    <View style={styles.phase}>
      <View style={styles.ringWrap}>
        <Svg width={RING_SIZE} height={RING_SIZE} style={styles.ringSvg}>
          <Circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={colors.border}
            strokeWidth={RING_STROKE}
          />
          <Circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={colors.accent}
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            strokeDashoffset={dashOffset}
          />
        </Svg>
        <View style={styles.ringCenter}>
          <Text style={[styles.percent, { color: colors.foreground }]}>
            {Math.round(progress)}%
          </Text>
        </View>
      </View>

      <Text style={[styles.loadingTitle, { color: colors.foreground }]}>
        Welcome{firstName ? `, ${firstName}` : ''}!
      </Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Setting everything up for you — this will only take a moment.
      </Text>

      <View style={styles.checklist}>
        {STEPS.map((step, index) => {
          const done = progress >= step.at;
          const active = index === activeIndex && progress < 92;
          return (
            <View
              key={step.label}
              style={[
                styles.stepRow,
                {
                  borderColor: done ? colors.border : 'transparent',
                  backgroundColor: done ? colors.surface : 'transparent',
                },
              ]}
            >
              {done ? (
                <View style={[styles.stepIconDone, { backgroundColor: colors.accent }]}>
                  <Feather name="check" size={12} color={colors.accentForeground} />
                </View>
              ) : active ? (
                <View style={styles.stepIcon}>
                  <ActivityIndicator size="small" color={colors.accent} />
                </View>
              ) : (
                <View style={styles.stepIcon}>
                  <View style={[styles.pendingDot, { backgroundColor: colors.foregroundSubtle }]} />
                </View>
              )}
              <Text
                style={[
                  styles.stepLabel,
                  {
                    color: done || active ? colors.foreground : colors.foregroundSubtle,
                    fontFamily: done || active ? 'Geist_500Medium' : 'Geist_400Regular',
                  },
                ]}
              >
                {step.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function ReadyPhase({
  firstName,
  joinedCommunities,
  onGoToDashboard,
}: {
  firstName: string;
  joinedCommunities: number;
  onGoToDashboard: () => void;
}) {
  const colors = useColors();
  const countLabel =
    joinedCommunities === 1 ? '1 community' : `${joinedCommunities} communities`;

  return (
    <View style={styles.phase}>
      <View style={styles.readyMarkWrap}>
        <View style={[styles.readyMark, { backgroundColor: colors.accent }]}>
          <Feather name="check" size={34} color={colors.accentForeground} />
        </View>
        <View style={[styles.readyBadge, { backgroundColor: colors.surfaceRaised }]}>
          <Text style={styles.readyEmoji}>🎉</Text>
        </View>
      </View>

      <Text style={[styles.readyTitle, { color: colors.foreground }]}>
        You're all set{firstName ? `, ${firstName}` : ''}!
      </Text>
      <Text style={[styles.readyBody, { color: colors.mutedForeground }]}>
        {joinedCommunities > 0 ? (
          <>
            Your account is ready and you've been added to{' '}
            <Text style={[styles.readyStrong, { color: colors.foreground }]}>{countLabel}</Text>{' '}
            — your communities are all waiting for you.
          </>
        ) : (
          "Your account is ready. Let's get you inside!"
        )}
      </Text>

      <Pressable
        onPress={onGoToDashboard}
        accessibilityRole="button"
        accessibilityLabel="Go to dashboard"
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: pressed ? colors.accentHover : colors.accent },
        ]}
      >
        <Text style={[styles.buttonText, { color: colors.accentForeground }]}>
          Go to Dashboard →
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  phase: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  ringWrap: { width: RING_SIZE, height: RING_SIZE },
  ringSvg: { transform: [{ rotate: '-90deg' }] },
  ringCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  percent: { fontSize: 24, fontFamily: 'Geist_600SemiBold' },
  loadingTitle: {
    marginTop: 30,
    fontSize: 24,
    fontFamily: 'Geist_700Bold',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'Geist_400Regular',
    textAlign: 'center',
  },
  checklist: { marginTop: 28, width: '100%', gap: 10 },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  stepIcon: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  stepIconDone: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingDot: { width: 8, height: 8, borderRadius: 4, opacity: 0.5 },
  stepLabel: { flex: 1, fontSize: 14 },
  readyMarkWrap: { width: 80, height: 80 },
  readyMark: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readyBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readyEmoji: { fontSize: 15 },
  readyTitle: {
    marginTop: 30,
    fontSize: 28,
    fontFamily: 'Geist_700Bold',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  readyBody: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: 'Geist_400Regular',
    textAlign: 'center',
  },
  readyStrong: { fontFamily: 'Geist_500Medium' },
  button: {
    marginTop: 32,
    width: '100%',
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 15, fontFamily: 'Geist_600SemiBold' },
});
