import React, { useEffect, useRef, useState } from 'react';
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
import { CompanyMark } from '@/components/companies/CompanyMark';
import { useColors } from '@/hooks/useColors';
import { pickResumeFile } from '@/lib/jobResumePicker';
import {
  applyToJob,
  jobErrorMessage,
  loadSavedResumes,
  resumeMeta,
  type JobPost,
  type JobViewer,
  type ResumeUpload,
  type SavedResume,
} from '@/lib/jobs';

interface Props {
  job: JobPost;
  viewer: JobViewer;
  onClose: () => void;
  /** Called once the application lands, so the screen behind re-reads the job. */
  onApplied: () => void;
}

/**
 * The application is three fields — name, portfolio, LinkedIn — plus a
 * required resume, exactly the web modal. The name and links prefill from the
 * member's profile but stay editable: the application is what the poster
 * reads. Eligibility is not checked here; the database re-checks the
 * applicant's profile when the form is submitted.
 *
 * The resume is either a saved one (Settings → Job profile; the default is
 * preselected) or a one-off upload. A first upload by a member with no saved
 * resumes is adopted into the job profile server-side, so the next
 * application offers it.
 */
export function ApplyModal({ job, viewer, onClose, onApplied }: Props) {
  const colors = useColors();

  const [name, setName] = useState(viewer.name);
  const [portfolioUrl, setPortfolioUrl] = useState(viewer.portfolioUrl ?? '');
  const [linkedinUrl, setLinkedinUrl] = useState(viewer.linkedinUrl ?? '');
  const [resume, setResume] = useState<ResumeUpload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Saved resumes + the chosen option ("saved:<id>" | "upload").
  const [savedResumes, setSavedResumes] = useState<SavedResume[] | null>(null);
  const [resumesLoaded, setResumesLoaded] = useState(false);
  const [resumeChoice, setResumeChoice] = useState('');
  const requestedRef = useRef(false);

  useEffect(() => {
    if (requestedRef.current) return;
    requestedRef.current = true;
    void (async () => {
      try {
        const list = await loadSavedResumes();
        setResumesLoaded(true);
        if (list.length === 0) return;
        setSavedResumes(list);
        const preset = list.find((entry) => entry.isDefault) ?? list[0];
        setResumeChoice(`saved:${preset.id}`);
      } catch {
        // Silent fallback to the upload-only control — applying must not break.
      }
    })();
  }, []);

  async function attachResume() {
    setError(null);
    try {
      const picked = await pickResumeFile();
      if (!picked) return;
      setResume(picked);
      setResumeChoice('upload');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That file could not be attached.');
    }
  }

  async function submit() {
    if (submitting) return;

    if (name.trim().length < 2) {
      setError('Enter your full name.');
      return;
    }
    if (!/^https?:\/\/\S+$/i.test(portfolioUrl.trim())) {
      setError('Enter a portfolio link starting with http(s)://');
      return;
    }
    if (!/^https?:\/\/\S+$/i.test(linkedinUrl.trim()) || !linkedinUrl.includes('linkedin.com')) {
      setError('Enter your LinkedIn profile link (linkedin.com/…)');
      return;
    }

    let savedResumeId: string | null = null;
    if (savedResumes) {
      const chosen = savedResumes.find((entry) => `saved:${entry.id}` === resumeChoice) ?? null;
      savedResumeId = chosen?.id ?? null;
      if (!chosen && !resume) {
        setError('Attach a resume to apply.');
        return;
      }
    } else if (!resume) {
      setError('Attach a resume to apply.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await applyToJob(job.id, {
        name: name.trim(),
        portfolioUrl: portfolioUrl.trim(),
        linkedinUrl: linkedinUrl.trim(),
        savedResumeId,
        resume: savedResumeId ? null : resume,
      });
      setSubmitted(true);
      onApplied();
    } catch (cause) {
      setError(jobErrorMessage(cause, 'Your application could not be sent. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={submitting ? () => undefined : onClose}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={submitting ? undefined : onClose}>
          <Pressable
            style={[styles.dialog, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={(event) => event.stopPropagation()}
          >
            {submitted ? (
              <View style={styles.success}>
                <View style={[styles.successIcon, { backgroundColor: 'rgba(34,197,94,0.15)' }]}>
                  <Feather name="check-circle" size={24} color={colors.success} />
                </View>
                <Text style={[styles.successTitle, { color: colors.foreground }]}>
                  Application sent
                </Text>
                <Text style={[styles.successBody, { color: colors.foregroundMuted }]}>
                  Your application to <Text style={{ color: colors.foreground }}>{job.company.name}</Text>{' '}
                  is with {job.poster.name}.
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
                <Text style={[styles.title, { color: colors.foreground }]}>Apply</Text>

                <ScrollView
                  style={styles.formScroll}
                  contentContainerStyle={styles.form}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  <View
                    style={[
                      styles.jobLine,
                      { borderColor: colors.border, backgroundColor: colors.background },
                    ]}
                  >
                    <CompanyMark name={job.company.name} logoUrl={job.company.logo_url} size={40} />
                    <View style={styles.jobLineText}>
                      <Text style={[styles.jobTitle, { color: colors.foreground }]} numberOfLines={1}>
                        {job.title}
                      </Text>
                      <Text
                        style={[styles.jobMeta, { color: colors.foregroundMuted }]}
                        numberOfLines={1}
                      >
                        {job.company.name} · {job.city_name}
                      </Text>
                    </View>
                  </View>

                  <Field label="Full name" required colors={colors}>
                    <TextInput
                      value={name}
                      onChangeText={setName}
                      maxLength={120}
                      placeholder="Your full name"
                      placeholderTextColor={colors.foregroundSubtle}
                      style={[
                        styles.input,
                        {
                          color: colors.foreground,
                          borderColor: colors.inputBorder,
                          backgroundColor: colors.inputBackground,
                        },
                      ]}
                    />
                  </Field>

                  <Field label="Portfolio link" required colors={colors}>
                    <TextInput
                      value={portfolioUrl}
                      onChangeText={setPortfolioUrl}
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
                  </Field>

                  <Field label="LinkedIn" required colors={colors}>
                    <TextInput
                      value={linkedinUrl}
                      onChangeText={setLinkedinUrl}
                      placeholder="https://www.linkedin.com/in/…"
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
                  </Field>

                  <View style={styles.field}>
                    <Text style={[styles.label, { color: colors.foreground }]}>
                      Resume <Text style={{ color: colors.destructive }}>*</Text>{' '}
                      <Text style={[styles.labelHint, { color: colors.foregroundSubtle }]}>
                        (PDF, DOC, DOCX, RTF — up to 5 MB)
                      </Text>
                    </Text>

                    {savedResumes ? (
                      <View style={styles.resumeChoices}>
                        {savedResumes.map((entry) => (
                          <ResumeOption
                            key={entry.id}
                            checked={resumeChoice === `saved:${entry.id}`}
                            onSelect={() => setResumeChoice(`saved:${entry.id}`)}
                            label={entry.fileName}
                            meta={resumeMeta(entry)}
                            badge={entry.isDefault ? 'Default' : undefined}
                          />
                        ))}
                        <ResumeOption
                          checked={resumeChoice === 'upload'}
                          onSelect={() => setResumeChoice('upload')}
                          label="Upload a new file"
                        />
                        {resumeChoice === 'upload' ? (
                          resume ? (
                            <PickedResume file={resume} onRemove={() => setResume(null)} />
                          ) : (
                            <AttachButton onPress={() => void attachResume()} />
                          )
                        ) : null}
                      </View>
                    ) : resume ? (
                      <PickedResume file={resume} onRemove={() => setResume(null)} />
                    ) : (
                      <AttachButton onPress={() => void attachResume()} />
                    )}

                    {resumesLoaded && !savedResumes ? (
                      <Text style={[styles.hint, { color: colors.foregroundSubtle }]}>
                        Saved to your job profile for next time.
                      </Text>
                    ) : null}
                  </View>

                  {error ? (
                    <View
                      style={[
                        styles.errorBox,
                        { borderColor: 'rgba(229,72,77,0.30)', backgroundColor: 'rgba(229,72,77,0.10)' },
                      ]}
                    >
                      <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
                    </View>
                  ) : null}
                </ScrollView>

                <View style={styles.actions}>
                  <Pressable
                    onPress={onClose}
                    disabled={submitting}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.secondaryButton,
                      {
                        borderColor: colors.border,
                        backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
                      },
                    ]}
                  >
                    <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>
                      Cancel
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void submit()}
                    disabled={submitting}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.primaryButton,
                      {
                        backgroundColor: pressed ? colors.accentHover : colors.accent,
                        opacity: submitting ? 0.7 : 1,
                      },
                    ]}
                  >
                    {submitting ? (
                      <ActivityIndicator size="small" color={colors.accentForeground} />
                    ) : (
                      <Text style={[styles.primaryButtonText, { color: colors.accentForeground }]}>
                        Send application
                      </Text>
                    )}
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

function Field({
  label,
  required,
  colors,
  children,
}: {
  label: string;
  required?: boolean;
  colors: ReturnType<typeof useColors>;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.foreground }]}>
        {label} {required ? <Text style={{ color: colors.destructive }}>*</Text> : null}
      </Text>
      {children}
    </View>
  );
}

