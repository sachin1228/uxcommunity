import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Clipboard,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useColors } from '@/hooks/useColors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { CommunityTabIcon } from '@/components/community/TabIcons';
import { hapticSelection } from '@/lib/haptics';
import { prepareImageForUpload } from '@/lib/prepareImage';
import { communityStore } from '@/lib/communityStore';
import { createCommunity, type CreatedCommunity } from '@/lib/communities';
import type { CommunityTab } from '@/lib/communityContent';
import { communityDpShadow } from '@/constants/designSystem';

/**
 * Create a community — the mobile port of the web CreateCommunityModal, as a
 * full screen (a wizard is a lot of form for a phone to hold in a sheet).
 *
 * Same three steps and the same copy as the web modal: name + privacy, then
 * the areas members will see (chat always included), then picture,
 * description and starter rules. The same multipart POST /api/communities
 * backs both — creation caps come back as the server's own message. The
 * success step offers the invite link and opens the new community.
 */

type Privacy = 'public' | 'private';

interface AreaOption {
  id: CommunityTab;
  label: string;
  description: string;
  required?: boolean;
}

const AREA_OPTIONS: AreaOption[] = [
  { id: 'chat', label: 'Chat', description: 'Real-time member conversations', required: true },
  { id: 'threads', label: 'Threads', description: 'Topic-led discussions' },
  { id: 'showcase', label: 'Showcase', description: 'Share work and collect feedback' },
  { id: 'events', label: 'Events', description: 'Meetups and online sessions' },
  { id: 'resources', label: 'Resources', description: 'Links, files, and references' },
];

const DEFAULT_RULES = [
  'Be respectful and kind to all members.',
  'Keep discussions relevant to this community.',
  'No spam or unsolicited promotion.',
];

const MAX_RULES = 8;
const RULE_MAX_CHARS = 160;

function StepDots({ step, colors }: { step: number; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.stepDots} accessibilityLabel={`Step ${step} of 3`}>
      {[1, 2, 3].map((item) => (
        <View
          key={item}
          style={[
            styles.stepDot,
            {
              width: item <= step ? 20 : 6,
              backgroundColor: item <= step ? colors.accent : colors.border,
            },
          ]}
        />
      ))}
    </View>
  );
}

