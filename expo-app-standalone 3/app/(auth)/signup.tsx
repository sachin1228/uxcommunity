import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { BrandLogo } from '@/components/BrandLogo';
import {
  OptionPickerSheet,
  OptionPickerValue,
  type PickerOption,
} from '@/components/settings/OptionPickerSheet';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { hapticError, hapticSuccess } from '@/lib/haptics';
import { prepareImageForUpload, type PreparedImage } from '@/lib/prepareImage';
import {
  buildSignupIdentity,
  buildSignupPayload,
  firstMissingProfileField,
  signupErrorMessage,
  validateSignupIdentity,
  type SignupIdentityErrors,
  type SignupIdentityInput,
  type SignupSelection,
} from '@/lib/signupFlow';
import {
  completeSignup,
  loadSignupOptions,
  validateSignupIdentity as requestSignupValidation,
  type SignupOptions,
} from '@/lib/signup';

type Step = 1 | 2 | 3;
type PickerKind = 'city' | 'sector' | 'jobTitle' | 'experienceLevel';

const STEP_LABELS = ['Account', 'Profile', 'Picture'] as const;

const PICKER_COPY: Record<PickerKind, { title: string; placeholder: string }> = {
  city: { title: 'Select a city', placeholder: 'Select a city' },
  sector: { title: 'Select a sector', placeholder: 'Select an industry sector' },
  jobTitle: { title: 'Select a job title', placeholder: 'Select your job title' },
  experienceLevel: { title: 'Select your level', placeholder: 'Select your experience level' },
};

const EMPTY_IDENTITY: SignupIdentityInput = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  confirmPassword: '',
};

const EMPTY_SELECTION: SignupSelection = {
  cityId: '',
  sectorId: '',
  jobTitle: '',
  experienceLevel: '',
};

/**
 * Mobile port of the web signup wizard (`apps/web/app/signup/page.tsx`).
 *
 * Step 1 validates the identity with `/api/signup/direct` (no account yet),
 * step 2 collects the profile with the same master-data endpoints the web form
 * reads, and step 3 creates the account via `/api/signup/avatar` — which also
 * establishes the session cookie, so `refresh()` picks the member up and the
 * auth layout moves them into the app.
 */
