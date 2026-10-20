import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Clipboard,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { ScreenHeader } from '@/components/settings/ScreenHeader';
import { CommunityTabIcon } from '@/components/community/TabIcons';
import { API_BASE_URL } from '@/lib/api';
import { communityStore } from '@/lib/communityStore';
import { loadCommunityDetail, putCommunityDetail } from '@/lib/communityDetailCache';
import { putCommunityRules, rulesFromTexts } from '@/lib/communityRulesCache';
import { prepareImageForUpload } from '@/lib/prepareImage';
import { hapticSelection } from '@/lib/haptics';
import type { CommunityDetailRow } from '@/lib/communities';
import {
  deleteCommunity,
  getCommunityRules,
  regenerateCommunityInvite,
  updateCommunitySettings,
} from '@/lib/communities';

/**
 * Community settings — the mobile reading of the web CommunitySettingsView:
 * the same sections (General, Privacy, Tabs, Rules, Invite link, Danger zone),
 * the same copy, and the same multipart PATCH. Owners see privacy and delete;
 * managers holding "edit community settings" manage the basics, exactly like
 * the web modal. A phone holds this as a pushed screen, not a sheet.
 */

const FEATURE_OPTIONS: Array<{
  id: 'chat' | 'threads' | 'showcase' | 'events' | 'resources';
  label: string;
  description: string;
  required?: boolean;
}> = [
  { id: 'chat', label: 'Chat', description: 'Real-time member conversations', required: true },
  { id: 'threads', label: 'Threads', description: 'Topic-led discussions' },
  { id: 'showcase', label: 'Showcase', description: 'Share work and collect feedback' },
  { id: 'events', label: 'Events', description: 'Meetups and online sessions' },
  { id: 'resources', label: 'Resources', description: 'Links, files, and references' },
];

const MAX_RULES = 12;
const RULE_MAX_CHARS = 160;

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'community'
  );
}

/** The public join URL on the same host the API lives on (web slug contract). */
function buildInviteUrl(name: string, token: string): string {
  if (!token) return '';
  const host = (API_BASE_URL || 'https://uxcommunity.in').replace(/\/$/, '');
  return `${host}/join/${slugify(name)}-${token}`;
}