function ResumeOption({
  checked,
  onSelect,
  label,
  meta,
  badge,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
  meta?: string;
  badge?: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ selected: checked }}
      style={[
        styles.resumeOption,
        {
          borderColor: checked ? colors.accent : colors.border,
          backgroundColor: checked ? colors.accentSoft : 'transparent',
        },
      ]}
    >
      <View
        style={[
          styles.radio,
          { borderColor: checked ? colors.accent : colors.foregroundSubtle },
        ]}
      >
        {checked ? <View style={[styles.radioDot, { backgroundColor: colors.accent }]} /> : null}
      </View>
      <View style={styles.resumeOptionText}>
        <Text style={[styles.resumeName, { color: colors.foreground }]} numberOfLines={1}>
          {label}
        </Text>
        {meta ? (
          <Text style={[styles.resumeMeta, { color: colors.foregroundMuted }]} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      {badge ? (
        <View style={[styles.badge, { borderColor: colors.border }]}>
          <Text style={[styles.badgeText, { color: colors.foregroundMuted }]}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function PickedResume({ file, onRemove }: { file: ResumeUpload; onRemove: () => void }) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.pickedResume,
        { borderColor: colors.border, backgroundColor: colors.background },
      ]}
    >
      <Feather name="file-text" size={15} color={colors.accent} />
      <Text style={[styles.pickedName, { color: colors.foreground }]} numberOfLines={1}>
        {file.name}
      </Text>
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.removeButton,
          {
            borderColor: colors.border,
            backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
          },
        ]}
      >
        <Feather name="x" size={12} color={colors.foreground} />
        <Text style={[styles.removeText, { color: colors.foreground }]}>Remove</Text>
      </Pressable>
    </View>
  );
}