export default function SignupScreen() {
  const colors = useColors();
  const router = useRouter();
  const { refresh } = useAuth();
  const styles = makeStyles(colors);

  const [step, setStep] = useState<Step>(1);
  const [identity, setIdentity] = useState<SignupIdentityInput>(EMPTY_IDENTITY);
  const [selection, setSelection] = useState<SignupSelection>(EMPTY_SELECTION);
  const [fieldErrors, setFieldErrors] = useState<SignupIdentityErrors>({});
  const [stepError, setStepError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [options, setOptions] = useState<SignupOptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const optionsRequested = useRef(false);

  const [picker, setPicker] = useState<PickerKind | null>(null);
  const [avatar, setAvatar] = useState<PreparedImage | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const patchIdentity = useCallback((patch: Partial<SignupIdentityInput>) => {
    setIdentity((previous) => ({ ...previous, ...patch }));
    setStepError(null);
  }, []);

  const patchSelection = useCallback((patch: Partial<SignupSelection>) => {
    setSelection((previous) => ({ ...previous, ...patch }));
    setStepError(null);
  }, []);

  // ── Step 2 master data ───────────────────────────────────────────────────
  const requestOptions = useCallback(async () => {
    if (optionsRequested.current) return;
    optionsRequested.current = true;
    setOptionsLoading(true);
    setOptionsError(null);
    try {
      setOptions(await loadSignupOptions());
    } catch (error) {
      optionsRequested.current = false;
      setOptionsError(signupErrorMessage(error, 'Could not load signup options. Please try again.'));
    } finally {
      setOptionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (step === 2) void requestOptions();
  }, [step, requestOptions]);

  // ── Step 1 ───────────────────────────────────────────────────────────────
  const submitIdentity = useCallback(async () => {
    if (loading) return;
    const errors = validateSignupIdentity(identity);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      hapticError();
      return;
    }

    Keyboard.dismiss();
    setLoading(true);
    setStepError(null);
    try {
      await requestSignupValidation(buildSignupIdentity(identity));
      hapticSuccess();
      setStep(2);
    } catch (error) {
      hapticError();
      setStepError(signupErrorMessage(error, 'Failed to create account. Please try again.'));
    } finally {
      setLoading(false);
    }
  }, [identity, loading]);

  // ── Step 2 ───────────────────────────────────────────────────────────────
  const submitProfile = useCallback(() => {
    const missing = firstMissingProfileField(selection);
    if (missing) {
      hapticError();
      setStepError(missing.message);
      return;
    }
    Keyboard.dismiss();
    setStepError(null);
    hapticSuccess();
    setStep(3);
  }, [selection]);

  // ── Step 3 ───────────────────────────────────────────────────────────────
  const pickAvatar = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setAvatarError('Allow photo access to choose a profile picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      // prepareImageForUpload applies the final quality-0.90 WebP encode.
      quality: 1,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setAvatarError(null);
    try {
      setAvatar(await prepareImageForUpload(asset, `profile-picture-${Date.now()}`));
    } catch {
      // Keep the original picked image as a last-resort fallback, like the
      // profile editor does.
      setAvatar({
        uri: asset.uri,
        mimeType: 'image/jpeg',
        name: `profile-picture-${Date.now()}.jpg`,
        width: asset.width,
        height: asset.height,
      });
    }
  }, []);

  const finishSignup = useCallback(
    async (withAvatar: boolean) => {
      if (loading) return;
      Keyboard.dismiss();
      setLoading(true);
      setStepError(null);
      try {
        const chosenAvatar = withAvatar ? avatar : null;
        const payload = buildSignupPayload(identity, selection, {
          hasAvatar: Boolean(chosenAvatar),
        });
        await completeSignup(payload, chosenAvatar);
        hapticSuccess();
        // The response set the session cookie; refresh() loads the member and
        // the (auth) layout redirects into the app.
        await refresh().catch(() => {});
        router.replace('/(tabs)/communities');
      } catch (error) {
        hapticError();
        setStepError(signupErrorMessage(error, 'Failed to complete signup. Please try again.'));
      } finally {
        setLoading(false);
      }
    },
    [avatar, identity, loading, refresh, router, selection],
  );

  const goBack = useCallback(() => {
    if (loading) return;
    setStepError(null);
    setStep((current) => (current === 3 ? 2 : 1));
  }, [loading]);

  const goToLogin = useCallback(() => {
    if (loading) return;
    router.replace('/(auth)/login');
  }, [loading, router]);

  // ── Picker plumbing ──────────────────────────────────────────────────────
  const pickerOptions: PickerOption[] = picker && options ? options[pickerOptionsKey(picker)] : [];
  const pickerSelectedId = picker ? selection[pickerSelectionKey(picker)] : null;

  function handlePick(option: PickerOption) {
    if (!picker) return;
    patchSelection({ [pickerSelectionKey(picker)]: option.id });
    setPicker(null);
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View style={styles.logoMark}>
              <BrandLogo size={44} />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>Create your account</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Step {step} of 3 · {STEP_LABELS[step - 1]}
            </Text>
          </View>

          <View style={styles.stepper}>
            {STEP_LABELS.map((label, index) => {
              const number = index + 1;
              const active = number <= step;
              return (
                <View key={label} style={styles.stepItem}>
                  <View
                    style={[
                      styles.stepBar,
                      { backgroundColor: active ? colors.primary : colors.border },
                    ]}
                  />
                  <Text
                    style={[
                      styles.stepLabel,
                      {
                        color: number === step ? colors.foreground : colors.mutedForeground,
                        fontFamily: number === step ? 'Geist_600SemiBold' : 'Geist_400Regular',
                      },
                    ]}
                  >
                    {label}
                  </Text>
                </View>
              );
            })}
          </View>

          <View
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            {step > 1 ? (
              <Pressable
                onPress={goBack}
                disabled={loading}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Go back"
                style={styles.backRow}
              >
                <Feather name="chevron-left" size={16} color={colors.mutedForeground} />
                <Text style={[styles.backLabel, { color: colors.mutedForeground }]}>Back</Text>
              </Pressable>
            ) : null}

            {stepError ? (
              <View
                style={[
                  styles.errorBanner,
                  {
                    backgroundColor: colors.destructive + '18',
                    borderColor: colors.destructive + '44',
                  },
                ]}
              >
                <Text style={[styles.errorText, { color: colors.destructive }]}>{stepError}</Text>
              </View>
            ) : null}

            {step === 1 ? (
              <>
                <Field label="Name" required error={fieldErrors.firstName} colors={colors}>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        color: colors.foreground,
                      },
                    ]}
                    placeholder="Enter your name"
                    placeholderTextColor={colors.mutedForeground}
                    value={identity.firstName}
                    onChangeText={(value) => {
                      patchIdentity({ firstName: value });
                      if (fieldErrors.firstName) {
                        setFieldErrors((previous) => ({ ...previous, firstName: undefined }));
                      }
                    }}
                    autoComplete="given-name"
                    textContentType="givenName"
                    returnKeyType="next"
                    editable={!loading}
                  />
                </Field>

                <Field label="Surname" required error={fieldErrors.lastName} colors={colors}>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        color: colors.foreground,
                      },
                    ]}
                    placeholder="Enter your surname"
                    placeholderTextColor={colors.mutedForeground}
                    value={identity.lastName}
                    onChangeText={(value) => {
                      patchIdentity({ lastName: value });
                      if (fieldErrors.lastName) {
                        setFieldErrors((previous) => ({ ...previous, lastName: undefined }));
                      }
                    }}
                    autoComplete="family-name"
                    textContentType="familyName"
                    returnKeyType="next"
                    editable={!loading}
                  />
                </Field>

                <Field label="Email" required error={fieldErrors.email} colors={colors}>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        color: colors.foreground,
                      },
                    ]}
                    placeholder="you@gmail.com"
                    placeholderTextColor={colors.mutedForeground}
                    value={identity.email}
                    onChangeText={(value) => {
                      patchIdentity({ email: value });
                      if (fieldErrors.email) {
                        setFieldErrors((previous) => ({ ...previous, email: undefined }));
                      }
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    autoComplete="email"
                    returnKeyType="next"
                    editable={!loading}
                  />
                </Field>

                <Field label="Password" required error={fieldErrors.password} colors={colors}>
                  <PasswordInput
                    value={identity.password}
                    onChangeText={(value) => {
                      patchIdentity({ password: value });
                      if (fieldErrors.password) {
                        setFieldErrors((previous) => ({ ...previous, password: undefined }));
                      }
                    }}
                    placeholder="Min 8 chars, 1 number"
                    visible={showPassword}
                    onToggle={() => setShowPassword((value) => !value)}
                    editable={!loading}
                    colors={colors}
                    autoComplete="new-password"
                    textContentType="newPassword"
                  />
                </Field>

                <Field
                  label="Confirm password"
                  required
                  error={fieldErrors.confirmPassword}
                  colors={colors}
                >
                  <PasswordInput
                    value={identity.confirmPassword}
                    onChangeText={(value) => {
                      patchIdentity({ confirmPassword: value });
                      if (fieldErrors.confirmPassword) {
                        setFieldErrors((previous) => ({
                          ...previous,
                          confirmPassword: undefined,
                        }));
                      }
                    }}
                    placeholder="••••••••"
                    visible={showConfirmPassword}
                    onToggle={() => setShowConfirmPassword((value) => !value)}
                    editable={!loading}
                    colors={colors}
                    autoComplete="new-password"
                    textContentType="newPassword"
                    onSubmitEditing={submitIdentity}
                  />
                </Field>

                <PrimaryButton
                  label="Continue"
                  loading={loading}
                  onPress={submitIdentity}
                  colors={colors}
                  styles={styles}
                />
              </>
            ) : null}

            {step === 2 ? (
              <>
                {optionsLoading ? (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator color={colors.primary} />
                    <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
                      Loading options…
                    </Text>
                  </View>
                ) : null}

                {optionsError && !optionsLoading ? (
                  <Pressable
                    onPress={() => void requestOptions()}
                    style={[
                      styles.errorBanner,
                      {
                        backgroundColor: colors.destructive + '18',
                        borderColor: colors.destructive + '44',
                      },
                    ]}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.errorText, { color: colors.destructive }]}>
                      {optionsError} Tap to retry.
                    </Text>
                  </Pressable>
                ) : null}

                {options
                  ? (
                      [
                        ['city', 'City', selection.cityId],
                        ['sector', 'Industry sector', selection.sectorId],
                        ['jobTitle', 'Job title', selection.jobTitle],
                        ['experienceLevel', 'Experience level', selection.experienceLevel],
                      ] as Array<[PickerKind, string, string]>
                    ).map(([kind, label, value]) => {
                      const option = options[pickerOptionsKey(kind)].find(
                        (entry) => entry.id === value,
                      );
                      return (
                        <Field key={kind} label={label} required colors={colors}>
                          <Pressable
                            onPress={() => setPicker(kind)}
                            disabled={loading}
                            accessibilityRole="button"
                            accessibilityLabel={`${label}: ${option?.name ?? 'not selected'}`}
                            style={({ pressed }) => [
                              styles.selectRow,
                              {
                                backgroundColor: colors.surface,
                                borderColor: pressed ? colors.primary : colors.border,
                              },
                            ]}
                          >
                            <OptionPickerValue
                              option={option ?? null}
                              placeholder={PICKER_COPY[kind].placeholder}
                              textStyle={styles.selectValue}
                            />
                          </Pressable>
                        </Field>
                      );
                    })
                  : null}

                <PrimaryButton
                  label="Continue"
                  loading={loading}
                  disabled={!options}
                  onPress={submitProfile}
                  colors={colors}
                  styles={styles}
                />
              </>
            ) : null}

            {step === 3 ? (
              <>
                <View style={styles.pictureHeader}>
                  <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                    Add a profile picture
                  </Text>
                  <Pressable
                    onPress={() => void finishSignup(false)}
                    disabled={loading}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Skip profile picture"
                  >
                    <Text style={[styles.skipLabel, { color: colors.mutedForeground }]}>Skip</Text>
                  </Pressable>
                </View>

                {avatarError ? (
                  <Text style={[styles.fieldError, { color: colors.destructive }]}>
                    {avatarError}
                  </Text>
                ) : null}

                {avatar ? (
                  <View style={[styles.pictureCard, { borderColor: colors.border }]}>
                    <Image source={{ uri: avatar.uri }} style={styles.picturePreview} />
                    <View style={styles.pictureMeta}>
                      <Text style={[styles.pictureTitle, { color: colors.foreground }]}>
                        Profile picture ready
                      </Text>
                      <Text style={[styles.pictureHint, { color: colors.mutedForeground }]}>
                        JPEG, PNG or WebP
                      </Text>
                      <Pressable
                        onPress={() => setAvatar(null)}
                        disabled={loading}
                        hitSlop={6}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.removeLabel, { color: colors.mutedForeground }]}>
                          Remove picture
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => void pickAvatar()}
                    disabled={loading}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.uploadBox,
                      { borderColor: pressed ? colors.primary : colors.border },
                    ]}
                  >
                    <Feather name="upload" size={22} color={colors.mutedForeground} />
                    <Text style={[styles.uploadTitle, { color: colors.foreground }]}>
                      Upload a profile picture
                    </Text>
                    <Text style={[styles.pictureHint, { color: colors.mutedForeground }]}>
                      JPEG, PNG or WebP
                    </Text>
                  </Pressable>
                )}

                <PrimaryButton
                  label="Continue"
                  loading={loading}
                  disabled={!avatar}
                  onPress={() => void finishSignup(true)}
                  colors={colors}
                  styles={styles}
                />

                {!avatar ? (
                  <Text style={[styles.pictureFootnote, { color: colors.mutedForeground }]}>
                    Select a picture to continue — or use Skip to finish without one.
                  </Text>
                ) : null}
              </>
            ) : null}
          </View>

          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
              Already have an account?
            </Text>
            <Pressable onPress={goToLogin} disabled={loading} hitSlop={6} accessibilityRole="button">
              <Text style={[styles.footerLink, { color: colors.primary }]}>Sign in</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <OptionPickerSheet
        visible={picker !== null}
        title={picker ? PICKER_COPY[picker].title : ''}
        options={pickerOptions}
        selectedId={pickerSelectedId}
        onPick={handlePick}
        onClose={() => setPicker(null)}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

