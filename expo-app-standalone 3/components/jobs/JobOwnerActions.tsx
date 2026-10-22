import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { hapticSelection } from '@/lib/haptics';
import {
  deleteJob,
  jobErrorMessage,
  setJobStatus,
  type JobPost,
  type JobStatus,
} from '@/lib/jobs';

interface Props {
  job: JobPost;
  /** Opens the edit form; omitted where there is nowhere to go. */
  onEdit?: () => void;
  /** The write landed — the parent refreshes its job state. */
  onChanged?: (jobId: string, status: JobStatus) => void;
  /** The posting is gone — the parent leaves or refreshes its list. */
  onDeleted?: () => void;
  /** In the card list the menu is a small trailing control, not a header one. */
  compact?: boolean;
}

/**
 * The posting owner's controls, as a touch action sheet: Edit / Close-Reopen /
 * Delete, with the same asymmetry as the web menu. Close is reversible and
 * offers its way back; delete is the only irreversible action, so it confirms
 * and names what disappears. Every write is re-checked by the server.
 */
export function JobOwnerActions({ job, onEdit, onChanged, onDeleted, compact = false }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState<{
    status: JobStatus;
    previous: JobStatus;
  } | null>(null);

  const closed = job.status === 'closed';

  useEffect(() => {
    if (!open) return;
    setConfirmingDelete(false);
    setError(null);
  }, [open]);

  const closeSheet = () => {
    if (pending) return;
    setOpen(false);
  };

  async function applyStatus(status: JobStatus, previous: JobStatus) {
    setError(null);
    setPending(true);
    try {
      const result = await setJobStatus(job.id, status);
      setOpen(false);
      setSettled({ status: result.status, previous });
      onChanged?.(job.id, result.status);
    } catch (cause) {
      setError(jobErrorMessage(cause, 'The job could not be updated.'));
    } finally {
      setPending(false);
    }
  }

  async function removeJob() {
    setError(null);
    setPending(true);
    try {
      await deleteJob(job.id);
      setOpen(false);
      onDeleted?.();
    } catch (cause) {
      setError(jobErrorMessage(cause, 'The job could not be deleted.'));
      setPending(false);
    }
  }

  /**
   * The undo offer after a status change — one tap to run the opposite write,
   * exactly the web toast's promise, kept on its own small dialog.
   */
  async function undoStatus() {
    if (!settled || pending) return;
    setPending(true);
    try {
      const result = await setJobStatus(job.id, settled.previous);
      onChanged?.(job.id, result.status);
      setSettled(null);
    } catch (cause) {
      setError(jobErrorMessage(cause, 'The job could not be updated.'));
      setSettled(null);
      setOpen(true);
    } finally {
      setPending(false);
    }
  }

  const trigger = compact ? (
    <Pressable
      onPress={() => {
        hapticSelection();
        setOpen(true);
      }}
      accessibilityRole="button"
      accessibilityLabel="Job options"
      hitSlop={8}
      style={({ pressed }) => [styles.compactTrigger, { opacity: pressed ? 0.7 : 1 }]}
    >
      {pending ? (
        <ActivityIndicator size="small" color={colors.foregroundMuted} />
      ) : (
        <Feather name="more-horizontal" size={17} color={colors.foregroundMuted} />
      )}
    </Pressable>
  ) : (
    <Pressable
      onPress={() => {
        hapticSelection();
        setOpen(true);
      }}
      accessibilityRole="button"
      accessibilityLabel="Job options"
      hitSlop={8}
      style={({ pressed }) => [
        styles.trigger,
        {
          borderColor: colors.border,
          backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
        },
      ]}
    >
      {pending ? (
        <ActivityIndicator size="small" color={colors.foregroundMuted} />
      ) : (
        <Feather name="more-horizontal" size={18} color={colors.foregroundMuted} />
      )}
    </Pressable>
  );

  return (
    <>
      {trigger}

      <Modal transparent animationType="fade" visible={open} onRequestClose={closeSheet}>
        <Pressable style={styles.backdrop} onPress={closeSheet}>
          <Pressable
            style={[
              styles.sheet,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                paddingBottom: Math.max(insets.bottom, 12),
              },
            ]}
            onPress={(event) => event.stopPropagation()}
          >
            {confirmingDelete ? (
              <>
                <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Delete this job?</Text>
                <Text style={[styles.confirmBody, { color: colors.foregroundMuted }]}>
                  {job.applicant_count > 0
                    ? `This permanently deletes “${job.title}” and its ${job.applicant_count} application${
                        job.applicant_count === 1 ? '' : 's'
                      }. This can’t be undone — close the job instead if the role is simply filled.`
                    : `This permanently deletes “${job.title}”. This can’t be undone.`}
                </Text>
                {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
                <View style={styles.confirmActions}>
                  <Pressable
                    onPress={() => setConfirmingDelete(false)}
                    disabled={pending}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.button,
                      {
                        borderColor: colors.border,
                        backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
                      },
                    ]}
                  >
                    <Text style={[styles.buttonText, { color: colors.foreground }]}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void removeJob()}
                    disabled={pending}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.button,
                      {
                        borderColor: 'rgba(229,72,77,0.45)',
                        backgroundColor: pressed ? 'rgba(229,72,77,0.18)' : 'rgba(229,72,77,0.10)',
                        opacity: pending ? 0.7 : 1,
                      },
                    ]}
                  >
                    {pending ? (
                      <ActivityIndicator size="small" color={colors.destructive} />
                    ) : (
                      <Text style={[styles.buttonText, { color: colors.destructive }]}>Delete job</Text>
                    )}
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={[styles.sheetTitle, { color: colors.foreground }]} numberOfLines={1}>
                  {job.title}
                </Text>

                {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}

                {onEdit ? (
                  <Pressable
                    onPress={() => {
                      setOpen(false);
                      onEdit();
                    }}
                    disabled={pending}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.row,
                      { backgroundColor: pressed ? colors.surfaceRaised : 'transparent' },
                    ]}
                  >
                    <Feather name="edit-2" size={15} color={colors.foregroundMuted} />
                    <Text style={[styles.rowLabel, { color: colors.foreground }]}>
                      {job.deadline_expired ? 'Change deadline' : 'Edit job'}
                    </Text>
                  </Pressable>
                ) : null}

                <Pressable
                  onPress={() => {
                    hapticSelection();
                    void applyStatus(closed ? 'open' : 'closed', job.status);
                  }}
                  disabled={pending}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.row,
                    { backgroundColor: pressed ? colors.surfaceRaised : 'transparent' },
                  ]}
                >
                  <Feather
                    name={closed ? 'rotate-ccw' : 'square'}
                    size={15}
                    color={colors.foregroundMuted}
                  />
                  <Text style={[styles.rowLabel, { color: colors.foreground }]}>
                    {closed ? 'Reopen job' : 'Close job'}
                  </Text>
                </Pressable>

                <View style={[styles.divider, { backgroundColor: colors.border }]} />

                <Pressable
                  onPress={() => setConfirmingDelete(true)}
                  disabled={pending}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.row,
                    { backgroundColor: pressed ? 'rgba(229,72,77,0.10)' : 'transparent' },
                  ]}
                >
                  <Feather name="trash-2" size={15} color={colors.destructive} />
                  <Text style={[styles.rowLabel, { color: colors.destructive }]}>Delete job</Text>
                </Pressable>

                <Pressable
                  onPress={closeSheet}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.cancelRow,
                    { backgroundColor: pressed ? colors.surfaceRaised : 'transparent' },
                  ]}
                >
                  <Text style={[styles.cancelLabel, { color: colors.mutedForeground }]}>Cancel</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* The status change's way back. */}
      <Modal
        transparent
        animationType="fade"
        visible={settled !== null}
        onRequestClose={() => setSettled(null)}
      >
        <Pressable style={styles.backdropCenter} onPress={() => setSettled(null)}>
          <Pressable
            style={[styles.alert, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={(event) => event.stopPropagation()}
          >
            <Text style={[styles.alertTitle, { color: colors.foreground }]}>
              {settled?.status === 'closed' ? 'Job closed' : 'Job reopened'}
            </Text>
            <Text style={[styles.alertBody, { color: colors.foregroundMuted }]}>
              {settled?.status === 'closed'
                ? `“${job.title}” no longer takes applications.`
                : `“${job.title}” is open again — matching members can apply.`}
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                onPress={() => setSettled(null)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.button,
                  {
                    borderColor: colors.border,
                    backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
                  },
                ]}
              >
                <Text style={[styles.buttonText, { color: colors.foreground }]}>Done</Text>
              </Pressable>
              <Pressable
                onPress={() => void undoStatus()}
                disabled={pending}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.button,
                  {
                    borderColor: colors.border,
                    backgroundColor: pressed ? colors.surfaceRaised : colors.surface,
                  },
                ]}
              >
                {pending ? (
                  <ActivityIndicator size="small" color={colors.foreground} />
                ) : (
                  <Text style={[styles.buttonText, { color: colors.foreground }]}>
                    {settled?.status === 'closed' ? 'Reopen' : 'Undo'}
                  </Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactTrigger: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  backdropCenter: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 16,
    paddingHorizontal: 12,
  },
  sheetTitle: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 15,
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 13,
    borderRadius: 10,
  },
  rowLabel: { fontFamily: 'Geist_400Regular', fontSize: 15 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 6, marginHorizontal: 10 },
  cancelRow: { alignItems: 'center', paddingVertical: 13, borderRadius: 10, marginTop: 4 },
  cancelLabel: { fontFamily: 'Geist_500Medium', fontSize: 14 },
  error: {
    fontFamily: 'Geist_400Regular',
    fontSize: 12.5,
    lineHeight: 18,
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  confirmBody: {
    fontFamily: 'Geist_400Regular',
    fontSize: 13.5,
    lineHeight: 20,
    paddingHorizontal: 10,
    paddingBottom: 14,
  },
  confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, padding: 4 },
  button: {
    minWidth: 92,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  buttonText: { fontFamily: 'Geist_600SemiBold', fontSize: 13.5 },
  alert: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    gap: 10,
  },
  alertTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 17 },
  alertBody: { fontFamily: 'Geist_400Regular', fontSize: 14, lineHeight: 20 },
});
