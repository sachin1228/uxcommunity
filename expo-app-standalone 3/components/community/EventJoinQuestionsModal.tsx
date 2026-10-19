import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import {
  EVENT_JOIN_QUESTIONS,
  EVENT_JOIN_ANSWER_LIMITS,
  joinAnswersPayload,
  type EventJoinAnswers,
  type EventJoinQuestionKey,
} from '@/lib/eventJoinQuestions';
import { DialogError, DialogPrimaryButton, DialogSecondaryButton, EventModal } from './EventModal';

/**
 * The host's compulsory questions, asked before the door into an event's group
 * chat opens — the mobile port of the web `EventJoinQuestionsModal`. Nothing is
 * sent until every question is answered; the confirm button stays off until
 * then, and says how many are still open.
 *
 * Mounted only while open, so a dismissed attempt never leaves its answers
 * behind for the next one.
 */
type Draft = Partial<Record<EventJoinQuestionKey, string>>;

export function EventJoinQuestionsModal({
  onClose,
  onSubmit,
  eventTitle,
  communityName,
  pending = false,
  error,
  confirmLabel = 'Confirm',
}: {
  onClose: () => void;
  /** Fired only from the confirm button, and only with a complete answer set. */
  onSubmit: (answers: EventJoinAnswers) => void;
  eventTitle: string;
  communityName?: string | null;
  pending?: boolean;
  error?: string | null;
  confirmLabel?: string;
}) {
  const colors = useColors();
  const [draft, setDraft] = useState<Draft>({});

  const missing = EVENT_JOIN_QUESTIONS.filter(
    ({ key }) => (draft[key] ?? '').trim().length === 0,
  ).length;
  const ready = joinAnswersPayload(draft) !== null;
  const submit = () => {
    const answers = joinAnswersPayload(draft);
    if (answers) onSubmit(answers);
  };

  return (
    <EventModal
      title="A few questions before you join"
      onClose={onClose}
      dismissable={!pending}
      footer={
        <>
          <DialogSecondaryButton label="Cancel" onPress={onClose} disabled={pending} />
          <DialogPrimaryButton
            label={
              ready
                ? confirmLabel
                : missing === EVENT_JOIN_QUESTIONS.length
                  ? 'Answer all questions'
                  : `${missing} question${missing === 1 ? '' : 's'} left`
            }
            pendingLabel="Submitting…"
            icon={
              <Feather
                name={ready ? 'check' : 'clipboard'}
                size={15}
                color={colors.primaryForeground}
              />
            }
            onPress={submit}
            pending={pending}
            disabled={!ready}
          />
        </>
      }
    >
      <Text style={[styles.copy, { color: colors.mutedForeground }]}>
        Before you join{' '}
        <Text style={[styles.strong, { color: colors.foreground }]}>{eventTitle}</Text>
        {communityName ? (
          <>
            {' '}hosted by{' '}
            <Text style={[styles.strong, { color: colors.foreground }]}>{communityName}</Text>
          </>
        ) : null}
        , the host asks everyone these — your answers are shared with them.
      </Text>

      <View style={styles.form}>
        {EVENT_JOIN_QUESTIONS.map(({ key, label, placeholder, multiline }) => (
          <View key={key} style={styles.field}>
            <Text style={[styles.label, { color: colors.foreground }]}>
              {label}
              <Text style={{ color: colors.destructive }}> *</Text>
            </Text>
            <TextInput
              value={draft[key] ?? ''}
              onChangeText={(value) => setDraft((current) => ({ ...current, [key]: value }))}
              placeholder={placeholder}
              placeholderTextColor={colors.foregroundSubtle}
              multiline={multiline}
              textAlignVertical={multiline ? 'top' : 'center'}
              maxLength={EVENT_JOIN_ANSWER_LIMITS[key]}
              editable={!pending}
              accessibilityLabel={`${label}, required`}
              style={[
                styles.input,
                multiline ? styles.inputMultiline : null,
                {
                  color: colors.foreground,
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  opacity: pending ? 0.6 : 1,
                },
              ]}
            />
          </View>
        ))}
      </View>

      {error ? <DialogError message={error} /> : null}
    </EventModal>
  );
}

const styles = StyleSheet.create({
  copy: { fontSize: 13, fontFamily: 'Geist_400Regular', lineHeight: 19 },
  strong: { fontFamily: 'Geist_500Medium' },
  form: { marginTop: 20, gap: 16 },
  field: { gap: 6 },
  label: { fontSize: 12, fontFamily: 'Geist_500Medium' },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: 'Geist_400Regular',
  },
  inputMultiline: { minHeight: 78 },
});