type Colors = ReturnType<typeof useColors>;
type Styles = ReturnType<typeof makeStyles>;

function Field({
  label,
  required,
  error,
  colors,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  colors: Colors;
  children: React.ReactNode;
}) {
  return (
    <View style={fieldStyles.field}>
      <Text style={[fieldStyles.label, { color: colors.foreground }]}>
        {label}
        {required ? <Text style={{ color: colors.destructive }}> *</Text> : null}
      </Text>
      {children}
      {error ? <Text style={[fieldStyles.error, { color: colors.destructive }]}>{error}</Text> : null}
    </View>
  );
}

function PasswordInput({
  value,
  onChangeText,
  placeholder,
  visible,
  onToggle,
  editable,
  colors,
  autoComplete,
  textContentType,
  onSubmitEditing,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  visible: boolean;
  onToggle: () => void;
  editable: boolean;
  colors: Colors;
  autoComplete: 'new-password';
  textContentType: 'newPassword';
  onSubmitEditing?: () => void;
}) {
  return (
    <View style={[fieldStyles.passwordRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <TextInput
        style={[fieldStyles.passwordInput, { color: colors.foreground }]}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={autoComplete}
        textContentType={textContentType}
        returnKeyType={onSubmitEditing ? 'done' : 'next'}
        onSubmitEditing={onSubmitEditing}
        editable={editable}
      />
      <Pressable onPress={onToggle} hitSlop={8} style={fieldStyles.eyeBtn} accessibilityRole="button">
        <Text style={[fieldStyles.eyeText, { color: colors.mutedForeground }]}>
          {visible ? 'Hide' : 'Show'}
        </Text>
      </Pressable>
    </View>
  );
}

function PrimaryButton({
  label,
  loading,
  disabled,
  onPress,
  colors,
  styles,
}: {
  label: string;
  loading: boolean;
  disabled?: boolean;
  onPress: () => void;
  colors: Colors;
  styles: Styles;
}) {
  const inactive = loading || disabled;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: pressed ? colors.primaryHover : colors.primary,
          opacity: inactive ? 0.55 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.primaryForeground} size="small" />
      ) : (
        <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>{label}</Text>
      )}
    </Pressable>
  );
}

