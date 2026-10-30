import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hapticSelection } from '@/lib/haptics';
import {
  REPORT_CONTENT_LABELS,
  REPORT_DETAILS_MAX_LENGTH,
  isAlreadyReported,
  reportReasonsFor,
  type ReportType,
} from '@/lib/contentReports';
import { reportContent } from '@/lib/contentReportsApi';

/**
 * The content report flow opened from a card's ··· menu — the mobile reading
 * of the web `communities/ReportModal`: pick a reason, optionally explain,
 * submit. The report lands in the admin content-reports queue.
 *
 * A 409 ("already reported") marks the menu's Report row as acknowledged and
 * keeps the server's copy in the sheet, exactly like the web modal.
 */

type Step = 'reason' | 'details' | 'done';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/** The web modal's lucide glyphs, read on Feather's set. */
const REASON_ICONS: Record<string, FeatherName> = {
  spam: 'slash',
  harassment: 'user-x',
  hate: 'shield',
  misinformation: 'info',
  inappropriate: 'eye-off',
  intellectual_property: 'copy',
  off_topic: 'thumbs-down',
  other: 'message-square',
  impersonation: 'user-x',
  illegal: 'shield-off',
  scam: 'slash',
  discriminatory: 'user-x',
  payment_request: 'credit-card',
  expired: 'clock',
};

interface Props {
  visible: boolean;
  contentType: ReportType;
  contentId: string;
  onClose: () => void;
  /** The report was accepted (or was already on file). */
  onReported: () => void;
}

