import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { hapticSelection } from '@/lib/haptics';
import { applicationStatusLabel, type ApplicationStatus } from '@/lib/jobs';

/**
 * The decision cluster: the standing as a segmented pair. The active decision
 * is filled and tapping it moves the applicant back to New (the accessibility
 * hint says so); the other decision stays one tap away for a change of mind.
 * A new applicant gets the two decisions as plain actions.
 */
export function DecisionCluster({
  status,
  onChange,
  size = 'sm',
}: {
  status: ApplicationStatus;
  onChange: (status: ApplicationStatus) => void;
  size?: 'sm' | 'md';
}) {
  const colors = useColors();
  const height = size === 'md' ? 38 : 30;
  const textSize = size === 'md' ? 12.5 : 11;
  const iconSize = size === 'md' ? 13 : 12;

  if (status !== 'new') {
    const other: ApplicationStatus = status === 'shortlisted' ? 'rejected' : 'shortlisted';
    const activeColor = status === 'shortlisted' ? colors.success : colors.destructive;
    const otherColor = other === 'shortlisted' ? colors.success : colors.destructive;

    return (
      <View style={styles.row}>
        <Pressable
          onPress={() => {
            hapticSelection();
            onChange('new');
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: true }}
          accessibilityHint="Move back to New"
          style={[
            styles.pill,
            {
              height,
              borderColor: activeColor,
              backgroundColor:
                status === 'shortlisted' ? 'rgba(34,197,94,0.15)' : 'rgba(229,72,77,0.15)',
            },
          ]}
        >
          <Feather
            name={status === 'shortlisted' ? 'check' : 'x'}
            size={iconSize}
            color={activeColor}
          />
          <Text style={[styles.label, { color: activeColor, fontSize: textSize }]}>
            {applicationStatusLabel(status)}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            hapticSelection();
            onChange(other);
          }}
          accessibilityRole="button"
          style={[
            styles.pill,
            {
              height,
              borderColor:
                other === 'shortlisted' ? 'rgba(34,197,94,0.35)' : 'rgba(229,72,77,0.35)',
              backgroundColor: 'transparent',
            },
          ]}
        >
          <Feather
            name={other === 'shortlisted' ? 'check' : 'x'}
            size={iconSize}
            color={otherColor}
          />
          <Text style={[styles.label, { color: otherColor, fontSize: textSize }]}>
            {applicationStatusLabel(other)}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => {
          hapticSelection();
          onChange('shortlisted');
        }}
        accessibilityRole="button"
        style={[
          styles.pill,
          { height, borderColor: 'rgba(34,197,94,0.40)', backgroundColor: 'transparent' },
        ]}
      >
        <Feather name="check" size={iconSize} color={colors.success} />
        <Text style={[styles.label, { color: colors.success, fontSize: textSize }]}>Shortlist</Text>
      </Pressable>
      <Pressable
        onPress={() => {
          hapticSelection();
          onChange('rejected');
        }}
        accessibilityRole="button"
        style={[
          styles.pill,
          { height, borderColor: 'rgba(229,72,77,0.40)', backgroundColor: 'transparent' },
        ]}
      >
        <Feather name="x" size={iconSize} color={colors.destructive} />
        <Text style={[styles.label, { color: colors.destructive, fontSize: textSize }]}>Reject</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
  },
  label: { fontFamily: 'Geist_500Medium' },
});