function pickerOptionsKey(kind: PickerKind): keyof SignupOptions {
  switch (kind) {
    case 'city':
      return 'cities';
    case 'sector':
      return 'sectors';
    case 'jobTitle':
      return 'jobTitles';
    case 'experienceLevel':
      return 'experienceLevels';
  }
}

function pickerSelectionKey(kind: PickerKind): keyof SignupSelection {
  switch (kind) {
    case 'city':
      return 'cityId';
    case 'sector':
      return 'sectorId';
    case 'jobTitle':
      return 'jobTitle';
    case 'experienceLevel':
      return 'experienceLevel';
  }
}

const fieldStyles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontSize: 13, fontFamily: 'Geist_500Medium' },
  error: { fontSize: 12, fontFamily: 'Geist_400Regular' },
  passwordRow: {
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    paddingRight: 10,
  },
  passwordInput: { flex: 1, fontSize: 15, fontFamily: 'Geist_400Regular' },
  eyeBtn: { paddingHorizontal: 4 },
  eyeText: { fontSize: 13, fontFamily: 'Geist_500Medium' },
});

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1 },
    flex: { flex: 1 },
    scrollContent: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: 20,
      paddingVertical: 40,
    },
    header: { alignItems: 'center', marginBottom: 20 },
    logoMark: { marginBottom: 16 },
    title: {
      fontSize: 24,
      fontFamily: 'Geist_700Bold',
      letterSpacing: -0.5,
      marginBottom: 6,
      textAlign: 'center',
    },
    subtitle: { fontSize: 14, fontFamily: 'Geist_400Regular', textAlign: 'center' },
    stepper: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 16,
      paddingHorizontal: 4,
    },
    stepItem: { flex: 1, gap: 6 },
    stepBar: { height: 3, borderRadius: 2 },
    stepLabel: { fontSize: 11 },
    card: {
      borderRadius: 16,
      borderWidth: 1,
      padding: 22,
      gap: 16,
      shadowColor: colors.foreground,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 8,
      elevation: 3,
    },
    backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: -4 },
    backLabel: { fontSize: 13, fontFamily: 'Geist_500Medium' },
    errorBanner: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
    errorText: { fontSize: 13, fontFamily: 'Geist_400Regular', lineHeight: 18 },
    input: {
      height: 44,
      borderRadius: 8,
      borderWidth: 1,
      paddingHorizontal: 14,
      fontSize: 15,
      fontFamily: 'Geist_400Regular',
    },
    selectRow: {
      height: 44,
      borderRadius: 8,
      borderWidth: 1,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    selectValue: { flex: 1, fontSize: 15, fontFamily: 'Geist_400Regular' },
    loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    loadingText: { fontSize: 13, fontFamily: 'Geist_400Regular' },
    sectionTitle: { fontSize: 17, fontFamily: 'Geist_600SemiBold' },
    pictureHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    skipLabel: { fontSize: 14, fontFamily: 'Geist_500Medium' },
    pictureCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      borderRadius: 12,
      borderWidth: 1,
      padding: 14,
    },
    picturePreview: { width: 72, height: 72, borderRadius: 36 },
    pictureMeta: { flex: 1, gap: 3 },
    pictureTitle: { fontSize: 14, fontFamily: 'Geist_500Medium' },
    pictureHint: { fontSize: 12, fontFamily: 'Geist_400Regular' },
    removeLabel: { fontSize: 12, fontFamily: 'Geist_400Regular', marginTop: 3 },
    uploadBox: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: 12,
      borderWidth: 2,
      borderStyle: 'dashed',
      paddingVertical: 32,
    },
    uploadTitle: { fontSize: 14, fontFamily: 'Geist_500Medium' },
    pictureFootnote: { fontSize: 12, fontFamily: 'Geist_400Regular', textAlign: 'center' },
    fieldError: { fontSize: 12, fontFamily: 'Geist_400Regular' },
    button: { height: 46, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    buttonText: { fontSize: 15, fontFamily: 'Geist_600SemiBold' },
    footer: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 4,
      marginTop: 20,
    },
    footerText: { fontSize: 13, fontFamily: 'Geist_400Regular' },
    footerLink: { fontSize: 13, fontFamily: 'Geist_600SemiBold' },
  });
}
