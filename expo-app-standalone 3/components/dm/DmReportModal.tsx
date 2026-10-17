import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { reportDmConversation } from '@/lib/dmApi';

/**
 * The DM report modal — the mobile reading of the web DmReportModal: pick a
 * reason, optionally describe what happened, submit. The report lands in the
 * admin DM Reports queue with a snapshot of the conversation.
 */

const REPORT_REASONS = [
  { value: 'spam', label: 'Spam or scam' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'hate', label: 'Hate speech or discrimination' },
  { value: 'misinformation', label: 'False or misleading info' },
  { value: 'inappropriate', label: 'Inappropriate or violent content' },
  { value: 'intellectual_property', label: 'Stolen work or plagiarism' },
  { value: 'off_topic', label: 'Off-topic or low effort' },
  { value: 'other', label: 'Something else' },
] as const;

const DETAILS_MAX = 1_000;

interface Props {
  visible: boolean;
  conversationId: string;
  peerName: string;
  onClose: () => void;
}

export function DmReportModal({ visible, conversationId, peerName, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  function close() {
    setReason(null);
    setDetails('');
    setError(null);
    setSubmitting(false);
    setDone(false);
    onClose();
  }

  async function submit() {
    if (!reason || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await reportDmConversation(conversationId, reason, details);
      setDone(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Failed to submit your report. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable
            style={[
              styles.panel,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                paddingBottom: Math.max(insets.bottom, 16),
              },
            ]}
            onPress={(event) => event.stopPropagation()}
          >
            {done ? (
              <View style={styles.doneWrap}>
                <View style={[styles.doneCircle, { backgroundColor: colors.accentSoft }]}>
                  <Feather name="check" size={22} color={colors.accent} />
                </View>
                <Text style={[styles.title, { color: colors.foreground }]}>
                  Thanks for reporting
                </Text>
                <Text style={[styles.body, { color: colors.mutedForeground }]}>
                  Our team will review this conversation. {peerName} won&apos;t see who
                  reported them.
                </Text>
                <Pressable
                  onPress={close}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.primaryButton,
                    { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
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
                  <Text style={[styles.title, { color: colors.foreground }]}>
                    Report {peerName}
                  </Text>
                  <Pressable onPress={close} hitSlop={8} accessibilityLabel="Close">
                    <Feather name="x" size={18} color={colors.mutedForeground} />
                  </Pressable>
                </View>
                <Text style={[styles.body, { color: colors.mutedForeground }]}>
                  Select a reason — our team reviews every report.
                </Text>

                <View style={styles.reasons}>
                  {REPORT_REASONS.map((option) => {
                    const active = reason === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        onPress={() => setReason(option.value)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        style={({ pressed }) => [
                          styles.reasonChip,
                          {
                            borderColor: active ? colors.accent : colors.border,
                            backgroundColor: active
                              ? colors.accentSoft
                              : pressed
                                ? colors.surfaceRaised
                                : 'transparent',
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.reasonText,
                            { color: active ? colors.foreground : colors.mutedForeground },
                          ]}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <TextInput
                  value={details}
                  onChangeText={(value) => setDetails(value.slice(0, DETAILS_MAX))}
                  placeholder="Tell us what happened… (optional)"
                  placeholderTextColor={colors.foregroundSubtle}
                  multiline
                  textAlignVertical="top"
                  style={[
                    styles.details,
                    {
                      color: colors.foreground,
                      backgroundColor: colors.surfaceRaised,
                      borderColor: colors.border,
                    },
                  ]}
                />
                <View style={styles.detailsFooter}>
                  <Text style={[styles.anonymous, { color: colors.foregroundSubtle }]}>
                    Your report is anonymous to {peerName}.
                  </Text>
                  <Text style={[styles.counter, { color: colors.foregroundSubtle }]}>
                    {details.length}/{DETAILS_MAX}
                  </Text>
                </View>

                {error ? (
                  <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
                ) : null}

                <View style={styles.footer}>
                  <Pressable
                    onPress={close}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.secondaryButton,
                      { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>
                      Cancel
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void submit()}
                    disabled={!reason || submitting}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.primaryButtonInline,
                      {
                        backgroundColor: colors.accent,
                        opacity: !reason ? 0.45 : pressed ? 0.85 : 1,
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
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  panel: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: { fontFamily: 'Geist_600SemiBold', fontSize: 18, letterSpacing: -0.2 },
  body: { fontFamily: 'Geist_400Regular', fontSize: 13, lineHeight: 19, marginTop: 6 },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  reasonChip: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  reasonText: { fontFamily: 'Geist_500Medium', fontSize: 12 },
  details: {
    marginTop: 16,
    minHeight: 104,
    maxHeight: 180,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'Geist_400Regular',
    fontSize: 14,
    lineHeight: 20,
  },
  detailsFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 6,
  },
  anonymous: { fontFamily: 'Geist_400Regular', fontSize: 11, flexShrink: 1 },
  counter: { fontFamily: 'Geist_400Regular', fontSize: 10.5 },
  error: { fontFamily: 'Geist_400Regular', fontSize: 12, marginTop: 10 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginTop: 20 },
  secondaryButton: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { fontFamily: 'Geist_500Medium', fontSize: 13.5 },
  primaryButtonInline: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  primaryButton: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    alignSelf: 'stretch',
  },
  primaryButtonText: { fontFamily: 'Geist_600SemiBold', fontSize: 13.5 },
  doneWrap: { alignItems: 'center', paddingTop: 8 },
  doneCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
});
