/**
 * Apply — the mobile rendering of the web ApplyModal. Collects the same three
 * text fields (name / portfolio / LinkedIn, prefilled from the profile) and a
 * resume: a saved one (default preselected) or a freshly picked file sent as
 * multipart. Client-side checks mirror the server's validation; the server
 * remains the authority and its failure copy is shown verbatim.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import {
  RESUME_MAX_BYTES,
  RESUME_MIME_TYPES,
  resumeFileIssue,
  validateApplyForm,
  type JobPost,
  type SavedResume,
} from '@/lib/jobs';
import { applyToJob, getApplyPrefill, getSavedResumes, type ResumeFile } from '@/lib/jobsApi';

interface Props {
  job: JobPost;
  visible: boolean;
  onClose: () => void;
  /** Fired once the application was accepted, so the screen can refresh. */
  onSubmitted: () => void;
}

type ResumeChoice = { kind: 'saved'; id: string } | { kind: 'file'; file: ResumeFile };

export function ApplySheet({ job, visible, onClose, onSubmitted }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [name, setName] = useState('');
  const [portfolioUrl, setPortfolioUrl] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [savedResumes, setSavedResumes] = useState<SavedResume[] | null>(null);
  const [choice, setChoice] = useState<ResumeChoice | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'name' | 'portfolioUrl' | 'linkedinUrl', string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  // Prefill and saved resumes each time the sheet opens; state resets on close.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSubmitted(false);
    setFieldErrors({});
    setChoice(null);

    (async () => {
      const [prefill, resumes] = await Promise.all([
        getApplyPrefill(user?.name ?? ''),
        getSavedResumes().catch(() => [] as SavedResume[]),
      ]);
      if (cancelled) return;
      setName(prefill.name);
      setPortfolioUrl(prefill.portfolioUrl);
      setLinkedinUrl(prefill.linkedinUrl);
      setSavedResumes(resumes);
      const preferred = resumes.find((resume) => resume.isDefault) ?? resumes[0];
      if (preferred) setChoice({ kind: 'saved', id: preferred.id });
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, user?.name]);

  const pickResumeFile = useCallback(async () => {
    setError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [...RESUME_MIME_TYPES],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const issue = resumeFileIssue(asset.mimeType ?? null, asset.size ?? null);
      if (issue === 'resume_too_large') {
        setError('Resumes must be 5 MB or smaller.');
        return;
      }
      if (issue === 'resume_bad_type') {
        setError('Attach a PDF, DOC, DOCX or RTF resume.');
        return;
      }
      setChoice({
        kind: 'file',
        file: {
          uri: asset.uri,
          name: asset.name ?? 'resume',
          mimeType: asset.mimeType ?? 'application/octet-stream',
        },
      });
    } catch {
      setError("The file couldn't be opened. Try another one.");
    }
  }, []);

  const submit = useCallback(async () => {
    setError(null);
    const errors = validateApplyForm({ name, portfolioUrl, linkedinUrl });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    if (!choice) {
      setError('Attach a resume to apply.');
      return;
    }

    setSubmitting(true);
    try {
      await applyToJob(job.id, {
        name,
        portfolioUrl,
        linkedinUrl,
        savedResumeId: choice.kind === 'saved' ? choice.id : null,
        resumeFile: choice.kind === 'file' ? choice.file : null,
      });
      setSubmitted(true);
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The application could not be submitted.');
    } finally {
      setSubmitting(false);
    }
  }, [choice, job.id, linkedinUrl, name, onSubmitted, portfolioUrl]);

  const selectedFileLabel = useMemo(() => {
    if (choice?.kind !== 'file') return null;
    return choice.file.name;
  }, [choice]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.header,
            {
              borderBottomColor: colors.border,
              paddingTop: Math.max(insets.top, 16),
            },
          ]}
        >
          <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={onClose}>
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
            Apply · {job.title}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        {submitted ? (
          <View style={styles.successBody}>
            <View style={[styles.successIcon, { backgroundColor: colors.accentSoft }]}>
              <Feather name="check" size={26} color={colors.accent} />
            </View>
            <Text style={[styles.successTitle, { color: colors.foreground }]}>
              Application submitted
            </Text>
            <Text style={[styles.successBodyText, { color: colors.mutedForeground }]}>
              {job.company.name} received your application for {job.title}.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={[styles.primaryButton, { backgroundColor: colors.accent }]}
            >
              <Text style={[styles.primaryButtonText, { color: colors.accentForeground }]}>Done</Text>
            </Pressable>
          </View>
        ) : loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]}
            keyboardShouldPersistTaps="handled"
          >
            <Field
              label="Full name"
              value={name}
              onChangeText={setName}
              error={fieldErrors.name}
              autoCapitalize="words"
            />
            <Field
              label="Portfolio URL"
              value={portfolioUrl}
              onChangeText={setPortfolioUrl}
              error={fieldErrors.portfolioUrl}
              keyboardType="url"
              autoCapitalize="none"
              placeholder="https://"
            />
            <Field
              label="LinkedIn profile"
              value={linkedinUrl}
              onChangeText={setLinkedinUrl}
              error={fieldErrors.linkedinUrl}
              keyboardType="url"
              autoCapitalize="none"
              placeholder="https://linkedin.com/in/…"
            />

            <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Resume</Text>

            {savedResumes !== null && savedResumes.length > 0 && (
              <View style={[styles.savedList, { borderColor: colors.border }]}>
                {savedResumes.map((resume, index) => {
                  const selected = choice?.kind === 'saved' && choice.id === resume.id;
                  return (
                    <Pressable
                      key={resume.id}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => setChoice({ kind: 'saved', id: resume.id })}
                      style={[
                        styles.savedRow,
                        index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                        selected && { backgroundColor: colors.accentSoft },
                      ]}
                    >
                      <Feather
                        name={selected ? 'check-circle' : 'circle'}
                        size={16}
                        color={selected ? colors.accent : colors.mutedForeground}
                      />
                      <Text style={[styles.savedName, { color: colors.foreground }]} numberOfLines={1}>
                        {resume.fileName}
                      </Text>
                      {resume.isDefault && (
                        <Text style={[styles.savedDefault, { color: colors.foregroundSubtle }]}>
                          Default
                        </Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            )}

            <Pressable
              accessibilityRole="button"
              onPress={() => void pickResumeFile()}
              style={[
                styles.uploadRow,
                {
                  borderColor: choice?.kind === 'file' ? colors.accent : colors.inputBorder,
                  backgroundColor: choice?.kind === 'file' ? colors.accentSoft : 'transparent',
                },
              ]}
            >
              <Feather name="upload" size={16} color={colors.mutedForeground} />
              <Text style={[styles.uploadText, { color: colors.foreground }]} numberOfLines={1}>
                {selectedFileLabel ?? 'Upload a new resume'}
              </Text>
              <Text style={[styles.uploadHint, { color: colors.foregroundSubtle }]}>
                PDF, DOC, DOCX, RTF
              </Text>
            </Pressable>

            {error && (
              <View style={[styles.errorBox, { borderColor: colors.destructive }]}>
                <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
              </View>
            )}

            <Pressable
              accessibilityRole="button"
              disabled={submitting}
              onPress={() => void submit()}
              style={[styles.primaryButton, { backgroundColor: colors.accent }, submitting && { opacity: 0.6 }]}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={colors.accentForeground} />
              ) : (
                <Text style={[styles.primaryButtonText, { color: colors.accentForeground }]}>
                  Submit application
                </Text>
              )}
            </Pressable>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChangeText,
  error,
  placeholder,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  placeholder?: string;
  keyboardType?: 'default' | 'url';
  autoCapitalize?: 'none' | 'sentences' | 'words';
}) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.foregroundSubtle}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        style={[
          styles.input,
          {
            color: colors.foreground,
            backgroundColor: colors.input,
            borderColor: error ? colors.destructive : colors.inputBorder,
          },
        ]}
      />
      {error && <Text style={[styles.fieldError, { color: colors.destructive }]}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { flex: 1, fontFamily: 'Geist_600SemiBold', fontSize: 16, textAlign: 'center' },
  headerSpacer: { width: 22 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 16, gap: 14 },
  field: { gap: 6 },
  fieldLabel: { fontFamily: 'Geist_500Medium', fontSize: 12.5 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    fontFamily: 'Geist_400Regular',
    fontSize: 14.5,
  },
  fieldError: { fontFamily: 'Geist_400Regular', fontSize: 12, marginTop: 2 },
  sectionLabel: { fontFamily: 'Geist_600SemiBold', fontSize: 14, marginTop: 6 },
  savedList: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    overflow: 'hidden',
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  savedName: { flex: 1, fontFamily: 'Geist_400Regular', fontSize: 14 },
  savedDefault: { fontFamily: 'Geist_400Regular', fontSize: 11.5 },
  uploadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 13,
  },
  uploadText: { flex: 1, fontFamily: 'Geist_400Regular', fontSize: 14 },
  uploadHint: { fontFamily: 'Geist_400Regular', fontSize: 11 },
  errorBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 10,
  },
  errorText: { fontFamily: 'Geist_400Regular', fontSize: 13, lineHeight: 18 },
  primaryButton: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  primaryButtonText: { fontFamily: 'Geist_600SemiBold', fontSize: 15 },
  successBody: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  successIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  successTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 18 },
  successBodyText: {
    fontFamily: 'Geist_400Regular',
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: 'center',
  },
});
