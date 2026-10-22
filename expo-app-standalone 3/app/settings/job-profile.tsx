import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { SaveStatus, type SaveState } from '@/components/settings/SaveStatus';
import { ScreenHeader } from '@/components/settings/ScreenHeader';
import { useColors } from '@/hooks/useColors';
import { pickResumeFile } from '@/lib/jobResumePicker';
import {
  deleteSavedResume,
  jobErrorMessage,
  loadSavedResumes,
  MAX_SAVED_RESUMES,
  resumeMeta,
  setDefaultResume,
  updatePortfolioUrl,
  uploadSavedResume,
  type SavedResume,
} from '@/lib/jobs';
import { getOwnProfile } from '@/lib/profile';

/**
 * Job profile — what a job application prefills: the portfolio link (the same
 * debounced autosave the Profile screen's links use) and the saved resumes
 * (max three, managed through the same web route; the default is preselected
 * in the Apply form).
 *
 * Every resume mutation replaces the list from the server's response, so this
 * screen never re-derives a state the server already decided. Delete confirms
 * because it is the one destructive action here.
 */
export default function JobProfileSettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [portfolio, setPortfolio] = useState('');
  const [initialPortfolio, setInitialPortfolio] = useState('');
  const [portfolioState, setPortfolioState] = useState<SaveState>('idle');
  const [resumes, setResumes] = useState<SavedResume[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [defaultPendingId, setDefaultPendingId] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedResume | null>(null);
  const [deleting, setDeleting] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const [profile, list] = await Promise.all([getOwnProfile(), loadSavedResumes()]);
      const url = profile.profile?.portfolio_url ?? '';
      setPortfolio(url);
      setInitialPortfolio(url);
      setResumes(list);
    } catch (cause) {
      setResumeError(jobErrorMessage(cause, 'Your job profile could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  const onPortfolioChange = (value: string) => {
    setPortfolio(value);
    if (value === initialPortfolio) {
      setPortfolioState('idle');
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setPortfolioState('saving');
    saveTimerRef.current = setTimeout(async () => {
      try {
        await updatePortfolioUrl(value);
        setInitialPortfolio(value);
        setPortfolioState('saved');
      } catch {
        setPortfolioState('error');
      }
    }, 900);
  };

  async function addResume() {
    setResumeError(null);
    try {
      const picked = await pickResumeFile();
      if (!picked) return;
      setUploading(true);
      const list = await uploadSavedResume(picked);
      setResumes(list);
    } catch (cause) {
      setResumeError(jobErrorMessage(cause, 'The resume could not be saved. Please try again.'));
    } finally {
      setUploading(false);
    }
  }

  async function makeDefault(id: string) {
    if (defaultPendingId !== null) return;
    setDefaultPendingId(id);
    setResumeError(null);
    try {
      setResumes(await setDefaultResume(id));
    } catch (cause) {
      setResumeError(jobErrorMessage(cause, 'That change could not be saved. Please try again.'));
    } finally {
      setDefaultPendingId(null);
    }
  }

  async function removeResume() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setResumeError(null);
    try {
      const list = await deleteSavedResume(deleteTarget.id);
      setResumes(list);
      setDeleteTarget(null);
    } catch (cause) {
      setResumeError(jobErrorMessage(cause, 'The resume could not be deleted. Please try again.'));
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  const canUpload = resumes.length < MAX_SAVED_RESUMES;
  const rowBusy = uploading || defaultPendingId !== null;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      <ScreenHeader title="Job profile" subtitle="What we prefill when you apply to a role." />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <KeyboardAwareScrollViewCompat
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Job profile</Text>
              <SaveStatus state={portfolioState} />
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground }]}>Portfolio link</Text>
              <TextInput
                value={portfolio}
                onChangeText={onPortfolioChange}
                placeholder="https://yourportfolio.com"
                placeholderTextColor={colors.foregroundSubtle}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                style={[
                  styles.input,
                  {
                    color: colors.foreground,
                    borderColor: colors.inputBorder,
                    backgroundColor: colors.inputBackground,
                  },
                ]}
              />
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              Resumes{' '}
              <Text style={[styles.count, { color: colors.mutedForeground }]}>
                · {resumes.length} of {MAX_SAVED_RESUMES}
              </Text>
            </Text>

            {resumes.length === 0 ? (
              <Text style={[styles.empty, { color: colors.mutedForeground }]}>
                No resumes yet. Save up to 3 and pick one when you apply.
              </Text>
            ) : (
              <View style={styles.resumeList}>
                {resumes.map((resume) => (
                  <View
                    key={resume.id}
                    style={[
                      styles.resumeRow,
                      { borderColor: colors.border, backgroundColor: colors.background },
                    ]}
                  >
                    <Feather name="file-text" size={15} color={colors.accent} />
                    <View style={styles.resumeText}>
                      <Text
                        style={[styles.resumeName, { color: colors.foreground }]}
                        numberOfLines={1}
                      >
                        {resume.fileName}
                      </Text>
                      <Text style={[styles.resumeMeta, { color: colors.mutedForeground }]}>
                        {resumeMeta(resume)}
                      </Text>
                    </View>
                    {resume.isDefault ? (
                      <View style={[styles.badge, { borderColor: colors.border }]}>
                        <Text style={[styles.badgeText, { color: colors.mutedForeground }]}>
                          Default
                        </Text>
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => void makeDefault(resume.id)}
                        disabled={rowBusy}
                        accessibilityRole="button"
                        style={({ pressed }) => [
                          styles.smallButton,
                          {
                            borderColor: colors.border,
                            backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
                            opacity: rowBusy ? 0.6 : 1,
                          },
                        ]}
                      >
                        {defaultPendingId === resume.id ? (
                          <ActivityIndicator size="small" color={colors.foreground} />
                        ) : (
                          <Text style={[styles.smallButtonText, { color: colors.foreground }]}>
                            Make default
                          </Text>
                        )}
                      </Pressable>
                    )}
                    <Pressable
                      onPress={() => setDeleteTarget(resume)}
                      disabled={rowBusy}
                      accessibilityRole="button"
                      accessibilityLabel="Delete resume"
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.deleteButton,
                        {
                          borderColor: 'rgba(229,72,77,0.35)',
                          backgroundColor: pressed ? 'rgba(229,72,77,0.12)' : 'transparent',
                          opacity: rowBusy ? 0.6 : 1,
                        },
                      ]}
                    >
                      <Feather name="trash-2" size={13} color={colors.destructive} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            {resumes.length > 0 ? (
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                Your default resume is preselected when you apply.
              </Text>
            ) : null}

            {resumeError ? (
              <View
                style={[
                  styles.errorBox,
                  { borderColor: 'rgba(229,72,77,0.30)', backgroundColor: 'rgba(229,72,77,0.10)' },
                ]}
              >
                <Text style={[styles.errorText, { color: colors.destructive }]}>{resumeError}</Text>
              </View>
            ) : null}

            {canUpload ? (
              <View style={styles.uploadBlock}>
                <Pressable
                  onPress={() => void addResume()}
                  disabled={uploading}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.uploadButton,
                    {
                      borderColor: pressed ? colors.accent : colors.border,
                      opacity: uploading ? 0.7 : 1,
                    },
                  ]}
                >
                  {uploading ? (
                    <ActivityIndicator size="small" color={colors.foregroundMuted} />
                  ) : (
                    <Feather name="upload" size={15} color={colors.foregroundMuted} />
                  )}
                  <Text style={[styles.uploadText, { color: colors.foregroundMuted }]}>
                    {uploading ? 'Uploading…' : 'Add a resume'}
                  </Text>
                </Pressable>
                <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                  PDF, DOC, DOCX or RTF — up to 5 MB.
                </Text>
              </View>
            ) : (
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                {MAX_SAVED_RESUMES} of {MAX_SAVED_RESUMES} resumes saved. Delete one to add
                another.
              </Text>
            )}
          </View>
        </KeyboardAwareScrollViewCompat>
      )}

      <Modal
        transparent
        animationType="fade"
        visible={deleteTarget !== null}
        onRequestClose={() => setDeleteTarget(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setDeleteTarget(null)}>
          <Pressable
            style={[styles.alert, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={(event) => event.stopPropagation()}
          >
            <Text style={[styles.alertTitle, { color: colors.foreground }]}>Delete resume</Text>
            <Text style={[styles.alertBody, { color: colors.mutedForeground }]}>
              Delete <Text style={{ color: colors.foreground }}>{deleteTarget?.fileName}</Text>?
              Applications already sent keep their copy.
            </Text>
            <View style={styles.alertActions}>
              <Pressable
                onPress={() => setDeleteTarget(null)}
                disabled={deleting}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.alertButton,
                  {
                    borderColor: colors.border,
                    backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
                  },
                ]}
              >
                <Text style={[styles.alertButtonText, { color: colors.foreground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void removeResume()}
                disabled={deleting}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.alertButton,
                  {
                    borderColor: 'rgba(229,72,77,0.45)',
                    backgroundColor: pressed ? 'rgba(229,72,77,0.18)' : 'rgba(229,72,77,0.10)',
                  },
                ]}
              >
                {deleting ? (
                  <ActivityIndicator size="small" color={colors.destructive} />
                ) : (
                  <Text style={[styles.alertButtonText, { color: colors.destructive }]}>
                    Delete resume
                  </Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: {
    flex: 1,
    minHeight: 300,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 32,
  },
  content: { padding: 16, gap: 14 },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    gap: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 15 },
  count: { fontFamily: 'Geist_400Regular', fontSize: 12 },
  field: { gap: 6 },
  label: { fontFamily: 'Geist_500Medium', fontSize: 12 },
  input: {
    height: 42,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    fontFamily: 'Geist_400Regular',
    fontSize: 14,
  },
  empty: { fontFamily: 'Geist_400Regular', fontSize: 12.5, lineHeight: 18 },
  resumeList: { gap: 8 },
  resumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  resumeText: { flex: 1, gap: 1 },
  resumeName: { fontFamily: 'Geist_400Regular', fontSize: 13.5 },
  resumeMeta: { fontFamily: 'Geist_400Regular', fontSize: 11.5 },
  badge: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontFamily: 'Geist_400Regular', fontSize: 10.5 },
  smallButton: {
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 9,
  },
  smallButtonText: { fontFamily: 'Geist_500Medium', fontSize: 11 },
  deleteButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { fontFamily: 'Geist_400Regular', fontSize: 11.5, lineHeight: 16 },
  uploadBlock: { gap: 6, marginTop: 2 },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    paddingVertical: 14,
  },
  uploadText: { fontFamily: 'Geist_400Regular', fontSize: 13.5 },
  errorBox: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  errorText: { fontFamily: 'Geist_400Regular', fontSize: 12, lineHeight: 17 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.58)',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  alert: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 18, gap: 10 },
  alertTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 17 },
  alertBody: { fontFamily: 'Geist_400Regular', fontSize: 14, lineHeight: 20 },
  alertActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingTop: 4 },
  alertButton: {
    minWidth: 92,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  alertButtonText: { fontFamily: 'Geist_600SemiBold', fontSize: 13.5 },
});