function AttachButton({ onPress }: { onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.attach,
        {
          borderColor: pressed ? colors.accent : colors.border,
          backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
        },
      ]}
    >
      <Feather name="upload" size={15} color={colors.foregroundMuted} />
      <Text style={[styles.attachText, { color: colors.foregroundMuted }]}>Attach a resume</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.60)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  dialog: {
    maxHeight: '88%',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
  },
  title: { fontFamily: 'Geist_600SemiBold', fontSize: 18, marginBottom: 12 },
  formScroll: { flexGrow: 0 },
  form: { gap: 14, paddingBottom: 4 },
  jobLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
  },
  jobLineText: { flex: 1, gap: 1 },
  jobTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  jobMeta: { fontFamily: 'Geist_400Regular', fontSize: 12 },

  field: { gap: 6 },
  label: { fontFamily: 'Geist_500Medium', fontSize: 12 },
  labelHint: { fontFamily: 'Geist_400Regular', fontSize: 11 },
  input: {
    height: 42,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    fontFamily: 'Geist_400Regular',
    fontSize: 14,
  },
  resumeChoices: { gap: 8 },
  resumeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  radio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 8, height: 8, borderRadius: 4 },
  resumeOptionText: { flex: 1, gap: 1 },
  resumeName: { fontFamily: 'Geist_400Regular', fontSize: 13.5 },
  resumeMeta: { fontFamily: 'Geist_400Regular', fontSize: 11.5 },
  badge: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontFamily: 'Geist_400Regular', fontSize: 10.5 },
  pickedResume: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pickedName: { flex: 1, fontFamily: 'Geist_400Regular', fontSize: 13.5 },
  removeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
  },
  removeText: { fontFamily: 'Geist_500Medium', fontSize: 11.5 },
  attach: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    paddingVertical: 14,
  },
  attachText: { fontFamily: 'Geist_400Regular', fontSize: 13.5 },
  hint: { fontFamily: 'Geist_400Regular', fontSize: 11.5 },

  errorBox: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  errorText: { fontFamily: 'Geist_400Regular', fontSize: 12, lineHeight: 17 },

  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingTop: 14 },
  primaryButton: {
    minWidth: 120,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryButtonText: { fontFamily: 'Geist_600SemiBold', fontSize: 13.5 },
  secondaryButton: {
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  secondaryButtonText: { fontFamily: 'Geist_500Medium', fontSize: 13.5 },

  success: { alignItems: 'center', gap: 10, paddingVertical: 8 },
  successIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 18 },
  successBody: {
    fontFamily: 'Geist_400Regular',
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 300,
  },
});