export function ContentReportModal({
  visible,
  contentType,
  contentId,
  onClose,
  onReported,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('reason');
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Every open starts a fresh wizard — a previous reason/details pair never
  // leaks into the next post the member reports.
  useEffect(() => {
    if (!visible) return;
    setStep('reason');
    setReason(null);
    setDetails('');
    setError(null);
    setSubmitting(false);
  }, [visible]);

  const label = REPORT_CONTENT_LABELS[contentType];
  const reasons = reportReasonsFor(contentType);

  const close = () => {
    if (submitting) return;
    onClose();
  };

  const submit = async () => {
    if (!reason || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await reportContent({ contentType, contentId, reason, details });
      onReported();
      setStep('done');
    } catch (e) {
      // A report already on file is acknowledged rather than retried.
      if (isAlreadyReported(e)) onReported();
      setError(e instanceof Error ? e.message : 'Failed to submit your report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={close}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close report">
          <Pressable
            onPress={() => undefined}
            style={[
              styles.sheet,
              {
                backgroundColor: colors.overlayElevated,
                paddingBottom: insets.bottom + 18,
                borderColor: colors.borderSubtle,
              },
            ]}
          >
            {step === 'done' ? (
              <View style={styles.done}>
                <View style={[styles.doneIcon, { backgroundColor: colors.accentSoft }]}>
                  <Feather name="check" size={22} color={colors.accent} />
                </View>
                <Text style={[styles.doneTitle, { color: colors.foreground }]}>
                  Thanks for reporting
                </Text>
                <Text style={[styles.doneBody, { color: colors.foregroundMuted }]}>
                  Our team will review this {label}. You&apos;ll get a notification once it&apos;s been
                  looked at.
                </Text>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.primaryButton,
                    { backgroundColor: pressed ? colors.accentHover : colors.accent },
                  ]}
                >
                  <Text style={[styles.primaryButtonText, { color: colors.accentForeground }]}>
                    Done
                  </Text>
                </Pressable>
              </View>
            ) : (
              <>
                <View style={styles.header}>
                  <View style={styles.flex}>
                    <Text style={[styles.title, { color: colors.foreground }]}>
                      {step === 'reason' ? `Report this ${label}` : 'Add any details'}
                    </Text>
                    <Text style={[styles.subtitle, { color: colors.foregroundMuted }]}>
                      {step === 'reason'
                        ? 'Select your reporting reason — our team reviews every report.'
                        : "Optional — tell us what's wrong so we can review it faster."}
                    </Text>
                  </View>
                  <Pressable
                    onPress={close}
                    style={styles.closeButton}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Close report"
                  >
                    <Feather name="x" size={20} color={colors.foregroundSubtle} />
                  </Pressable>
                </View>

                <ScrollView
                  style={styles.body}
                  contentContainerStyle={styles.bodyContent}
                  keyboardShouldPersistTaps="handled"
                >
                  {step === 'reason' ? (
                    <View style={styles.reasons}>
                      {reasons.map((option) => {
                        const active = reason === option.value;
                        return (
                          <Pressable
                            key={option.value}
                            onPress={() => {
                              hapticSelection();
                              setReason(option.value);
                            }}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                            style={({ pressed }) => [
                              styles.reasonChip,
                              {
                                backgroundColor: active
                                  ? colors.accentSoft
                                  : pressed
                                    ? colors.surfaceRaised
                                    : 'transparent',
                                borderColor: active ? colors.accent : colors.border,
                              },
                            ]}
                          >
                            <Feather
                              name={REASON_ICONS[option.value] ?? 'flag'}
                              size={13}
                              color={active ? colors.accent : colors.foregroundMuted}
                            />
                            <Text
                              style={[
                                styles.reasonText,
                                { color: active ? colors.accent : colors.foregroundMuted },
                              ]}
                            >
                              {option.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : (
                    <>
                      {reason ? (
                        <View style={[styles.selectedReason, { backgroundColor: colors.accentSoft }]}>
                          <Feather name="check" size={13} color={colors.accent} />
                          <Text style={[styles.selectedReasonText, { color: colors.accent }]}>
                            {reasons.find((option) => option.value === reason)?.label}
                          </Text>
                        </View>
                      ) : null}

                      <TextInput
                        value={details}
                        onChangeText={(value) => setDetails(value.slice(0, REPORT_DETAILS_MAX_LENGTH))}
                        multiline
                        maxLength={REPORT_DETAILS_MAX_LENGTH}
                        placeholder="Optional details…"
                        placeholderTextColor={colors.foregroundSubtle}
                        style={[
                          styles.detailsInput,
                          {
                            color: colors.foreground,
                            backgroundColor: colors.backgroundSubtle,
                            borderColor: colors.border,
                          },
                        ]}
                        accessibilityLabel="Report details"
                      />
                      <View style={styles.detailsMeta}>
                        <Text style={[styles.meta, { color: colors.foregroundSubtle }]}>
                          Your report is anonymous to the author.
                        </Text>
                        <Text style={[styles.meta, styles.counter, { color: colors.foregroundSubtle }]}>
                          {details.length}/{REPORT_DETAILS_MAX_LENGTH}
                        </Text>
                      </View>

                      {error ? (
                        <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
                      ) : null}
                    </>
                  )}
                </ScrollView>

                <View style={styles.actions}>
                  {step === 'reason' ? (
                    <>
                      <Pressable
                        onPress={close}
                        accessibilityRole="button"
                        style={({ pressed }) => [
                          styles.secondaryButton,
                          {
                            borderColor: colors.border,
                            backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
                          },
                        ]}
                      >
                        <Text style={[styles.secondaryButtonText, { color: colors.foregroundMuted }]}>
                          Cancel
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          if (!reason) return;
                          hapticSelection();
                          setStep('details');
                        }}
                        disabled={!reason}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: !reason }}
                        style={({ pressed }) => [
                          styles.primaryButton,
                          styles.inlinePrimary,
                          {
                            backgroundColor: !reason
                              ? colors.surfaceRaised
                              : pressed
                                ? colors.accentHover
                                : colors.accent,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.primaryButtonText,
                            { color: reason ? colors.accentForeground : colors.foregroundSubtle },
                          ]}
                        >
                          Next
                        </Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                      <Pressable
                        onPress={() => {
                          setError(null);
                          setStep('reason');
                        }}
                        disabled={submitting}
                        accessibilityRole="button"
                        style={({ pressed }) => [
                          styles.secondaryButton,
                          {
                            borderColor: colors.border,
                            backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
                            opacity: submitting ? 0.6 : 1,
                          },
                        ]}
                      >
                        <Feather name="arrow-left" size={14} color={colors.foregroundMuted} />
                        <Text style={[styles.secondaryButtonText, { color: colors.foregroundMuted }]}>
                          Back
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          hapticSelection();
                          void submit();
                        }}
                        disabled={submitting}
                        accessibilityRole="button"
                        accessibilityState={{ busy: submitting }}
                        style={({ pressed }) => [
                          styles.primaryButton,
                          styles.inlinePrimary,
                          {
                            backgroundColor: pressed ? colors.accentHover : colors.accent,
                            opacity: submitting ? 0.6 : 1,
                          },
                        ]}
                      >
                        {submitting ? (
                          <ActivityIndicator size="small" color={colors.accentForeground} />
                        ) : (
                          <Feather name="flag" size={14} color={colors.accentForeground} />
                        )}
                        <Text style={[styles.primaryButtonText, { color: colors.accentForeground }]}>
                          {submitting ? 'Submitting…' : 'Submit report'}
                        </Text>
                      </Pressable>
                    </>
                  )}
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 18,
    maxHeight: '88%',
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  title: { fontFamily: 'Geist_600SemiBold', fontSize: 18, lineHeight: 24 },
  subtitle: { fontFamily: 'Geist_400Regular', fontSize: 12.5, lineHeight: 18, marginTop: 4 },
  closeButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  body: { marginTop: 16, flexGrow: 0 },
  bodyContent: { gap: 12, paddingBottom: 8 },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reasonChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  reasonText: { fontFamily: 'Geist_500Medium', fontSize: 12.5 },
  selectedReason: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
  },
  selectedReasonText: { fontFamily: 'Geist_500Medium', fontSize: 12.5 },
  detailsInput: {
    minHeight: 112,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingTop: 11,
    paddingBottom: 11,
    fontFamily: 'Geist_400Regular',
    fontSize: 14,
    lineHeight: 21,
    textAlignVertical: 'top',
  },
  detailsMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  meta: { fontFamily: 'Geist_400Regular', fontSize: 11, lineHeight: 16 },
  counter: { fontVariant: ['tabular-nums'] },
  error: { fontFamily: 'Geist_400Regular', fontSize: 12.5, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  secondaryButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  secondaryButtonText: { fontFamily: 'Geist_500Medium', fontSize: 14 },
  primaryButton: {
    minHeight: 44,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 18,
    alignSelf: 'stretch',
  },
  inlinePrimary: { flex: 1 },
  primaryButtonText: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  done: { alignItems: 'center', paddingTop: 8, paddingBottom: 4 },
  doneIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 18, marginTop: 14 },
  doneBody: {
    fontFamily: 'Geist_400Regular',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 320,
  },
});
