import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/settings/ScreenHeader';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { hapticSelection } from '@/lib/haptics';
import { prepareImageForUpload, type PreparedImage } from '@/lib/prepareImage';
import {
  confirmVerificationCode,
  deleteVerificationSample,
  getVerification,
  sendVerificationCode,
  submitVerification,
  uploadVerificationSample,
  type VerificationData,
  type VerificationStatus,
} from '@/lib/verification';

function dateLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function errorText(error: unknown, fallback: string): string {
  const data = (error as { data?: { error?: string; retryAfter?: number } } | null)?.data;
  if (data?.error) return data.error;
  return error instanceof Error ? error.message : fallback;
}

function StatusCard({
  tone,
  icon,
  title,
  children,
}: {
  tone: 'amber' | 'red' | 'green';
  icon: React.ComponentProps<typeof Feather>['name'];
  title: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const toneColor =
    tone === 'green' ? colors.success : tone === 'red' ? colors.destructive : colors.link;
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.statusRow}>
        <Feather name={icon} size={16} color={toneColor} />
        <Text style={[styles.statusTitle, { color: colors.foreground }]}>{title}</Text>
      </View>
      <Text style={[styles.hint, { color: colors.mutedForeground }]}>{children}</Text>
    </View>
  );
}

export default function VerificationScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { refresh } = useAuth();

  const [data, setData] = useState<VerificationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [linkedin, setLinkedin] = useState('');
  const [portfolio1, setPortfolio1] = useState('');
  const [portfolio2, setPortfolio2] = useState('');
  const [showSecondPortfolio, setShowSecondPortfolio] = useState(false);
  const [samples, setSamples] = useState<string[]>([]);
  const [emailVerifiedAt, setEmailVerifiedAt] = useState<string | null>(null);

  const [code, setCode] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [confirmingCode, setConfirmingCode] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const next = await getVerification();
      setData(next);
      setEmailVerifiedAt(next.emailVerifiedAt);
      if (next.latest) {
        setLinkedin(next.latest.linkedinUrl ?? '');
        setPortfolio1(next.latest.portfolioLinks[0] ?? '');
        setPortfolio2(next.latest.portfolioLinks[1] ?? '');
        setShowSecondPortfolio(Boolean(next.latest.portfolioLinks[1]));
        setSamples(next.latest.workSampleUrls ?? []);
      }
    } catch (loadFailure) {
      setLoadError(errorText(loadFailure, 'Could not load your verification status.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!cooldown) return;
    const timer = setInterval(() => {
      setCooldown((value) => (value > 0 ? value - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const sendCode = useCallback(async () => {
    if (sendingCode || cooldown > 0) return;
    hapticSelection();
    setSendingCode(true);
    setError(null);
    setNotice(null);
    try {
      const result = await sendVerificationCode();
      if (result.alreadyVerified) {
        setEmailVerifiedAt(new Date().toISOString());
        setNotice('Your email is already verified.');
        return;
      }
      setCooldown(60);
      setNotice(`Code sent to ${result.email ?? data?.email ?? 'your email'}.`);
    } catch (sendError) {
      const retryAfter = (sendError as { data?: { retryAfter?: number } })?.data?.retryAfter;
      if (typeof retryAfter === 'number') setCooldown(retryAfter);
      setError(errorText(sendError, 'Could not send the code.'));
    } finally {
      setSendingCode(false);
    }
  }, [cooldown, data?.email, sendingCode]);

  const confirmCode = useCallback(async () => {
    if (confirmingCode || code.length !== 6) return;
    setConfirmingCode(true);
    setError(null);
    setNotice(null);
    try {
      const verifiedAt = await confirmVerificationCode(code);
      setEmailVerifiedAt(verifiedAt);
      setCode('');
      setNotice('Email verified.');
    } catch (confirmError) {
      setError(errorText(confirmError, 'That code is incorrect.'));
    } finally {
      setConfirmingCode(false);
    }
  }, [code, confirmingCode]);

  const pickSamples = useCallback(async () => {
    if (uploading) return;
    const room = 3 - samples.length;
    if (room <= 0) {
      setError('You can upload up to 3 work samples.');
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== 'granted') return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: room,
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;

    setUploading(true);
    setError(null);
    try {
      for (const [index, asset] of result.assets.slice(0, room).entries()) {
        let prepared: PreparedImage;
        try {
          prepared = await prepareImageForUpload(asset, `work-sample-${Date.now()}-${index}`);
        } catch {
          prepared = {
            uri: asset.uri,
            mimeType: 'image/jpeg',
            name: `work-sample-${Date.now()}-${index}.jpg`,
            width: asset.width,
            height: asset.height,
          };
        }
        const url = await uploadVerificationSample(prepared);
        setSamples((current) => (current.includes(url) ? current : [...current, url]));
      }
    } catch (uploadError) {
      setError(errorText(uploadError, 'Upload failed.'));
    } finally {
      setUploading(false);
    }
  }, [samples.length, uploading]);

  const removeSample = useCallback((url: string) => {
    setSamples((current) => current.filter((value) => value !== url));
    void deleteVerificationSample(url).catch(() => {});
  }, []);

  const submit = useCallback(async () => {
    if (submitting || uploading) return;
    setError(null);
    setNotice(null);

    const portfolioLinks = [portfolio1, portfolio2]
      .map((value) => value.trim())
      .filter(Boolean);

    if (!linkedin.trim()) {
      setError('Your LinkedIn profile is required.');
      return;
    }
    if (portfolioLinks.length === 0) {
      setError('Add at least one portfolio link.');
      return;
    }
    if (!emailVerifiedAt) {
      setError('Verify your account email before submitting.');
      return;
    }

    setSubmitting(true);
    try {
      await submitVerification({
        linkedinUrl: linkedin.trim(),
        portfolioLinks,
        workSampleUrls: samples,
      });
      setData((current) =>
        current
          ? {
              ...current,
              status: 'pending',
              rejectionReason: null,
              reapplyAt: null,
              latest: {
                id: current.latest?.id ?? 'pending',
                status: 'pending',
                linkedinUrl: linkedin.trim(),
                portfolioLinks,
                workSampleUrls: samples,
                rejectionReason: null,
                reviewedAt: null,
                createdAt: new Date().toISOString(),
              },
            }
          : current,
      );
      setNotice('Submitted. An admin will review your profile.');
      await refresh();
    } catch (submitError) {
      setError(errorText(submitError, 'Could not submit your verification.'));
    } finally {
      setSubmitting(false);
    }
  }, [emailVerifiedAt, linkedin, portfolio1, portfolio2, refresh, samples, submitting, uploading]);

  if (loading) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <ScreenHeader title="Verification" />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  if (loadError || !data) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <ScreenHeader title="Verification" />
        <View style={styles.center}>
          <Text style={[styles.hint, { color: colors.destructive }]}>
            {loadError ?? 'Could not load your verification status.'}
          </Text>
          <Pressable onPress={() => void load()} accessibilityRole="button">
            <Text style={[styles.link, { color: colors.primary }]}>Tap to retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const status: VerificationStatus = data.status;
  const reapplyBlocked =
    status === 'rejected' && data.reapplyAt != null && new Date(data.reapplyAt) > new Date();

  const statusView =
    status === 'approved' ? (
      <StatusCard tone="green" icon="check-circle" title="Your account is verified">
        You have full access to post, message, join communities, and apply to jobs.
      </StatusCard>
    ) : status === 'pending' ? (
      <StatusCard tone="amber" icon="clock" title="Verification under review">
        Submitted {dateLabel(data.latest?.createdAt)}. An admin will review it soon. Your account
        stays read-only until then.
      </StatusCard>
    ) : reapplyBlocked ? (
      <StatusCard tone="red" icon="x-circle" title="Verification not approved">
        {data.rejectionReason ? `Reason: ${data.rejectionReason}\n` : ''}
        You can reapply from {dateLabel(data.reapplyAt)}. We&apos;ll email you when the window
        opens.
      </StatusCard>
    ) : status === 'rejected' ? (
      <StatusCard tone="red" icon="x-circle" title="Your previous verification was not approved">
        {data.rejectionReason ? `Reason: ${data.rejectionReason}\n` : ''}
        Update your details below and submit again.
      </StatusCard>
    ) : null;

  const showForm = status !== 'approved' && status !== 'pending' && !reapplyBlocked;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title="Verification"
        subtitle="Verify your profile to unlock posting and messaging."
      />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {statusView}

        {showForm ? (
          <>
            {error ? (
              <View style={[styles.alert, { borderColor: colors.destructive, backgroundColor: colors.card }]}>
                <Text style={[styles.hint, { color: colors.destructive }]}>{error}</Text>
              </View>
            ) : null}
            {notice ? (
              <View style={[styles.alert, { borderColor: colors.success, backgroundColor: colors.card }]}>
                <Text style={[styles.hint, { color: colors.success }]}>{notice}</Text>
              </View>
            ) : null}

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Verify your account email *
              </Text>
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                We send a six-digit code to the email you signed up with.
              </Text>
              <TextInput
                value={data.email}
                editable={false}
                style={[
                  styles.input,
                  {
                    color: colors.mutedForeground,
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                  },
                ]}
              />

              {emailVerifiedAt ? (
                <Text style={[styles.verified, { color: colors.success }]}>
                  <Feather name="check-circle" size={13} /> Email verified
                </Text>
              ) : (
                <>
                  <Pressable
                    onPress={() => void sendCode()}
                    disabled={sendingCode || cooldown > 0}
                    style={({ pressed }) => [
                      styles.secondaryButton,
                      {
                        borderColor: colors.border,
                        opacity: sendingCode || cooldown > 0 ? 0.5 : pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.secondaryText, { color: colors.foreground }]}>
                      {sendingCode
                        ? 'Sending…'
                        : cooldown > 0
                          ? `Resend in ${cooldown}s`
                          : 'Send code'}
                    </Text>
                  </Pressable>

                  <View style={styles.codeRow}>
                    <TextInput
                      value={code}
                      onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
                      keyboardType="number-pad"
                      textContentType="oneTimeCode"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="6-digit code"
                      placeholderTextColor={colors.mutedForeground}
                      style={[
                        styles.input,
                        styles.codeInput,
                        {
                          color: colors.foreground,
                          borderColor: colors.border,
                          backgroundColor: colors.background,
                        },
                      ]}
                    />
                    <Pressable
                      onPress={() => void confirmCode()}
                      disabled={confirmingCode || code.length !== 6}
                      style={({ pressed }) => [
                        styles.primaryButton,
                        {
                          backgroundColor: colors.primary,
                          opacity: confirmingCode || code.length !== 6 ? 0.5 : pressed ? 0.85 : 1,
                        },
                      ]}
                    >
                      <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>
                        {confirmingCode ? 'Checking…' : 'Verify'}
                      </Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                LinkedIn profile *
              </Text>
              <TextInput
                value={linkedin}
                onChangeText={setLinkedin}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="https://www.linkedin.com/in/yourprofile"
                placeholderTextColor={colors.mutedForeground}
                style={[
                  styles.input,
                  {
                    color: colors.foreground,
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                  },
                ]}
              />
            </View>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Design portfolio links *
              </Text>
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                Add 1–2 links to your best work. Google Docs and Notion pages are fine.
              </Text>
              <TextInput
                value={portfolio1}
                onChangeText={setPortfolio1}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="https://yourportfolio.com"
                placeholderTextColor={colors.mutedForeground}
                style={[
                  styles.input,
                  {
                    color: colors.foreground,
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                  },
                ]}
              />
              {showSecondPortfolio ? (
                <View style={styles.secondLinkRow}>
                  <TextInput
                    value={portfolio2}
                    onChangeText={setPortfolio2}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    placeholder="Optional second link"
                    placeholderTextColor={colors.mutedForeground}
                    style={[
                      styles.input,
                      styles.secondLinkInput,
                      {
                        color: colors.foreground,
                        borderColor: colors.border,
                        backgroundColor: colors.background,
                      },
                    ]}
                  />
                  <Pressable
                    onPress={() => {
                      setPortfolio2('');
                      setShowSecondPortfolio(false);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Remove second portfolio link"
                    hitSlop={8}
                  >
                    <Text style={[styles.removeLink, { color: colors.mutedForeground }]}>
                      Remove
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={() => setShowSecondPortfolio(true)}
                  accessibilityRole="button"
                  style={styles.addLink}
                >
                  <Text style={[styles.addLinkText, { color: colors.link }]}>
                    + Add another link
                  </Text>
                </Pressable>
              )}
            </View>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Upload work samples
              </Text>
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                Optional but recommended. Up to 3 recent UI/UX, web, mobile, or SaaS designs. Only
                submit work that is yours.
              </Text>

              <View style={styles.samples}>
                {samples.map((url) => (
                  <View key={url} style={[styles.sample, { borderColor: colors.border }]}>
                    <Image source={{ uri: url }} style={styles.sampleImage} />
                    <Pressable
                      onPress={() => removeSample(url)}
                      accessibilityRole="button"
                      accessibilityLabel="Remove work sample"
                      style={[styles.remove, { backgroundColor: colors.background }]}
                    >
                      <Feather name="x" size={12} color={colors.foreground} />
                    </Pressable>
                  </View>
                ))}

                {samples.length < 3 ? (
                  <Pressable
                    onPress={() => void pickSamples()}
                    disabled={uploading}
                    style={({ pressed }) => [
                      styles.addSample,
                      {
                        borderColor: colors.border,
                        backgroundColor: pressed ? colors.surfaceRaised : colors.background,
                        opacity: uploading ? 0.5 : 1,
                      },
                    ]}
                  >
                    <Feather name="plus" size={16} color={colors.mutedForeground} />
                    <Text style={[styles.addSampleText, { color: colors.mutedForeground }]}>
                      {uploading ? 'Uploading…' : 'Add images'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            <Pressable
              onPress={() => void submit()}
              disabled={submitting || uploading}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: colors.primary,
                  opacity: submitting || uploading ? 0.5 : pressed ? 0.85 : 1,
                },
              ]}
            >
              {submitting ? (
                <ActivityIndicator color={colors.primaryForeground} size="small" />
              ) : (
                <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>
                  Submit for review
                </Text>
              )}
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  card: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 10 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusTitle: { fontSize: 14, fontFamily: 'Geist_600SemiBold' },
  sectionTitle: { fontSize: 14, fontFamily: 'Geist_500Medium' },
  hint: { fontSize: 12, lineHeight: 18, fontFamily: 'Geist_400Regular' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: 'Geist_400Regular',
  },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  codeInput: { flex: 1, letterSpacing: 4 },
  verified: { fontSize: 12, fontFamily: 'Geist_500Medium' },
  secondaryButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  secondaryText: { fontSize: 12, fontFamily: 'Geist_500Medium' },
  primaryButton: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontSize: 13, fontFamily: 'Geist_500Medium' },
  samples: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sample: { width: 96, height: 76, borderRadius: 10, borderWidth: 1, overflow: 'hidden' },
  sampleImage: { width: '100%', height: '100%' },
  remove: {
    position: 'absolute',
    top: 4,
    right: 4,
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 3,
  },
  addSample: {
    width: 96,
    height: 76,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  addSampleText: { fontSize: 10, fontFamily: 'Geist_500Medium' },
  alert: { borderWidth: 1, borderRadius: 10, padding: 12 },
  link: { fontSize: 13, fontFamily: 'Geist_500Medium' },
  addLink: { alignSelf: 'flex-start', paddingVertical: 2 },
  addLinkText: { fontSize: 12, fontFamily: 'Geist_500Medium' },
  secondLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  secondLinkInput: { flex: 1 },
  removeLink: { fontSize: 12, fontFamily: 'Geist_500Medium' },
});