export default function CreateCommunityScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [privacy, setPrivacy] = useState<Privacy>('public');
  const [areas, setAreas] = useState<CommunityTab[]>(AREA_OPTIONS.map((option) => option.id));
  const [description, setDescription] = useState('');
  const [rules, setRules] = useState<string[]>([...DEFAULT_RULES]);
  const [image, setImage] = useState<{ uri: string; name: string; type: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedCommunity | null>(null);
  const [copied, setCopied] = useState(false);

  const canContinue = useMemo(() => {
    const trimmed = name.trim();
    return trimmed.length > 0 && trimmed.length <= 80;
  }, [name]);

  const toggleArea = useCallback((id: CommunityTab) => {
    if (id === 'chat') return;
    hapticSelection();
    setAreas((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }, []);

  const updateRule = useCallback((index: number, value: string) => {
    setRules((prev) => prev.map((rule, i) => (i === index ? value : rule)));
  }, []);

  const pickImage = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      // No intermediate loss — prepareImageForUpload applies the final WebP
      // quality-0.90 encode, the same contract every other mobile upload uses.
      quality: 1,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    try {
      const prepared = await prepareImageForUpload(asset, `community-${Date.now()}`);
      setImage({ uri: prepared.uri, name: prepared.name, type: prepared.mimeType });
    } catch {
      // Keep the original picked image as a last-resort fallback.
      setImage({
        uri: asset.uri,
        name: `community-${Date.now()}.jpg`,
        type: asset.mimeType ?? 'image/jpeg',
      });
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!canContinue || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const community = await createCommunity({
        name: name.trim(),
        isPrivate: privacy === 'private',
        description: description.trim(),
        // Showcase rides its own flag; enabled_tabs carries the tabbed areas.
        tabs: areas.filter((area) => area !== 'showcase'),
        showcase: areas.includes('showcase'),
        rules: rules.map((rule) => rule.trim()).filter(Boolean),
        image,
      });
      setCreated(community);
      // The list is stale the moment this lands — tell it now, whether or not
      // the member opens the new community; the row is there when they return.
      communityStore.notifyCommunityChanged({ kind: 'refresh' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create community.');
    } finally {
      setSubmitting(false);
    }
  }, [canContinue, submitting, name, privacy, description, areas, rules, image]);

  const copyInvite = useCallback(() => {
    if (!created) return;
    hapticSelection();
    Clipboard.setString(created.invite_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [created]);

  /** Open the new community, swapping this screen out of the stack. */
  const openCommunity = useCallback(() => {
    if (!created) return;
    const imageParam = created.image_url
      ? `&image=${encodeURIComponent(created.image_url)}`
      : '';
    const tabsParam = `&tabs=${encodeURIComponent(created.enabled_tabs.join(','))}`;
    const showcaseParam = `&showcase=${areas.includes('showcase') ? '1' : '0'}`;
    const membersParam = `&members=${created.member_count ?? ''}`;
    const typeParam = `&type=${encodeURIComponent(created.type)}`;
    const privateParam = `&private=${created.is_private ? '1' : '0'}`;
    router.replace(
      `/community/${created.id}?name=${encodeURIComponent(created.name)}${imageParam}${tabsParam}${showcaseParam}${membersParam}${typeParam}${privateParam}`
    );
  }, [created, areas, router]);

  const goBack = useCallback(() => {
    if (submitting) return;
    if (step > 1 && !created) {
      setStep((prev) => prev - 1);
      return;
    }
    router.back();
  }, [submitting, step, created, router]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />

      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
            paddingTop: insets.top + 8,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={step > 1 && !created ? 'Back' : 'Close'}
          hitSlop={10}
          onPress={goBack}
          style={styles.backButton}
        >
          <Feather
            name={step > 1 && !created ? 'arrow-left' : 'x'}
            size={22}
            color={colors.foreground}
          />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>Create Community</Text>
      </View>

      {created ? (
        /* ── Success — the web modal's final step, same copy ── */
        <View style={[styles.successWrap, { paddingBottom: insets.bottom + 24 }]}>
          <View style={[styles.successIcon, { backgroundColor: colors.accentSoft }]}>
            <Feather name="check" size={26} strokeWidth={2.5} color={colors.accent} />
          </View>
          <Text style={[styles.successTitle, { color: colors.foreground }]}>
            {created.is_private ? 'Invite your first members' : 'Your community is live'}
          </Text>
          <Text style={[styles.successBody, { color: colors.mutedForeground }]}>
            {created.is_private
              ? 'Members can request access through this private invite link.'
              : 'Members can discover and join your new public community.'}
          </Text>

          <View
            style={[
              styles.inviteRow,
              { borderColor: colors.border, backgroundColor: colors.surfaceRaised },
            ]}
          >
            <Text
              style={[styles.inviteUrl, { color: colors.mutedForeground }]}
              numberOfLines={1}
            >
              {created.invite_url}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy invite link"
              onPress={copyInvite}
              style={({ pressed }) => [
                styles.copyButton,
                { backgroundColor: pressed ? colors.accentHover : colors.accent },
              ]}
            >
              <Text style={[styles.copyButtonText, { color: colors.accentForeground }]}>
                {copied ? 'Copied' : 'Copy'}
              </Text>
            </Pressable>          </View>

          <Pressable
            accessibilityRole="button"
            onPress={openCommunity}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: pressed ? colors.accentHover : colors.accent },
            ]}
          >
            <Text style={[styles.primaryButtonText, { color: colors.accentForeground }]}>
              Open Community
            </Text>
          </Pressable>
        </View>
      ) : (
        <>
          <KeyboardAwareScrollViewCompat
            style={styles.flex}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <StepDots step={step} colors={colors} />

            {step === 1 && (
              <View style={styles.stepBody}>
                <View>
                  <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
                    Community Name <Text style={{ color: colors.accent }}>*</Text>
                  </Text>
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    maxLength={80}
                    placeholder="e.g. Design Systems"
                    placeholderTextColor={colors.mutedForeground}
                    accessibilityLabel="Community name"
                    style={[
                      styles.field,
                      { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border },
                    ]}
                  />
                </View>

                <View style={styles.privacyCards}>
                  <PrivacyCard
                    colors={colors}
                    icon="globe"
                    label="Public"
                    copy="Anyone can discover and join"
                    active={privacy === 'public'}
                    onPress={() => setPrivacy('public')}
                  />
                  <PrivacyCard
                    colors={colors}
                    icon="lock"
                    label="Private"
                    copy="Invite-only and owner managed"
                    active={privacy === 'private'}
                    onPress={() => setPrivacy('private')}
                  />
                </View>
              </View>
            )}

            {step === 2 && (
              <View style={styles.stepBody}>
                <Text style={[styles.stepHint, { color: colors.mutedForeground }]}>
                  Choose the areas members will see. Chat is always included.
                </Text>
                {AREA_OPTIONS.map((option) => {
                  const active = areas.includes(option.id);
                  const disabled = !!option.required;
                  return (
                    <Pressable
                      key={option.id}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: active, disabled }}
                      onPress={() => toggleArea(option.id)}
                      style={[
                        styles.areaCard,
                        {
                          borderColor: active ? colors.accent : colors.border,
                          backgroundColor: active ? colors.accentSoft : colors.surfaceRaised,
                        },
                      ]}
                    >
                      <View style={styles.areaHeader}>
                        <CommunityTabIcon
                          tab={option.id}
                          size={16}
                          color={active ? colors.accent : colors.mutedForeground}
                        />
                        <Text style={[styles.areaLabel, { color: colors.foreground }]}>
                          {option.label}
                        </Text>
                        <View style={styles.areaSpacer} />
                        <View
                          style={[
                            styles.areaCheck,
                            {
                              borderColor: active ? colors.accent : colors.border,
                              backgroundColor: active ? colors.accent : 'transparent',
                            },
                          ]}
                        >
                          {active && (
                            <Feather
                              name="check"
                              size={10}
                              strokeWidth={2.5}
                              color={colors.accentForeground}
                            />
                          )}
                        </View>
                      </View>
                      <Text style={[styles.areaCopy, { color: colors.mutedForeground }]}>
                        {option.description}
                      </Text>
                      {option.required && (
                        <View style={[styles.requiredPill, { backgroundColor: colors.subtle }]}>
                          <Text style={[styles.requiredText, { color: colors.mutedForeground }]}>
                            REQUIRED
                          </Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            )}

            {step === 3 && (
              <View style={styles.stepBody}>
                <View style={styles.pictureRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Choose community picture"
                    onPress={() => void pickImage()}
                    style={[
                      styles.pictureButton,
                      { borderColor: colors.border, backgroundColor: colors.surfaceRaised },
                    ]}
                  >
                    {image ? (
                      <Image source={{ uri: image.uri }} style={styles.picturePreview} />
                    ) : (
                      <Feather name="image" size={20} strokeWidth={2.5} color={colors.mutedForeground} />
                    )}
                  </Pressable>
                  <View style={styles.pictureText}>
                    <Text style={[styles.areaLabel, { color: colors.foreground }]}>
                      Community picture
                    </Text>
                    <Text style={[styles.areaCopy, { color: colors.mutedForeground }]}>
                      JPEG, PNG, or WebP under 10 MB.
                    </Text>
                  </View>
                </View>

                <View>
                  <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Description</Text>
                  <TextInput
                    value={description}
                    onChangeText={setDescription}
                    maxLength={500}
                    multiline
                    placeholder="What should members use this community for?"
                    placeholderTextColor={colors.mutedForeground}
                    accessibilityLabel="Community description"
                    style={[
                      styles.field,
                      styles.fieldMultiline,
                      { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border },
                    ]}
                  />
                </View>

                <View>
                  <View style={styles.rulesHeader}>
                    <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
                      Starter rules
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        hapticSelection();
                        setRules((prev) => [...prev, '']);
                      }}
                      disabled={rules.length >= MAX_RULES}
                      hitSlop={8}
                      style={[styles.addRule, rules.length >= MAX_RULES && styles.disabled]}
                    >
                      <Feather name="plus" size={12} strokeWidth={2.5} color={colors.accent} />
                      <Text style={[styles.addRuleText, { color: colors.accent }]}>Add rule</Text>
                    </Pressable>
                  </View>
                  <View style={styles.rulesBody}>
                    {rules.map((rule, index) => (
                      <View key={index} style={styles.ruleRow}>
                        <TextInput
                          value={rule}
                          onChangeText={(value) => updateRule(index, value)}
                          placeholder="Add a community rule"
                          placeholderTextColor={colors.mutedForeground}
                          maxLength={RULE_MAX_CHARS}
                          accessibilityLabel={`Rule ${index + 1}`}
                          style={[
                            styles.field,
                            styles.ruleInput,
                            { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border },
                          ]}
                        />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Remove rule"
                          hitSlop={6}
                          onPress={() => setRules((prev) => prev.filter((_, i) => i !== index))}
                          style={[styles.ruleRemove, { borderColor: colors.border }]}
                        >
                          <Feather name="x" size={14} strokeWidth={2.5} color={colors.mutedForeground} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            )}

            {error ? (
              <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
            ) : null}
          </KeyboardAwareScrollViewCompat>

          <View
            style={[
              styles.footer,
              { borderTopColor: colors.border, paddingBottom: insets.bottom + 12 },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              onPress={goBack}
              disabled={submitting}
              style={({ pressed }) => [
                styles.secondaryButton,
                {
                  borderColor: colors.border,
                  backgroundColor: pressed ? colors.subtle : 'transparent',
                  opacity: submitting ? 0.5 : 1,
                },
              ]}
            >
              <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>
                {step === 1 ? 'Cancel' : 'Back'}
              </Text>
            </Pressable>

            {step < 3 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setStep((prev) => prev + 1)}
                disabled={!canContinue}
                style={({ pressed }) => [
                  styles.primaryButton,
                  styles.footerPrimary,
                  {
                    backgroundColor: pressed ? colors.accentHover : colors.accent,
                    opacity: canContinue ? 1 : 0.5,
                  },
                ]}
              >
                <Text style={[styles.primaryButtonText, { color: colors.accentForeground }]}>
                  Continue
                </Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => void handleSubmit()}
                disabled={!canContinue || submitting}
                style={({ pressed }) => [
                  styles.primaryButton,
                  styles.footerPrimary,
                  {
                    backgroundColor: pressed ? colors.accentHover : colors.accent,
                    opacity: canContinue && !submitting ? 1 : 0.5,
                  },
                ]}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color={colors.accentForeground} />
                ) : (
                  <Text style={[styles.primaryButtonText, { color: colors.accentForeground }]}>
                    Create Community
                  </Text>
                )}
              </Pressable>
            )}
          </View>
        </>
      )}
    </View>
  );
}

function PrivacyCard({
  colors,
  icon,
  label,
  copy,
  active,
  onPress,
}: {
  colors: ReturnType<typeof useColors>;
  icon: 'globe' | 'lock';
  label: string;
  copy: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      onPress={() => {
        hapticSelection();
        onPress();
      }}
      style={[
        styles.privacyCard,
        {
          borderColor: active ? colors.accent : colors.border,
          backgroundColor: active ? colors.accentSoft : colors.surfaceRaised,
        },
      ]}
    >
      <Feather
        name={icon}
        size={18}
        strokeWidth={2.5}
        color={active ? colors.accent : colors.mutedForeground}
      />
      <View style={styles.privacyCardText}>
        <Text style={[styles.areaLabel, { color: colors.foreground }]}>{label}</Text>
        <Text style={[styles.areaCopy, { color: colors.mutedForeground }]}>{copy}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 20, fontFamily: 'Geist_700Bold', letterSpacing: -0.4 },
  content: { padding: 16, paddingBottom: 32 },
  stepDots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 20,
  },
  stepDot: { height: 6, borderRadius: 3 },
  stepBody: { gap: 20 },
  stepHint: { fontSize: 13, fontFamily: 'Geist_400Regular', lineHeight: 18 },
  fieldLabel: { fontSize: 13, fontFamily: 'Geist_500Medium', marginBottom: 8 },
  field: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: 'Geist_400Regular',
  },
  fieldMultiline: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  privacyCards: { gap: 8 },
  privacyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  privacyCardText: { flexShrink: 1, gap: 2 },
  areaCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  areaHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  areaLabel: { fontSize: 14, fontFamily: 'Geist_600SemiBold' },
  areaSpacer: { flex: 1 },
  areaCheck: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  areaCopy: { fontSize: 12, fontFamily: 'Geist_400Regular', marginTop: 4, lineHeight: 17 },
  requiredPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 8,
  },
  requiredText: { fontSize: 9, fontFamily: 'Geist_600SemiBold', letterSpacing: 0.8 },
  pictureRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pictureButton: {
    width: 64,
    height: 64,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    ...communityDpShadow,
  },
  picturePreview: { width: '100%', height: '100%', borderRadius: 16 },
  pictureText: { flexShrink: 1, gap: 2 },
  rulesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addRule: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addRuleText: { fontSize: 13, fontFamily: 'Geist_500Medium' },
  disabled: { opacity: 0.5 },
  rulesBody: { gap: 8, marginTop: 2 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ruleInput: { flex: 1 },
  ruleRemove: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 13,
    fontFamily: 'Geist_500Medium',
    marginTop: 16,
    lineHeight: 18,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  secondaryButton: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { fontSize: 15, fontFamily: 'Geist_600SemiBold' },
  primaryButton: {
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerPrimary: { flex: 1 },
  primaryButtonText: { fontSize: 15, fontFamily: 'Geist_600SemiBold' },
  successWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 8,
  },
  successIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  successTitle: { fontSize: 20, fontFamily: 'Geist_700Bold', letterSpacing: -0.4, textAlign: 'center' },
  successBody: {
    fontSize: 14,
    fontFamily: 'Geist_400Regular',
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 300,
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'stretch',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 8,
    marginTop: 16,
  },
  inviteUrl: { flex: 1, fontSize: 12, fontFamily: 'Geist_400Regular', paddingHorizontal: 6 },
  copyButton: {
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  copyButtonText: { fontSize: 13, fontFamily: 'Geist_500Medium' },
});