export default function CommunitySettingsScreen() {
  const { id, name: nameParam } = useLocalSearchParams<{ id: string; name?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const [detail, setDetail] = useState<CommunityDetailRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── General ──
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [tabs, setTabs] = useState<string[]>(['chat', 'threads', 'showcase', 'events', 'resources']);
  const [showcase, setShowcase] = useState(true);

  // ── Photo ──
  const [image, setImage] = useState<{ uri: string; name: string; type: string } | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);

  // ── Rules ──
  const [rules, setRules] = useState<string[]>([]);
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [addingRule, setAddingRule] = useState(false);
  const [newRule, setNewRule] = useState('');
  const newRuleRef = useRef<TextInput>(null);

  // ── Invite link ──
  const [inviteToken, setInviteToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenNotice, setRegenNotice] = useState<string | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  // ── Save / delete ──
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    loadCommunityDetail(id, { force: true })
      .then((row) => {
        if (cancelled) return;
        if (!row) {
          setLoadError('Community not found.');
          return;
        }
        setDetail(row);
        setName(row.name);
        setDescription(row.description ?? '');
        setIsPrivate(Boolean(row.is_private));
        setShowcase(row.showcase_enabled !== false);
        setTabs(
          Array.from(
            new Set(['chat', ...((row.enabled_tabs ?? ['threads', 'events', 'resources']) as string[])])
          ).filter((tab) => ['chat', 'threads', 'events', 'resources'].includes(tab))
        );
        setImagePreview(row.image_url ?? null);
        setInviteToken(row.invite_token ?? '');
      })
      .catch(() => {
        if (!cancelled) setLoadError("Couldn't load community settings.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    setRulesLoaded(false);
    getCommunityRules(id)
      .then((rows) => {
        if (!cancelled) setRules(rows.map((row) => row.rule_text));
      })
      .catch(() => {
        if (!cancelled) setRules([]);
      })
      .finally(() => {
        if (!cancelled) setRulesLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (addingRule) {
      const timer = setTimeout(() => newRuleRef.current?.focus(), 60);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [addingRule]);

  const isOwner = useMemo(() => {
    if (!detail) return false;
    return detail.current_user_role === 'owner' || (!!user?.id && detail.owner_id === user.id);
  }, [detail, user?.id]);

  const canEdit = useMemo(() => {
    if (!detail) return false;
    if (isOwner) return true;
    const role = detail.current_user_role;
    return (
      (role === 'admin' || role === 'moderator') &&
      Boolean(detail.current_user_permissions?.can_edit_settings)
    );
  }, [detail, isOwner]);

  const inviteUrl = buildInviteUrl(name, inviteToken);

  const pickImage = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    try {
      const prepared = await prepareImageForUpload(asset, `community-${Date.now()}`);
      setImage({ uri: prepared.uri, name: prepared.name, type: prepared.mimeType });
      setImagePreview(prepared.uri);
    } catch {
      // Keep the original picked image as a last-resort fallback.
      setImage({
        uri: asset.uri,
        name: `community-${Date.now()}.jpg`,
        type: asset.mimeType ?? 'image/jpeg',
      });
      setImagePreview(asset.uri);
    }
    setRemoveImage(false);
  }, []);

  const handleRemoveImage = useCallback(() => {
    hapticSelection();
    setImage(null);
    setImagePreview(null);
    setRemoveImage(true);
  }, []);

  const toggleFeature = useCallback((feature: string) => {
    if (feature === 'chat') return;
    hapticSelection();
    if (feature === 'showcase') {
      setShowcase((prev) => !prev);
      return;
    }
    setTabs((prev) =>
      prev.includes(feature) ? prev.filter((item) => item !== feature) : [...prev, feature]
    );
  }, []);

  const commitNewRule = useCallback(() => {
    const trimmed = newRule.trim();
    if (!trimmed) {
      setAddingRule(false);
      setNewRule('');
      return;
    }
    if (rules.length >= MAX_RULES) return;
    setRules((prev) => [...prev, trimmed]);
    setNewRule('');
    setAddingRule(false);
  }, [newRule, rules.length]);

  const handleCopyInvite = useCallback(() => {
    if (!inviteUrl) return;
    hapticSelection();
    Clipboard.setString(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }, [inviteUrl]);

  const handleRegenerate = useCallback(async () => {
    if (regenerating) return;
    setConfirmRegenerate(false);
    setRegenerating(true);
    setRegenNotice(null);
    try {
      const result = await regenerateCommunityInvite(id);
      if (result.invite_token) setInviteToken(result.invite_token);
      setRegenNotice('Link regenerated — the old link is now invalid.');
      setTimeout(() => setRegenNotice(null), 4000);
    } catch (e) {
      setRegenNotice(e instanceof Error ? e.message : "Couldn't regenerate the link.");
    } finally {
      setRegenerating(false);
    }
  }, [id, regenerating]);

  const handleSave = useCallback(async () => {
    if (saving || !detail || !canEdit) return;
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setSaving(true);
    setSaveError(null);
    try {
      const trimmedRules = rules.map((rule) => rule.trim()).filter(Boolean).slice(0, MAX_RULES);
      const result = await updateCommunitySettings(id, {
        name: trimmedName,
        description: description.trim(),
        ...(isOwner ? { isPrivate } : {}),
        tabs,
        showcase,
        // A failed rules fetch leaves the stored rules untouched rather than
        // wiping them with the empty draft.
        rules: rulesLoaded ? trimmedRules : undefined,
        image,
        removeImage: removeImage && !image,
      });

      const imageUrl =
        result.image_url !== undefined
          ? result.image_url
          : image
            ? imagePreview
            : removeImage
              ? null
              : (detail.image_url ?? null);

      const patch = {
        name: trimmedName,
        image_url: imageUrl,
        ...(isOwner ? { is_private: isPrivate } : {}),
        enabled_tabs: tabs,
        showcase_enabled: showcase,
      };
      communityStore.notifyCommunityChanged({ kind: 'patch', communityId: id, patch });
      putCommunityDetail(id, {
        ...detail,
        ...patch,
        description: description.trim() || null,
      });
      if (rulesLoaded) putCommunityRules(id, rulesFromTexts(trimmedRules));

      setSaved(true);
      setTimeout(() => {
        if (router.canGoBack()) router.back();
        else router.replace('/communities');
      }, 700);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }, [
    canEdit,
    description,
    detail,
    id,
    image,
    imagePreview,
    isOwner,
    isPrivate,
    name,
    removeImage,
    router,
    rules,
    rulesLoaded,
    saving,
    showcase,
    tabs,
  ]);

  const handleDelete = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteCommunity(id);
      communityStore.notifyCommunityChanged({ kind: 'remove', communityId: id });
      communityStore.activeCommunityId = null;
      setConfirmDelete(false);
      // The chat this screen was opened from belongs to the deleted community —
      // pop the whole stack so Back cannot reopen it, then land on the list.
      router.dismissAll();
      router.replace('/communities');
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Failed to delete community.');
    } finally {
      setDeleting(false);
    }
  }, [deleting, id, router]);

  const displayName = name || detail?.name || (nameParam ? decodeURIComponent(nameParam) : 'Community');
  const canSave = canEdit && !saving && name.trim().length > 0;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />
      <ScreenHeader title="Community Settings" subtitle={displayName} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : loadError || !detail ? (
        <View style={styles.center}>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            {loadError ?? 'Community not found.'}
          </Text>
        </View>
      ) : !canEdit ? (
        <View style={styles.center}>
          <Feather name="lock" size={22} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            You don&apos;t have permission to edit community settings.
          </Text>
        </View>
      ) : (
        <>
          <KeyboardAwareScrollViewCompat
            style={styles.flex}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* ── General ── */}
            <Section title="General" colors={colors}>
              <View>
                <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
                  Community Photo
                </Text>
                <View style={styles.photoRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Change community photo"
                    onPress={() => void pickImage()}
                    style={[
                      styles.photoButton,
                      { borderColor: colors.border, backgroundColor: colors.surfaceRaised },
                    ]}
                  >
                    {imagePreview ? (
                      <Image source={{ uri: imagePreview }} style={styles.photoPreview} />
                    ) : (
                      <Feather
                        name="image"
                        size={20}
                        strokeWidth={2.5}
                        color={colors.mutedForeground}
                      />
                    )}
                  </Pressable>
                  <View style={styles.photoText}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void pickImage()}
                      hitSlop={6}
                    >
                      <Text style={[styles.linkText, { color: colors.accent }]}>
                        {imagePreview ? 'Replace photo' : 'Upload photo'}
                      </Text>
                    </Pressable>
                    {imagePreview ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={handleRemoveImage}
                        hitSlop={6}
                      >
                        <Text style={[styles.linkText, { color: colors.mutedForeground }]}>
                          Remove photo
                        </Text>
                      </Pressable>
                    ) : null}
                    <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                      JPEG, PNG, or WebP under 10 MB.
                    </Text>
                  </View>
                </View>
              </View>

              <View>
                <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
                  Community Name
                </Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  maxLength={80}
                  accessibilityLabel="Community name"
                  style={[
                    styles.field,
                    {
                      color: colors.foreground,
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                />
              </View>

              <View>
                <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
                  Description
                </Text>
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  maxLength={500}
                  multiline
                  placeholder="What's this community about?"
                  placeholderTextColor={colors.mutedForeground}
                  accessibilityLabel="Community description"
                  style={[
                    styles.field,
                    styles.fieldMultiline,
                    {
                      color: colors.foreground,
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                />
              </View>
            </Section>

            {!isOwner && (
              <View
                style={[
                  styles.noticeCard,
                  { borderColor: colors.accent, backgroundColor: colors.accentSoft },
                ]}
              >
                <Text style={[styles.noticeText, { color: colors.foreground }]}>
                  You are managing{' '}
                  <Text style={styles.noticeStrong}>{detail.name}</Text> as a{' '}
                  <Text style={[styles.noticeStrong, { color: colors.accent }]}>
                    community admin
                  </Text>
                  . Privacy, invite-only access and deletion are controlled by the platform.
                </Text>
              </View>
            )}

            {/* ── Privacy — owner only ── */}
            {isOwner && (
              <Section title="Privacy" colors={colors}>
                <View style={styles.stack}>
                  <PrivacyCard
                    colors={colors}
                    icon="globe"
                    label="Public"
                    copy="Anyone can discover and join"
                    active={!isPrivate}
                    onPress={() => {
                      hapticSelection();
                      setIsPrivate(false);
                    }}
                  />
                  <PrivacyCard
                    colors={colors}
                    icon="lock"
                    label="Private"
                    copy="Invite-only — you approve members"
                    active={isPrivate}
                    onPress={() => {
                      hapticSelection();
                      setIsPrivate(true);
                    }}
                  />
                </View>
              </Section>
            )}

            {/* ── Tabs ── */}
            <Section title="Tabs" colors={colors}>
              <View style={styles.areaGrid}>
                {FEATURE_OPTIONS.map((option) => {
                  const active = option.id === 'showcase' ? showcase : tabs.includes(option.id);
                  const disabled = !!option.required;
                  return (
                    <Pressable
                      key={option.id}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: active, disabled }}
                      onPress={() => toggleFeature(option.id)}
                      disabled={disabled}
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
                          size={14}
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
                              size={9}
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
                          <Text
                            style={[styles.requiredText, { color: colors.mutedForeground }]}
                          >
                            REQUIRED
                          </Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </Section>

            {/* ── Rules ── */}
            <Section title="Rules" colors={colors}>
              <View style={styles.rulesHeader}>
                <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                  Members see these before joining
                </Text>
                {!addingRule && rules.length < MAX_RULES && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      hapticSelection();
                      setAddingRule(true);
                    }}
                    hitSlop={8}
                    style={styles.addRule}
                  >
                    <Feather name="plus" size={12} strokeWidth={2.5} color={colors.accent} />
                    <Text style={[styles.addRuleText, { color: colors.accent }]}>Add rule</Text>
                  </Pressable>
                )}
              </View>

              <View
                style={[styles.rulesCard, { borderColor: colors.border }]}
              >
                {rulesLoaded && rules.length === 0 && !addingRule ? (
                  <Text style={[styles.rulesEmpty, { color: colors.mutedForeground }]}>
                    No rules yet.
                  </Text>
                ) : null}

                {rules.map((rule, index) => (
                  <View
                    key={`${index}-${rule.slice(0, 8)}`}
                    style={[
                      styles.ruleRow,
                      index > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: colors.border,
                      },
                    ]}
                  >
                    <View
                      style={[styles.ruleNumber, { backgroundColor: colors.accentSoft }]}
                    >
                      <Text style={[styles.ruleNumberText, { color: colors.accent }]}>
                        {index + 1}
                      </Text>
                    </View>
                    <Text style={[styles.ruleText, { color: colors.foreground }]}>{rule}</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove rule ${index + 1}`}
                      hitSlop={8}
                      onPress={() => setRules((prev) => prev.filter((_, i) => i !== index))}
                      style={styles.ruleRemove}
                    >
                      <Feather name="x" size={13} strokeWidth={2.5} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                ))}

                {addingRule && (
                  <View
                    style={[
                      styles.addRuleRow,
                      rules.length > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: colors.border,
                      },
                    ]}
                  >
                    <TextInput
                      ref={newRuleRef}
                      value={newRule}
                      onChangeText={setNewRule}
                      maxLength={RULE_MAX_CHARS}
                      placeholder="Describe the rule…"
                      placeholderTextColor={colors.mutedForeground}
                      accessibilityLabel="New rule"
                      onSubmitEditing={commitNewRule}
                      style={[
                        styles.field,
                        styles.addRuleInput,
                        {
                          color: colors.foreground,
                          backgroundColor: colors.card,
                          borderColor: colors.accent,
                        },
                      ]}
                    />
                    <Pressable
                      accessibilityRole="button"
                      onPress={commitNewRule}
                      style={[styles.smallPrimary, { backgroundColor: colors.accent }]}
                    >
                      <Text style={[styles.smallPrimaryText, { color: colors.accentForeground }]}>
                        Add
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setAddingRule(false);
                        setNewRule('');
                      }}
                      style={[styles.smallSecondary, { borderColor: colors.border }]}
                    >
                      <Text style={[styles.smallSecondaryText, { color: colors.mutedForeground }]}>
                        Cancel
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </Section>

            {/* ── Invite link ── */}
            <Section title="Invite Link" colors={colors}>
              <View style={[styles.inviteCard, { borderColor: colors.border }]}>
                <View style={styles.inviteNoteRow}>
                  {isPrivate ? (
                    <>
                      <View
                        style={[
                          styles.privatePill,
                          { borderColor: colors.border, backgroundColor: colors.surface },
                        ]}
                      >
                        <Feather name="lock" size={9} strokeWidth={2.5} color={colors.mutedForeground} />
                        <Text style={[styles.privatePillText, { color: colors.mutedForeground }]}>
                          Private
                        </Text>
                      </View>
                      <Text style={[styles.hint, styles.flex, { color: colors.mutedForeground }]}>
                        Members must request via this link. You approve each request.
                      </Text>
                    </>
                  ) : (
                    <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                      Share this link to bring members directly to your community.
                    </Text>
                  )}
                </View>

                <View style={styles.inviteRow}>
                  <View
                    style={[
                      styles.inviteField,
                      { backgroundColor: colors.card, borderColor: colors.border },
                    ]}
                  >
                    <Text
                      numberOfLines={1}
                      ellipsizeMode="middle"
                      style={[
                        styles.inviteUrlText,
                        { color: inviteUrl ? colors.foreground : colors.mutedForeground },
                      ]}
                    >
                      {inviteUrl || 'Regenerate the link to view it'}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={handleCopyInvite}
                    disabled={!inviteUrl}
                    style={({ pressed }) => [
                      styles.copyButton,
                      {
                        borderColor: colors.border,
                        backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
                        opacity: inviteUrl ? 1 : 0.5,
                      },
                    ]}
                  >
                    <Feather
                      name={copied ? 'check' : 'copy'}
                      size={12}
                      strokeWidth={2.5}
                      color={copied ? colors.success : colors.mutedForeground}
                    />
                    <Text style={[styles.copyText, { color: colors.mutedForeground }]}>
                      {copied ? 'Copied!' : 'Copy'}
                    </Text>
                  </Pressable>
                </View>

                <View style={styles.regenRow}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setConfirmRegenerate(true)}
                    disabled={regenerating}
                    hitSlop={8}
                    style={styles.regenButton}
                  >
                    {regenerating ? (
                      <ActivityIndicator size="small" color={colors.mutedForeground} />
                    ) : (
                      <Feather
                        name="refresh-cw"
                        size={11}
                        strokeWidth={2.5}
                        color={colors.mutedForeground}
                      />
                    )}
                    <Text style={[styles.regenText, { color: colors.mutedForeground }]}>
                      Regenerate link
                    </Text>
                  </Pressable>
                  {regenNotice ? (
                    <Text style={[styles.regenNotice, { color: '#F59E0B' }]} numberOfLines={2}>
                      {regenNotice}
                    </Text>
                  ) : null}
                </View>
              </View>
            </Section>

            {/* ── Danger zone — owner only ── */}
            {isOwner && (
              <Section title="Danger Zone" titleColor={colors.destructive} colors={colors}>
                <View
                  style={[styles.dangerCard, { borderColor: colors.destructive + '33' }]}
                >
                  <View style={styles.dangerRow}>
                    <View style={styles.flex}>
                      <Text style={[styles.dangerTitle, { color: colors.foreground }]}>
                        Delete this community
                      </Text>
                      <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                        Permanently remove this community and all its content.
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setDeleteError(null);
                        setConfirmDelete(true);
                      }}
                      style={[styles.deleteButton, { borderColor: colors.destructive + '4D' }]}
                    >
                      <Feather name="trash-2" size={12} strokeWidth={2.5} color={colors.destructive} />
                      <Text style={[styles.deleteButtonText, { color: colors.destructive }]}>
                        Delete
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </Section>
            )}

            <View style={{ height: 24 }} />
          </KeyboardAwareScrollViewCompat>

          {/* ── Save footer ── */}
          <View
            style={[
              styles.footer,
              {
                borderTopColor: colors.border,
                backgroundColor: colors.background,
                paddingBottom: insets.bottom + 12,
              },
            ]}
          >
            {saveError ? (
              <Text style={[styles.saveError, { color: colors.destructive }]}>{saveError}</Text>
            ) : saved ? (
              <Text style={[styles.saveError, { color: colors.success }]}>Settings saved.</Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save changes"
              onPress={() => void handleSave()}
              disabled={!canSave}
              style={({ pressed }) => [
                styles.saveButton,
                {
                  backgroundColor: pressed ? colors.accentHover : colors.accent,
                  opacity: canSave ? 1 : 0.5,
                },
              ]}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.accentForeground} />
              ) : (
                <Feather name="save" size={14} strokeWidth={2.5} color={colors.accentForeground} />
              )}
              <Text style={[styles.saveButtonText, { color: colors.accentForeground }]}>
                {saving ? 'Saving changes…' : 'Save changes'}
              </Text>
            </Pressable>
          </View>
        </>
      )}

      {/* Regenerate confirm — centered, like every destructive dialog. */}
      <ConfirmDialog
        visible={confirmRegenerate}
        title="Regenerate invite link?"
        body="The current link will stop working immediately. Members who already joined are unaffected."
        confirmLabel="Regenerate"
        busy={false}
        onCancel={() => setConfirmRegenerate(false)}
        onConfirm={() => void handleRegenerate()}
        colors={colors}
      />

      {/* Delete confirm — centered; the web Danger Zone's inline confirm. */}
      <ConfirmDialog
        visible={confirmDelete}
        title="Delete community?"
        body={`Deleting ${detail?.name ?? 'this community'} cannot be undone. All members will lose access.`}
        confirmLabel="Delete"
        destructive
        busy={deleting}
        error={deleteError}
        onCancel={() => {
          if (!deleting) setConfirmDelete(false);
        }}
        onConfirm={() => void handleDelete()}
        colors={colors}
      />
    </View>
  );
}

// ── Section shell ────────────────────────────────────────────────────────────

function Section({
  title,
  titleColor,
  children,
  colors,
}: {
  title: string;
  titleColor?: string;
  children: React.ReactNode;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.section}>
      <Text
        style={[styles.sectionTitle, { color: titleColor ?? colors.mutedForeground }]}
      >
        {title.toUpperCase()}
      </Text>
      <View style={styles.sectionBody}>{children}</View>
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
      onPress={onPress}
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
        size={16}
        strokeWidth={2.5}
        color={active ? colors.accent : colors.mutedForeground}
      />
      <View style={styles.privacyText}>
        <Text style={[styles.privacyLabel, { color: colors.foreground }]}>{label}</Text>
        <Text style={[styles.privacyCopy, { color: colors.mutedForeground }]}>{copy}</Text>
      </View>
      {active && (
        <View style={[styles.privacyCheck, { backgroundColor: colors.accent }]}>
          <Feather name="check" size={9} strokeWidth={2.5} color={colors.accentForeground} />
        </View>
      )}
    </Pressable>
  );
}

function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  destructive,
  busy,
  error,
  onCancel,
  onConfirm,
  colors,
}: {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  busy: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.dialogBackdrop}>
        <View
          style={[
            styles.dialogCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.dialogTitle, { color: colors.foreground }]}>{title}</Text>
          <Text style={[styles.dialogBody, { color: colors.mutedForeground }]}>{body}</Text>
          {error ? (
            <Text style={[styles.dialogError, { color: colors.destructive }]}>{error}</Text>
          ) : null}
          <View style={styles.dialogActions}>
            <Pressable
              accessibilityRole="button"
              onPress={onCancel}
              disabled={busy}
              style={({ pressed }) => [
                styles.dialogSecondary,
                {
                  borderColor: colors.border,
                  backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
                  opacity: busy ? 0.5 : 1,
                },
              ]}
            >
              <Text style={[styles.dialogSecondaryText, { color: colors.mutedForeground }]}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={onConfirm}
              disabled={busy}
              style={({ pressed }) => [
                styles.dialogPrimary,
                {
                  borderColor: destructive ? colors.destructive + '4D' : 'transparent',
                  backgroundColor: destructive
                    ? pressed
                      ? colors.destructive + '33'
                      : colors.destructive + '1A'
                    : pressed
                      ? colors.accentHover
                      : colors.accent,
                  opacity: busy ? 0.6 : 1,
                },
              ]}
            >
              {busy ? (
                <ActivityIndicator
                  size="small"
                  color={destructive ? colors.destructive : colors.accentForeground}
                />
              ) : (
                <Text
                  style={[
                    styles.dialogPrimaryText,
                    { color: destructive ? colors.destructive : colors.accentForeground },
                  ]}
                >
                  {confirmLabel}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Geist_400Regular',
    lineHeight: 20,
    textAlign: 'center',
  },
  content: { padding: 16, paddingBottom: 16 },
  section: { marginBottom: 28 },
  sectionTitle: {
    fontSize: 10,
    fontFamily: 'Geist_600SemiBold',
    letterSpacing: 1.4,
    marginBottom: 14,
  },
  sectionBody: { gap: 16 },
  fieldLabel: { fontSize: 12.5, fontFamily: 'Geist_500Medium', marginBottom: 7 },
  field: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: 'Geist_400Regular',
  },
  fieldMultiline: { minHeight: 88, textAlignVertical: 'top' },
  hint: { fontSize: 11.5, fontFamily: 'Geist_400Regular', lineHeight: 16 },

  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  photoButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoPreview: { width: '100%', height: '100%' },
  photoText: { gap: 4, flexShrink: 1 },
  linkText: { fontSize: 12.5, fontFamily: 'Geist_500Medium' },

  noticeCard: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 24 },
  noticeText: { fontSize: 12, fontFamily: 'Geist_400Regular', lineHeight: 18 },
  noticeStrong: { fontFamily: 'Geist_600SemiBold' },

  stack: { gap: 8 },
  privacyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  privacyText: { flex: 1, gap: 2 },
  privacyLabel: { fontSize: 14, fontFamily: 'Geist_600SemiBold' },
  privacyCopy: { fontSize: 12, fontFamily: 'Geist_400Regular' },
  privacyCheck: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },

  areaGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 8 },
  areaCard: {
    width: '48.5%',
    borderWidth: 1,
    borderRadius: 12,
    padding: 11,
  },
  areaHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  areaLabel: { fontSize: 13.5, fontFamily: 'Geist_600SemiBold' },
  areaSpacer: { flex: 1 },
  areaCheck: {
    width: 15,
    height: 15,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  areaCopy: { fontSize: 11, fontFamily: 'Geist_400Regular', marginTop: 4, lineHeight: 15 },
  requiredPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginTop: 7,
  },
  requiredText: { fontSize: 8.5, fontFamily: 'Geist_600SemiBold', letterSpacing: 0.7 },

  rulesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  addRule: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addRuleText: { fontSize: 12.5, fontFamily: 'Geist_500Medium' },
  rulesCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: 'hidden' },
  rulesEmpty: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 12,
    fontFamily: 'Geist_400Regular',
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  ruleNumber: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  ruleNumberText: { fontSize: 10, fontFamily: 'Geist_600SemiBold' },
  ruleText: { flex: 1, fontSize: 13.5, fontFamily: 'Geist_400Regular', lineHeight: 19 },
  ruleRemove: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  addRuleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  addRuleInput: { flex: 1, paddingVertical: 8 },
  smallPrimary: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  smallPrimaryText: { fontSize: 12, fontFamily: 'Geist_600SemiBold' },
  smallSecondary: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  smallSecondaryText: { fontSize: 12, fontFamily: 'Geist_400Regular' },

  inviteCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 14, gap: 12 },
  inviteNoteRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  privatePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  privatePillText: { fontSize: 9.5, fontFamily: 'Geist_500Medium' },
  inviteRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inviteField: {
    flex: 1,
    minWidth: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  inviteUrlText: { fontSize: 12, fontFamily: 'Geist_400Regular' },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  copyText: { fontSize: 12, fontFamily: 'Geist_500Medium' },
  regenRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  regenButton: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  regenText: { fontSize: 12, fontFamily: 'Geist_500Medium' },
  regenNotice: { flex: 1, fontSize: 11, fontFamily: 'Geist_400Regular', textAlign: 'right' },

  dangerCard: { borderWidth: 1, borderRadius: 12, padding: 14 },
  dangerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dangerTitle: { fontSize: 13.5, fontFamily: 'Geist_500Medium', marginBottom: 2 },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  deleteButtonText: { fontSize: 12, fontFamily: 'Geist_500Medium' },

  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
  },
  saveError: { fontSize: 12, fontFamily: 'Geist_500Medium', textAlign: 'center' },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 13,
  },
  saveButtonText: { fontSize: 15, fontFamily: 'Geist_600SemiBold' },

  dialogBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 340,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 18,
  },
  dialogTitle: { fontSize: 16, fontFamily: 'Geist_600SemiBold', textAlign: 'center' },
  dialogBody: {
    fontSize: 12.5,
    fontFamily: 'Geist_400Regular',
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 6,
  },
  dialogError: {
    fontSize: 12,
    fontFamily: 'Geist_500Medium',
    textAlign: 'center',
    marginTop: 10,
  },
  dialogActions: { flexDirection: 'row', gap: 8, marginTop: 18 },
  dialogSecondary: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 11,
  },
  dialogSecondaryText: { fontSize: 13, fontFamily: 'Geist_500Medium' },
  dialogPrimary: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 11,
  },
  dialogPrimaryText: { fontSize: 13, fontFamily: 'Geist_600SemiBold' },
});
