import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { Feather, Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CompanyMark, CompanyVerifiedMark } from '@/components/companies/CompanyMark';
import { useColors } from '@/hooks/useColors';
import { hapticSelection, hapticSuccess } from '@/lib/haptics';
import {
  confirmCompanyVerification,
  searchCompanies,
  startCompanyVerification,
  type CompanyOption,
  type PendingCompanyVerification,
} from '@/lib/companies';
import {
  checkWorkEmail,
  companyNameMatchesDomain,
  companyNamesMatch,
  domainFromEmail,
  normalizeDomain,
  suggestedCompanyName,
} from '@/lib/companyDomains';

/**
 * "Where do you work?" — the mobile port of the web AddCompanyModal: search a
 * company, or create the one that is missing; give a work email, which is the
 * domain being claimed; enter the code we mail to it. Everything that could
 * grant a membership is decided by the server — this modal only collects the
 * member's choices and renders the answer, including the case where the
 * domain turns out to belong to a different company (it offers that company
 * instead of letting the member through).
 *
 * The web's "View company page" link is left out: companies have no page in
 * the app.
 */

type Step = 'search' | 'email' | 'verify' | 'done';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** An outstanding challenge, so reopening lands straight on the code step. */
  initialPending: PendingCompanyVerification | null;
  /** Called once a membership is proven, so the screen behind refreshes. */
  onVerified: () => void;
}

const HITS_PAGE_SIZE = 8;

/** A refusal the server returned, with the company it suggests instead. */
interface FormFailure {
  code: string;
  message: string;
  company?: CompanyOption;
}

function FailureNotice({
  failure,
  colors,
  onJoin,
}: {
  failure: FormFailure;
  colors: ReturnType<typeof useColors>;
  onJoin: (company: CompanyOption) => void;
}) {
  const target = failure.company?.id ? failure.company : null;
  return (
    <View style={[styles.noticeBox, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}>
      <Text style={[styles.noticeText, { color: colors.mutedForeground }]}>{failure.message}</Text>
      {target ? (
        <Pressable onPress={() => onJoin(target)} accessibilityRole="button">
          <Text style={[styles.noticeAction, { color: colors.accent }]}>
            Join {target.name} instead
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function AddCompanyModal({ visible, onClose, initialPending, onVerified }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<Step>(initialPending ? 'verify' : 'search');

  // Search
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<CompanyOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);

  // Selection: an existing company, or a name for one that does not exist yet.
  const [selected, setSelected] = useState<CompanyOption | null>(
    initialPending?.companyId
      ? { id: initialPending.companyId, name: initialPending.companyName }
      : null,
  );
  const [newName, setNewName] = useState(
    initialPending && !initialPending.companyId ? initialPending.companyName : '',
  );

  // Work email
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formFailure, setFormFailure] = useState<FormFailure | null>(null);

  // Verification
  const [pending, setPending] = useState<PendingCompanyVerification | null>(initialPending);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(initialPending?.attemptsLeft ?? null);
  const codeRef = useRef<TextInput>(null);

  // Result
  const [verified, setVerified] = useState<{
    name: string;
    domain: string | null;
    domainVerified: boolean;
  } | null>(null);

  // Directory search, debounced. The empty query browses the directory.
  useEffect(() => {
    if (!visible || step !== 'search') return;
    const controller = new AbortController();
    let current = true;
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchFailed(false);
      try {
        const companies = await searchCompanies(query);
        if (!current) return;
        setHits(companies);
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        if (!current) return;
        setSearchFailed(true);
        setHits([]);
      } finally {
        if (current) setSearching(false);
      }
    }, 250);

    return () => {
      current = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [visible, step, query]);

  useEffect(() => {
    if (step === 'verify') {
      const t = setTimeout(() => codeRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [step]);

  const trimmedQuery = query.trim();
  const emailCheck = email.trim() ? checkWorkEmail(email) : null;
  const emailInvalid = emailCheck?.ok === false ? emailCheck : null;

  // The domain a new company will be verified by comes from the work email, so
  // the name can be checked against it before the member submits.
  const claimedDomain = domainFromEmail(email);
  const nameMismatch =
    !selected && newName.trim() && claimedDomain
      ? companyNameMatchesDomain(newName, claimedDomain)
      : null;
  const nameSuggestion = claimedDomain ? suggestedCompanyName(claimedDomain) : '';

  // The create row closes only for a company that is already on screen — a
  // listed one answering to the typed name, or owning the typed domain.
  const typedDomain = normalizeDomain(trimmedQuery);
  const alreadyListed = hits.some(
    (company) =>
      companyNamesMatch(trimmedQuery, company.name) ||
      (typedDomain !== null && typedDomain === company.domain),
  );

  const start = useCallback(
    async (payload: {
      company_id?: string | null;
      company_name?: string | null;
      work_email?: string;
      verification_id?: string;
    }) => {
      setSubmitting(true);
      setFormError(null);
      setFormFailure(null);
      setCodeError(null);
      try {
        const next = await startCompanyVerification(payload);
        setPending(next);
        setAttemptsLeft(next.attemptsLeft);
        setStep('verify');
        return true;
      } catch (e) {
        const hasStatus = typeof (e as { status?: number }).status === 'number';
        const data = (e as { data?: { error?: string; message?: string; company?: CompanyOption } }).data;
        setFormFailure(
          hasStatus
            ? {
                code: data?.error ?? 'unexpected',
                message: data?.message ?? "Couldn't send the verification email. Please try again.",
                company: data?.company,
              }
            : { code: 'network', message: 'Network error. Please try again.' },
        );
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [],
  );

  const handleSendCode = useCallback(async () => {
    const check = checkWorkEmail(email);
    if (!check.ok) {
      setFormError(check.message);
      return;
    }
    await start({
      // A company id is a hint the database re-validates against the domain;
      // without one, the typed name is the label for the domain being proven.
      company_id: selected?.id ?? null,
      company_name: selected ? null : newName.trim(),
      work_email: email.trim(),
    });
  }, [email, selected, newName, start]);

  const handleResend = useCallback(async () => {
    if (!pending) return;
    // The raw work email never reaches the client, so a resend names the
    // member's own challenge and the server reads the address back from it.
    await start({ verification_id: pending.id });
  }, [pending, start]);

  const handleConfirm = useCallback(
    async (entered: string) => {
      if (!pending) return;
      setVerifying(true);
      setCodeError(null);
      try {
        const company = await confirmCompanyVerification(pending.id, entered);
        hapticSuccess();
        setVerified({
          name: company.name,
          domain: company.domain ?? null,
          domainVerified: company.verifiedVia !== 'mailbox_only',
        });
        setPending(null);
        setStep('done');
        onVerified();
      } catch (e) {
        const hasStatus = typeof (e as { status?: number }).status === 'number';
        const data = (e as {
          data?: { error?: string; message?: string; attemptsLeft?: number | null; company?: CompanyOption };
        }).data;

        if (!hasStatus) {
          setCodeError('Network error. Please try again.');
          return;
        }

        if (data?.error === 'domain_already_verified' || data?.error === 'domain_not_verified') {
          // The domain moved out from under this challenge: send the member
          // back to search with the reason.
          setPending(null);
          setStep('search');
          setFormFailure({
            code: data.error,
            message: data.message ?? 'That domain is no longer available for this company.',
            company: data.company,
          });
          return;
        }

        setCodeError(data?.message ?? "That code doesn't match. Check the email and try again.");
        if (typeof data?.attemptsLeft === 'number') setAttemptsLeft(data.attemptsLeft);
        setCode('');

        if (data?.error === 'expired' || data?.error === 'already_used' || data?.error === 'not_found') {
          setPending(null);
          setStep('search');
          setFormFailure({
            code: data.error,
            message: data.message ?? 'That verification expired. Start again.',
          });
        }
      } finally {
        setVerifying(false);
      }
    },
    [pending, onVerified],
  );

  const chooseExisting = useCallback((company: CompanyOption) => {
    hapticSelection();
    setSelected(company);
    setFormFailure(null);
    setFormError(null);
    setStep('email');
  }, []);

  const chooseNew = useCallback(() => {
    setSelected(null);
    setNewName(trimmedQuery);
    setFormFailure(null);
    setFormError(null);
    setStep('email');
  }, [trimmedQuery]);

  const handleCodeChange = useCallback(
    (value: string) => {
      const digits = value.replace(/\D/g, '').slice(0, 6);
      setCode(digits);
      setCodeError(null);
      if (digits.length === 6) void handleConfirm(digits);
    },
    [handleConfirm],
  );

  const title =
    step === 'search'
      ? 'Where do you work?'
      : step === 'email'
        ? 'Verify your work email'
        : step === 'verify'
          ? 'Check your inbox'
          : 'Company added';

  return (
    <Modal
      transparent
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.backdrop, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]}
            showsVerticalScrollIndicator={false}
          >
            {/* ── 1. Search: existing companies, or create one ── */}
            {step === 'search' ? (
              <View>
                <View style={[styles.searchBox, { backgroundColor: colors.surfaceRaised }]}>
                  <Feather name="search" size={15} color={colors.mutedForeground} />
                  <TextInput
                    autoFocus
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search company"
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.searchInput, { color: colors.foreground }]}
                  />
                  {searching ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : null}
                </View>

                {formFailure ? (
                  <FailureNotice failure={formFailure} colors={colors} onJoin={chooseExisting} />
                ) : null}

                <View style={styles.hits}>
                  {hits.length > 0 ? (
                    hits.slice(0, HITS_PAGE_SIZE).map((company) => (
                      <Pressable
                        key={company.id}
                        onPress={() => chooseExisting(company)}
                        accessibilityRole="button"
                        style={({ pressed }) => [
                          styles.hitRow,
                          {
                            backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
                            borderColor: pressed ? colors.border : 'transparent',
                          },
                        ]}
                      >
                        <CompanyMark name={company.name} logoUrl={company.logoUrl} size={34} />
                        <View style={styles.hitText}>
                          <Text
                            style={[styles.hitName, { color: colors.foreground }]}
                            numberOfLines={1}
                          >
                            {company.name}
                          </Text>
                          <View style={styles.hitMetaRow}>
                            {company.domain ? (
                              <Text
                                style={[styles.hitMeta, { color: colors.mutedForeground }]}
                                numberOfLines={1}
                              >
                                {company.domain}
                              </Text>
                            ) : (
                              <Text style={[styles.hitMeta, { color: colors.foregroundSubtle }]}>
                                No domain on file yet
                              </Text>
                            )}
                            {company.verified ? (
                              <CompanyVerifiedMark size={11} color={colors.accent} />
                            ) : null}
                          </View>
                        </View>
                        {typeof company.memberCount === 'number' && company.memberCount > 0 ? (
                          <Text style={[styles.hitCount, { color: colors.foregroundSubtle }]}>
                            {company.memberCount} {company.memberCount === 1 ? 'member' : 'members'}
                          </Text>
                        ) : null}
                      </Pressable>
                    ))
                  ) : (
                    <Text style={[styles.hitsEmpty, { color: colors.mutedForeground }]}>
                      {searching
                        ? 'Searching…'
                        : searchFailed
                          ? "Couldn't load companies. Check your connection and try again."
                          : 'No companies match that yet.'}
                    </Text>
                  )}
                </View>

                {!alreadyListed ? (
                  <Pressable
                    onPress={chooseNew}
                    disabled={!trimmedQuery}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.createRow,
                      {
                        borderColor: pressed ? colors.accent + '66' : colors.border,
                        opacity: !trimmedQuery ? 0.5 : 1,
                      },
                    ]}
                  >
                    <View style={[styles.createIcon, { backgroundColor: colors.surfaceRaised }]}>
                      <Ionicons name="business" size={14} color={colors.mutedForeground} />
                    </View>
                    <View style={styles.createText}>
                      <Text
                        style={[styles.hitName, { color: colors.foreground }]}
                        numberOfLines={1}
                      >
                        {trimmedQuery ? `Create “${trimmedQuery}”` : 'Add a company'}
                      </Text>
                      <Text style={[styles.hitMeta, { color: colors.mutedForeground }]}>
                        {trimmedQuery
                          ? "We'll verify it with your work email"
                          : 'Search for your company, or type its name'}
                      </Text>
                    </View>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {/* ── 2. Work email — the domain being claimed ── */}
            {step === 'email' ? (
              <View>
                <Pressable
                  onPress={() => setStep('search')}
                  accessibilityRole="button"
                  style={styles.backLink}
                >
                  <Feather name="arrow-left" size={12} color={colors.mutedForeground} />
                  <Text style={[styles.backLinkText, { color: colors.mutedForeground }]}>
                    Back to search
                  </Text>
                </Pressable>

                <View style={[styles.companyCard, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}>
                  <CompanyMark
                    name={selected?.name ?? (newName.trim() || '?')}
                    logoUrl={selected?.logoUrl}
                    size={36}
                  />
                  <View style={styles.companyCardText}>
                    {selected ? (
                      <>
                        <Text
                          style={[styles.hitName, { color: colors.foreground }]}
                          numberOfLines={1}
                        >
                          {selected.name}
                        </Text>
                        <View style={styles.hitMetaRow}>
                          {selected.domain ? (
                            <Text
                              style={[styles.hitMeta, { color: colors.mutedForeground }]}
                              numberOfLines={1}
                            >
                              {selected.domain}
                            </Text>
                          ) : null}
                          {selected.verified ? (
                            <CompanyVerifiedMark size={11} color={colors.accent} />
                          ) : null}
                        </View>
                      </>
                    ) : (
                      <>
                        <Text
                          style={[styles.hitName, { color: colors.foreground }]}
                          numberOfLines={1}
                        >
                          {newName.trim()}
                        </Text>
                        <Text style={[styles.hitMeta, { color: colors.mutedForeground }]}>
                          New company · verified by {claimedDomain ?? 'your work email domain'}
                        </Text>
                      </>
                    )}
                  </View>
                </View>

                {!selected ? (
                  <View style={styles.field}>
                    <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                      COMPANY NAME
                    </Text>
                    <TextInput
                      value={newName}
                      onChangeText={setNewName}
                      placeholder="Figma"
                      placeholderTextColor={colors.mutedForeground}
                      maxLength={120}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={[
                        styles.input,
                        { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border },
                      ]}
                    />
                  </View>
                ) : null}

                <View style={styles.field}>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                    WORK EMAIL
                  </Text>
                  <TextInput
                    value={email}
                    onChangeText={(value) => {
                      setEmail(value);
                      setFormError(null);
                    }}
                    placeholder="you@company.com"
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    style={[
                      styles.input,
                      { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border },
                    ]}
                  />
                  <Text
                    style={[
                      styles.emailHint,
                      { color: emailInvalid || formError ? colors.mutedForeground : colors.foregroundSubtle },
                    ]}
                  >
                    {formError ??
                      emailInvalid?.message ??
                      "We'll email a code to prove you work there. It verifies the domain, not a job title."}
                  </Text>
                </View>

                {/* The name has to correspond to the domain being proved. The
                    server enforces this; saying it here lets the member fix it
                    before submitting. */}
                {nameMismatch?.ok === false && claimedDomain ? (
                  <View style={[styles.noticeBox, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}>
                    <Text style={[styles.noticeText, { color: colors.mutedForeground }]}>
                      A company is named after the domain it proves. “{newName.trim()}” doesn&apos;t
                      match {claimedDomain}, and members see the domain beside the name.
                    </Text>
                    {nameSuggestion ? (
                      <Pressable onPress={() => setNewName(nameSuggestion)} accessibilityRole="button">
                        <Text style={[styles.noticeAction, { color: colors.accent }]}>
                          Use “{nameSuggestion}” instead
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}

                {formFailure ? (
                  <FailureNotice failure={formFailure} colors={colors} onJoin={chooseExisting} />
                ) : null}

                <Pressable
                  onPress={() => void handleSendCode()}
                  disabled={
                    submitting ||
                    !email.trim() ||
                    Boolean(emailInvalid) ||
                    (!selected && !newName.trim()) ||
                    nameMismatch?.ok === false
                  }
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.primaryButton,
                    {
                      backgroundColor: colors.primary,
                      opacity:
                        submitting ||
                        !email.trim() ||
                        Boolean(emailInvalid) ||
                        (!selected && !newName.trim()) ||
                        nameMismatch?.ok === false
                          ? 0.5
                          : pressed
                            ? 0.85
                            : 1,
                    },
                  ]}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color={colors.primaryForeground} />
                  ) : null}
                  <Text style={[styles.primaryButtonLabel, { color: colors.primaryForeground }]}>
                    Send verification code
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {/* ── 3. The code ── */}
            {step === 'verify' && pending ? (
              <View>
                <Text style={[styles.verifyLead, { color: colors.mutedForeground }]}>
                  We emailed a 6-digit code to{' '}
                  <Text style={[styles.verifyStrong, { color: colors.foreground }]}>
                    {pending.maskedEmail}
                  </Text>
                  . Enter it to verify{' '}
                  <Text style={[styles.verifyStrong, { color: colors.foreground }]}>
                    {pending.domain}
                  </Text>
                  .
                </Text>

                <View style={[styles.companyCard, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}>
                  <CompanyMark name={pending.companyName} logoUrl={null} size={34} />
                  <View style={styles.companyCardText}>
                    <Text style={[styles.hitName, { color: colors.foreground }]} numberOfLines={1}>
                      {pending.companyName}
                    </Text>
                    <Text style={[styles.hitMeta, { color: colors.mutedForeground }]}>
                      {pending.domain}
                    </Text>
                  </View>
                  <View style={[styles.pendingChip, { borderColor: colors.border }]}>
                    <Text style={[styles.pendingChipText, { color: colors.mutedForeground }]}>
                      PENDING
                    </Text>
                  </View>
                </View>

                <Text style={[styles.fieldLabel, { color: colors.mutedForeground, marginTop: 22 }]}>
                  VERIFICATION CODE
                </Text>
                <TextInput
                  ref={codeRef}
                  value={code}
                  onChangeText={handleCodeChange}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  placeholderTextColor={colors.mutedForeground}
                  editable={!verifying}
                  maxLength={6}
                  style={[
                    styles.input,
                    styles.codeInput,
                    {
                      color: colors.foreground,
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                    },
                  ]}
                />

                {verifying ? (
                  <View style={styles.verifyingRow}>
                    <ActivityIndicator size="small" color={colors.mutedForeground} />
                    <Text style={[styles.emailHint, { color: colors.mutedForeground }]}>
                      Verifying…
                    </Text>
                  </View>
                ) : null}
                {codeError && !verifying ? (
                  <Text style={[styles.emailHint, styles.codeError, { color: colors.destructive }]}>
                    {codeError}
                  </Text>
                ) : null}
                {typeof attemptsLeft === 'number' && attemptsLeft < 5 && !codeError ? (
                  <Text style={[styles.emailHint, { color: colors.foregroundSubtle }]}>
                    {attemptsLeft} {attemptsLeft === 1 ? 'try' : 'tries'} left before the code is burned.
                  </Text>
                ) : null}

                <View style={styles.verifyActions}>
                  <Pressable
                    onPress={() => void handleResend()}
                    disabled={submitting}
                    accessibilityRole="button"
                    style={{ opacity: submitting ? 0.5 : 1 }}
                  >
                    <Text style={[styles.noticeAction, { color: colors.accent }]}>
                      {submitting ? 'Sending…' : 'Resend code'}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => setStep('email')} accessibilityRole="button">
                    <Text style={[styles.backLinkText, { color: colors.mutedForeground }]}>
                      Use a different email
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {/* ── 4. Done ── */}
            {step === 'done' && verified ? (
              <View>
                <View style={[styles.doneCard, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}>
                  <View style={[styles.doneCheck, { backgroundColor: colors.accent + '1A' }]}>
                    <Feather name="check" size={16} color={colors.accent} />
                  </View>
                  <View style={styles.companyCardText}>
                    <Text style={[styles.hitName, { color: colors.foreground }]} numberOfLines={1}>
                      {verified.name}
                    </Text>
                    {verified.domain ? (
                      <View style={styles.hitMetaRow}>
                        <Text style={[styles.hitMeta, { color: colors.mutedForeground }]}>
                          {verified.domain}
                        </Text>
                        {verified.domainVerified ? (
                          <CompanyVerifiedMark size={11} color={colors.accent} />
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                </View>

                <Text style={[styles.doneExplainer, { color: colors.foregroundSubtle }]}>
                  We verified your work email on that domain. It shows you control a mailbox there —
                  not that you speak for the company.
                </Text>

                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.primaryButton,
                    { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
                  ]}
                >
                  <Text style={[styles.primaryButtonLabel, { color: colors.primaryForeground }]}>
                    Done
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontFamily: 'Geist_600SemiBold' },
  body: { padding: 20 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: 'Geist_400Regular', paddingVertical: 11 },
  hits: { marginTop: 14, gap: 4 },
  hitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  hitText: { flex: 1, minWidth: 0 },
  hitName: { fontSize: 14, fontFamily: 'Geist_500Medium' },
  hitMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  hitMeta: { fontSize: 12, fontFamily: 'Geist_400Regular' },
  hitCount: { fontSize: 11, fontFamily: 'Geist_400Regular' },
  hitsEmpty: { paddingVertical: 12, paddingHorizontal: 4, fontSize: 12.5, fontFamily: 'Geist_400Regular' },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  createIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createText: { flex: 1, minWidth: 0 },
  backLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  backLinkText: { fontSize: 12.5, fontFamily: 'Geist_500Medium' },
  companyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  companyCardText: { flex: 1, minWidth: 0 },
  field: { marginTop: 18 },
  fieldLabel: {
    fontSize: 10,
    fontFamily: 'Geist_600SemiBold',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 14.5,
    fontFamily: 'Geist_400Regular',
  },
  codeInput: {
    textAlign: 'center',
    fontSize: 19,
    letterSpacing: 8,
    fontFamily: 'Geist_500Medium',
  },
  emailHint: { fontSize: 12, fontFamily: 'Geist_400Regular', lineHeight: 17, marginTop: 8 },
  codeError: { marginTop: 8 },
  noticeBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 11,
    marginTop: 14,
  },
  noticeText: { fontSize: 12, fontFamily: 'Geist_400Regular', lineHeight: 18 },
  noticeAction: { fontSize: 12.5, fontFamily: 'Geist_500Medium', marginTop: 8 },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 8,
    paddingVertical: 13,
    marginTop: 22,
  },
  primaryButtonLabel: { fontSize: 14.5, fontFamily: 'Geist_600SemiBold' },
  verifyLead: { fontSize: 14, fontFamily: 'Geist_400Regular', lineHeight: 21, marginBottom: 16 },
  verifyStrong: { fontFamily: 'Geist_500Medium' },
  pendingChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pendingChipText: { fontSize: 10, fontFamily: 'Geist_600SemiBold', letterSpacing: 0.6 },
  verifyingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  verifyActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 22,
  },
  doneCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  doneCheck: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneExplainer: { fontSize: 12, fontFamily: 'Geist_400Regular', lineHeight: 18, marginTop: 16 },
});
