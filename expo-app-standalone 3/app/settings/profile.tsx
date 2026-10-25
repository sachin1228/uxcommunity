import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CommunityIcon } from '@/components/communities/CommunityIcon';
import {
  OptionPickerSheet,
  OptionPickerValue,
  type PickerOption,
} from '@/components/settings/OptionPickerSheet';
import { SaveStatus, type SaveState } from '@/components/settings/SaveStatus';
import { ScreenHeader } from '@/components/settings/ScreenHeader';
import { useColors } from '@/hooks/useColors';
import { communityStore } from '@/lib/communityStore';
import {
  getOwnProfile,
  getProfileIdentity,
  saveProfileLink,
  updateProfileIdentity,
} from '@/lib/profile';
import {
  SLOT_LABEL,
  formatUnlockDate,
  previewGroup,
  slotUnlockDate,
  type IdentityDimension,
  type IdentitySlot,
  type OfficialGroup,
  type ProfileIdentityPayload,
  type ProfileOption,
} from '@/lib/profileIdentity';
import { resolveProfilePictureUri } from '@/lib/profilePicture';

/**
 * Profile settings — the mobile reading of the web drill-down: the identity
 * fields a member picked at signup (name, city, industry sector, job title,
 * experience level) with their three-month per-slot cooldowns, and the two
 * outside links (LinkedIn, portfolio) the profile hero shows as circles.
 *
 * Saving is two-step, like the web form: Review changes opens a sheet stating
 * the old → new values, the official communities the change moves the member
 * between, and the three-month cost — nothing is written until Confirm.
 *
 * The web page also carries the workplace (CompanySection); company
 * verification has its own multi-step flow and lands on mobile with it.
 */

type PickerKind = 'city' | 'sector' | 'level' | 'title';

interface Move {
  dimension: IdentityDimension;
  label: string;
  fromValue: string;
  toValue: string;
  leave: OfficialGroup | null;
  join: { name: string; image_url: string | null } | null;
}

const otherCreatesNoGroup = 'No group — “Other” creates no community';

function moveSentence(move: Move): string {
  const head = `You're changing your ${move.label.toLowerCase()} from ${move.fromValue} to ${move.toValue}`;
  if (move.leave && move.join) {
    return `${head} — you leave ${move.leave.name} and automatically join ${move.join.name}.`;
  }
  if (move.leave) {
    return `${head} — you leave ${move.leave.name}; “Other” creates no community.`;
  }
  if (move.join) {
    return `${head} — you automatically join ${move.join.name}.`;
  }
  return `${head} — no community changes.`;
}

export default function ProfileSettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [identity, setIdentity] = useState<ProfileIdentityPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<ProfileIdentityPayload['current'] | null>(null);

  // ── Draft ──
  const [name, setName] = useState('');
  const [cityId, setCityId] = useState('');
  const [sectorId, setSectorId] = useState('');
  const [levelSlug, setLevelSlug] = useState('');
  const [titleSlug, setTitleSlug] = useState('');
  const [picker, setPicker] = useState<PickerKind | null>(null);

  // ── Save ──
  const [reviewOpen, setReviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorLines, setErrorLines] = useState<string[]>([]);
  const [result, setResult] = useState<{
    left: OfficialGroup[];
    joined: OfficialGroup[];
  } | null>(null);

  // ── Links (server values; each card keeps its own draft) ──
  const [linkedinInitial, setLinkedinInitial] = useState('');
  const [portfolioInitial, setPortfolioInitial] = useState('');

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [payload, profile] = await Promise.all([getProfileIdentity(), getOwnProfile()]);
      setIdentity(payload);
      setBaseline(payload.current);
      setName(payload.current.name);
      setCityId(payload.current.city_id ?? '');
      setSectorId(payload.current.sector_id ?? '');
      setLevelSlug(payload.current.experience_level ?? '');
      setTitleSlug(payload.current.job_title ?? '');
      setLinkedinInitial(profile.profile?.linkedin_url ?? '');
      setPortfolioInitial(profile.profile?.portfolio_url ?? '');
    } catch {
      setLoadError('Couldn\u2019t load your profile settings. Tap to retry.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const trimmedName = name.trim();
  const nameChanged = !!baseline && trimmedName !== baseline.name;
  const cityChanged = !!baseline && cityId !== (baseline.city_id ?? '');
  const sectorChanged = !!baseline && sectorId !== (baseline.sector_id ?? '');
  const levelChanged = !!baseline && levelSlug !== (baseline.experience_level ?? '');
  const titleChanged = !!baseline && titleSlug !== (baseline.job_title ?? '');
  const anyChange = nameChanged || cityChanged || sectorChanged || levelChanged || titleChanged;
  const nameValid = trimmedName.length >= 2;
  const canReview = anyChange && nameValid;

  const optionById = useCallback(
    (options: ProfileOption[], id: string | null) => options.find((o) => o.id === id) ?? null,
    [],
  );

  const currentCityName = optionById(identity?.options.cities ?? [], baseline?.city_id ?? null)?.name ?? baseline?.city_id ?? '—';
  const currentSectorName = optionById(identity?.options.sectors ?? [], baseline?.sector_id ?? null)?.name ?? baseline?.sector_id ?? '—';
  const currentLevelName = optionById(identity?.options.levels ?? [], baseline?.experience_level ?? null)?.name ?? baseline?.experience_level ?? '—';
  const currentTitleName = optionById(identity?.options.titles ?? [], baseline?.job_title ?? null)?.name ?? baseline?.job_title ?? '—';

  const selectedCity = optionById(identity?.options.cities ?? [], cityId || null);
  const selectedSector = optionById(identity?.options.sectors ?? [], sectorId || null);
  const selectedLevel = optionById(identity?.options.levels ?? [], levelSlug || null);
  const selectedTitle = optionById(identity?.options.titles ?? [], titleSlug || null);

  const moves = useMemo<Move[]>(() => {
    if (!identity) return [];
    const list: Move[] = [];
    if (cityChanged) {
      list.push({ dimension: 'city', label: 'City', fromValue: currentCityName, toValue: selectedCity?.name ?? '—', leave: identity.groups.city, join: selectedCity ? previewGroup('city', selectedCity) : null });
    }
    if (sectorChanged) {
      list.push({ dimension: 'sector', label: 'Industry Sector', fromValue: currentSectorName, toValue: selectedSector?.name ?? '—', leave: identity.groups.sector, join: selectedSector ? previewGroup('sector', selectedSector) : null });
    }
    if (levelChanged) {
      list.push({ dimension: 'experience_level', label: 'Experience Level', fromValue: currentLevelName, toValue: selectedLevel?.name ?? '—', leave: identity.groups.experience_level, join: selectedLevel ? previewGroup('experience_level', selectedLevel) : null });
    }
    if (titleChanged) {
      list.push({ dimension: 'job_title', label: 'Job Title', fromValue: currentTitleName, toValue: selectedTitle?.name ?? '—', leave: identity.groups.job_title, join: selectedTitle ? previewGroup('job_title', selectedTitle) : null });
    }
    return list;
  }, [identity, cityChanged, sectorChanged, levelChanged, titleChanged, currentCityName, currentSectorName, currentLevelName, currentTitleName, selectedCity, selectedSector, selectedLevel, selectedTitle]);

  const spentSlots = useMemo<IdentitySlot[]>(() => {
    const slots: IdentitySlot[] = [];
    if (nameChanged) slots.push('name');
    if (titleChanged) slots.push('job_title');
    if (levelChanged) slots.push('experience_level');
    if (cityChanged) slots.push('city');
    if (sectorChanged) slots.push('sector');
    return slots;
  }, [nameChanged, titleChanged, levelChanged, cityChanged, sectorChanged]);

  const handleConfirm = useCallback(async () => {
    if (!baseline || submitting) return;
    setSubmitting(true);
    setErrorLines([]);

    const payload: Record<string, string> = {};
    if (nameChanged) payload.name = trimmedName;
    if (cityChanged) payload.city_id = cityId;
    if (sectorChanged) payload.sector_id = sectorId;
    if (levelChanged) payload.experience_level = levelSlug;
    if (titleChanged) payload.job_title = titleSlug;

    try {
      const report = await updateProfileIdentity(payload);
      const nextBaseline = {
        name: trimmedName,
        city_id: cityId || null,
        sector_id: sectorId || null,
        experience_level: levelSlug || null,
        job_title: titleSlug || null,
      };
      setBaseline(nextBaseline);
      setResult({ left: report.left_communities, joined: report.joined_communities });
      setReviewOpen(false);
      // The change moved memberships between official groups — the
      // communities list is stale by definition.
      communityStore.notifyCommunityChanged({ kind: 'refresh' });
      // Re-read so the cooldown locks now show the spent slots.
      try {
        const payloadFresh = await getProfileIdentity();
        setIdentity(payloadFresh);
      } catch {
        /* the save landed; the lock notes just stay as they were */
      }
    } catch (e) {
      const status = (e as { status?: number }).status;
      const data = (e as { data?: { error?: string; locked_fields?: Record<string, string> } }).data;
      if (status === 409 && data?.error === 'profile_field_cooldown') {
        // Another surface already spent a slot. Say which one, with its date,
        // and hand the form back.
        const lines = Object.entries(data.locked_fields ?? {}).map(
          ([field, iso]) =>
            `${SLOT_LABEL[field as IdentitySlot] ?? field} can be changed again on ${formatUnlockDate(iso)}.`,
        );
        setErrorLines(
          lines.length ? lines : ['One of these details was changed too recently to change again yet.'],
        );
        setReviewOpen(false);
        try {
          const payloadFresh = await getProfileIdentity();
          setIdentity(payloadFresh);
        } catch {
          /* the 409 copy is enough */
        }
      } else if (typeof status === 'number') {
        setErrorLines([(e as Error).message || 'Couldn\u2019t save your changes. Please try again.']);
      } else {
        setErrorLines(['Network error. Please try again.']);
      }
    } finally {
      setSubmitting(false);
    }
  }, [baseline, submitting, nameChanged, trimmedName, cityChanged, cityId, sectorChanged, sectorId, levelChanged, levelSlug, titleChanged, titleSlug]);

  const lockOf = (slot: IdentitySlot): string | null => identity?.locks[slot] ?? null;

  const pickerConfig = (() => {
    if (!identity || !picker) return null;
    switch (picker) {
      case 'city':
        return { title: 'Select city', options: identity.options.cities, selectedId: cityId, onPick: (o: ProfileOption) => { setCityId(o.id); setPicker(null); } };
      case 'sector':
        return { title: 'Select industry sector', options: identity.options.sectors, selectedId: sectorId, onPick: (o: ProfileOption) => { setSectorId(o.id); setPicker(null); } };
      case 'level':
        return { title: 'Select experience level', options: identity.options.levels, selectedId: levelSlug, onPick: (o: ProfileOption) => { setLevelSlug(o.id); setPicker(null); } };
      case 'title':
        return { title: 'Select job title', options: identity.options.titles, selectedId: titleSlug, onPick: (o: ProfileOption) => { setTitleSlug(o.id); setPicker(null); } };
    }
  })();

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Profile" subtitle="Your name, role and city as they appear to everyone." />

      {loadError && !identity ? (
        <Pressable onPress={() => void load()} style={styles.center}>
          <Text style={[styles.errorText, { color: colors.destructive }]}>{loadError}</Text>
        </Pressable>
      ) : !identity ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Profile</Text>
              <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>
                Pick your details. Changing your city, industry sector, job title or experience
                level moves you between the official groups they created; you will confirm on the
                next step.
              </Text>
            </View>

            {result ? (
              <View style={[styles.resultBox, { borderColor: colors.accent + '4D', backgroundColor: colors.accent + '1A' }]}>
                <View style={styles.resultTitleRow}>
                  <Feather name="check" size={13} color={colors.accent} />
                  <Text style={[styles.resultTitle, { color: colors.accent }]}>Profile updated</Text>
                </View>
                {result.left.length > 0 || result.joined.length > 0 ? (
                  <View style={styles.resultLists}>
                    {result.left.length > 0 ? (
                      <ResultGroup label="Left" groups={result.left} colors={colors} muted />
                    ) : null}
                    {result.joined.length > 0 ? (
                      <ResultGroup label="Joined" groups={result.joined} colors={colors} />
                    ) : null}
                  </View>
                ) : null}
              </View>
            ) : null}

            {errorLines.length > 0 ? (
              <View style={[styles.errorBox, { borderColor: 'rgba(239,68,68,0.3)', backgroundColor: 'rgba(239,68,68,0.1)' }]}>
                {errorLines.map((line) => (
                  <Text key={line} style={[styles.errorTextLines, { color: colors.destructive }]}>
                    {line}
                  </Text>
                ))}
              </View>
            ) : null}

            {/* ── Name ── */}
            <View>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>NAME</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                editable={!lockOf('name')}
                maxLength={100}
                placeholder="Your name"
                placeholderTextColor={colors.mutedForeground}
                style={[
                  styles.input,
                  {
                    color: colors.foreground,
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    opacity: lockOf('name') ? 0.5 : 1,
                  },
                ]}
              />
              {lockOf('name') ? (
                <LockNote until={lockOf('name')!} colors={colors} />
              ) : nameChanged && !nameValid ? (
                <Text style={[styles.validationText, { color: colors.destructive }]}>
                  Name must be at least 2 characters.
                </Text>
              ) : null}
            </View>

            {/* ── City / Industry Sector ── */}
            <FieldRow
              colors={colors}
              label="CITY"
              option={selectedCity}
              placeholder="Select city"
              lockedUntil={lockOf('city')}
              onPress={() => setPicker('city')}
            />
            <FieldRow
              colors={colors}
              label="INDUSTRY SECTOR"
              option={selectedSector}
              placeholder="Select industry sector"
              lockedUntil={lockOf('sector')}
              onPress={() => setPicker('sector')}
            />
            <FieldRow
              colors={colors}
              label="JOB TITLE"
              option={selectedTitle}
              placeholder="Select job title"
              lockedUntil={lockOf('job_title')}
              onPress={() => setPicker('title')}
            />
            <FieldRow
              colors={colors}
              label="EXPERIENCE LEVEL"
              option={selectedLevel}
              placeholder="Select experience level"
              lockedUntil={lockOf('experience_level')}
              onPress={() => setPicker('level')}
            />

            <Pressable
              onPress={() => {
                setErrorLines([]);
                setReviewOpen(true);
              }}
              disabled={!canReview}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.reviewButton,
                {
                  backgroundColor: colors.primary,
                  opacity: !canReview ? 0.5 : pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={[styles.reviewLabel, { color: colors.primaryForeground }]}>
                Review changes
              </Text>
            </Pressable>
          </View>

          <LinkCard
            colors={colors}
            icon={<Ionicons name="logo-linkedin" size={17} color={colors.mutedForeground} />}
            title="LinkedIn"
            subtitle="Shows as a button on your profile."
            placeholder="https://linkedin.com/in/yourname"
            initialUrl={linkedinInitial}
            onSave={(v) => saveProfileLink('linkedin_url', v)}
          />
          <LinkCard
            colors={colors}
            icon={<Feather name="globe" size={17} color={colors.mutedForeground} />}
            title="Portfolio"
            subtitle="Shows as a button on your profile."
            placeholder="https://yourportfolio.com"
            initialUrl={portfolioInitial}
            onSave={(v) => saveProfileLink('portfolio_url', v)}
          />
        </ScrollView>
      )}

      {pickerConfig ? (
        <OptionPickerSheet
          visible
          title={pickerConfig.title}
          options={pickerConfig.options}
          selectedId={pickerConfig.selectedId || null}
          onPick={pickerConfig.onPick}
          onClose={() => setPicker(null)}
        />
      ) : null}

      {reviewOpen && identity ? (
        <IdentityReviewModal
          colors={colors}
          insetsBottom={insets.bottom}
          nameChanged={nameChanged}
          baselineName={baseline?.name ?? ''}
          newName={trimmedName}
          moves={moves}
          spentSlots={spentSlots}
          submitting={submitting}
          errorLines={errorLines}
          onBack={() => setReviewOpen(false)}
          onConfirm={() => void handleConfirm()}
        />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Field row — a picker trigger styled like the web's disabled-able select
// ---------------------------------------------------------------------------

function FieldRow({
  colors,
  label,
  option,
  placeholder,
  lockedUntil,
  onPress,
}: {
  colors: ReturnType<typeof useColors>;
  label: string;
  option: ProfileOption | null;
  placeholder: string;
  lockedUntil: string | null;
  onPress: () => void;
}) {
  return (
    <View>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Pressable
        onPress={onPress}
        disabled={!!lockedUntil}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.input,
          styles.fieldRow,
          {
            backgroundColor: colors.background,
            borderColor: colors.border,
            opacity: lockedUntil ? 0.5 : pressed ? 0.85 : 1,
          },
        ]}
      >
        <OptionPickerValue
          option={option}
          placeholder={placeholder}
          textStyle={styles.fieldValue}
        />
      </Pressable>
      {lockedUntil ? <LockNote until={lockedUntil} colors={colors} /> : null}
    </View>
  );
}

function LockNote({ until, colors }: { until: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.lockRow}>
      <Feather name="lock" size={10} color={colors.foregroundSubtle} />
      <Text style={[styles.lockText, { color: colors.foregroundSubtle }]}>
        Can change again on {formatUnlockDate(until)}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Result list — the groups left / joined, name and DP
// ---------------------------------------------------------------------------

function GroupRow({ group, colors, muted }: { group: OfficialGroup; colors: ReturnType<typeof useColors>; muted?: boolean }) {
  const uri = resolveProfilePictureUri(group.image_url);
  return (
    <View style={styles.groupRow}>
      {uri ? (
        <Image source={{ uri }} style={styles.groupImage} />
      ) : (
        <CommunityIcon size={24} iconSize={12} />
      )}
      <Text
        style={[styles.groupName, { color: muted ? colors.foregroundSubtle : colors.foreground }]}
        numberOfLines={1}
      >
        {group.name}
      </Text>
    </View>
  );
}

function ResultGroup({
  label,
  groups,
  colors,
  muted,
}: {
  label: string;
  groups: OfficialGroup[];
  colors: ReturnType<typeof useColors>;
  muted?: boolean;
}) {
  return (
    <View style={[styles.resultGroupBox, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <Text style={[styles.resultGroupLabel, { color: colors.mutedForeground }]}>{label}</Text>
      {groups.map((group) => (
        <GroupRow key={group.id} group={group} colors={colors} muted={muted} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Link cards — LinkedIn / portfolio with the web's 900ms debounced autosave
// ---------------------------------------------------------------------------

function LinkCard({
  colors,
  icon,
  title,
  subtitle,
  placeholder,
  initialUrl,
  onSave,
}: {
  colors: ReturnType<typeof useColors>;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  placeholder: string;
  /** The stored link — the card keeps its own draft so a reopen starts fresh. */
  initialUrl: string;
  onSave: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initialUrl);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  // The server value arrived after mount (the card renders as soon as the
  // screen has any data) — adopt it while the member has not typed yet.
  const [serverUrl, setServerUrl] = useState(initialUrl);
  if (serverUrl !== initialUrl) {
    setServerUrl(initialUrl);
    if (value === serverUrl || value === '') setValue(initialUrl);
  }

  useEffect(() => {
    if (value === initialUrl) return;
    const t = setTimeout(async () => {
      setSaveState('saving');
      try {
        // Trimmed string: the profile route stores "" as null, which is how a
        // cleared link is written.
        await onSave(value.trim());
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, initialUrl]);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.linkHeader}>
        <View>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>{title}</Text>
          <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
        </View>
        <SaveStatus state={saveState} />
      </View>
      <View style={styles.linkRow}>
        <View style={[styles.linkIconTile, { borderColor: colors.border, backgroundColor: colors.background }]}>
          {icon}
        </View>
        <TextInput
          value={value}
          onChangeText={setValue}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={[
            styles.input,
            styles.linkInput,
            { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border },
          ]}
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// The review sheet — old → new, the groups that change, the three-month cost
// ---------------------------------------------------------------------------

function IdentityReviewModal({
  colors,
  insetsBottom,
  nameChanged,
  baselineName,
  newName,
  moves,
  spentSlots,
  submitting,
  errorLines,
  onBack,
  onConfirm,
}: {
  colors: ReturnType<typeof useColors>;
  insetsBottom: number;
  nameChanged: boolean;
  baselineName: string;
  newName: string;
  moves: Move[];
  spentSlots: IdentitySlot[];
  submitting: boolean;
  errorLines: string[];
  onBack: () => void;
  onConfirm: () => void;
}) {
  const AMBER = '#FBBF24';
  const AMBER_BG = 'rgba(245,158,11,0.1)';
  const AMBER_BORDER = 'rgba(245,158,11,0.3)';

  return (
    <Modal transparent animationType="fade" visible onRequestClose={submitting ? undefined : onBack}>
      <Pressable style={styles.modalBackdrop} onPress={submitting ? undefined : onBack}>
        <Pressable
          style={[
            styles.modalPanel,
            { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: Math.max(insetsBottom, 16) },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <ScrollView showsVerticalScrollIndicator={false} style={styles.modalScroll}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Review changes</Text>
            <Text style={[styles.modalSubtitle, { color: colors.mutedForeground }]}>
              Nothing has been saved yet — confirm to apply these changes.
            </Text>

            {errorLines.length > 0 ? (
              <View style={[styles.errorBox, { borderColor: 'rgba(239,68,68,0.3)', backgroundColor: 'rgba(239,68,68,0.1)' }]}>
                {errorLines.map((line) => (
                  <Text key={line} style={[styles.errorTextLines, { color: colors.destructive }]}>
                    {line}
                  </Text>
                ))}
              </View>
            ) : null}

            {/* Old → new rows */}
            <View style={[styles.changeBox, { borderColor: colors.border }]}>
              {nameChanged ? (
                <ChangeRow colors={colors} label="Name" from={baselineName} to={newName} />
              ) : null}
              {moves.map((move) => (
                <ChangeRow
                  key={move.dimension}
                  colors={colors}
                  label={move.label}
                  from={move.fromValue}
                  to={move.toValue}
                />
              ))}
            </View>

            {/* Communities that will change */}
            {moves.length > 0 ? (
              <View style={[styles.movesBox, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}>
                <Text style={[styles.movesTitle, { color: colors.mutedForeground }]}>
                  COMMUNITIES THAT WILL CHANGE
                </Text>
                <Text style={[styles.movesExplainer, { color: colors.foregroundSubtle }]}>
                  Members are only placed in official communities that match their details — this
                  keeps communities relatable and spam-free. {moves.map(moveSentence).join(' ')}
                </Text>
                {moves.map((move) => (
                  <View key={move.dimension} style={styles.moveRowWrap}>
                    <Text style={[styles.moveLabel, { color: colors.mutedForeground }]}>
                      {move.label.toUpperCase()}
                    </Text>
                    <View style={[styles.moveLedger, { borderColor: colors.border }]}>
                      <View style={styles.moveLine}>
                        <Text style={[styles.moveSide, { color: colors.foregroundSubtle }]}>LEAVING</Text>
                        {move.leave ? (
                          <Text style={[styles.moveGroupText, { color: colors.mutedForeground, textDecorationLine: 'line-through' }]} numberOfLines={1}>
                            {move.leave.name}
                          </Text>
                        ) : (
                          <Text style={[styles.moveGroupText, { color: colors.mutedForeground }]}>
                            No group held
                          </Text>
                        )}
                      </View>
                      <View style={[styles.moveLine, { backgroundColor: colors.accent + '1A' }]}>
                        <Text style={[styles.moveSide, { color: colors.mutedForeground }]}>JOINING</Text>
                        {move.join ? (
                          <Text style={[styles.moveGroupText, { color: colors.foreground }]} numberOfLines={1}>
                            {move.join.name}
                          </Text>
                        ) : (
                          <Text style={[styles.moveGroupText, { color: colors.mutedForeground }]}>
                            {otherCreatesNoGroup}
                          </Text>
                        )}
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {/* The cost */}
            <View style={[styles.costBox, { borderColor: AMBER_BORDER, backgroundColor: AMBER_BG }]}>
              <Text style={[styles.costTitle, { color: AMBER }]}>
                {spentSlots.length === 1
                  ? `${SLOT_LABEL[spentSlots[0]]} can be changed once every 3 months.`
                  : 'Each of these can be changed once every 3 months.'}
              </Text>
              {spentSlots.map((slot) => (
                <Text key={slot} style={[styles.costLine, { color: AMBER }]}>
                  {SLOT_LABEL[slot]} — next change available on {formatUnlockDate(slotUnlockDate(new Date()))}
                </Text>
              ))}
            </View>
          </ScrollView>

          <View style={styles.modalFooter}>
            <Pressable
              onPress={onBack}
              disabled={submitting}
              accessibilityRole="button"
              style={({ pressed }) => [styles.backToEdit, { opacity: submitting ? 0.5 : pressed ? 0.6 : 1 }]}
            >
              <Feather name="arrow-left" size={12} color={colors.mutedForeground} />
              <Text style={[styles.backToEditLabel, { color: colors.mutedForeground }]}>Back to edit</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              disabled={submitting}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.confirmButton,
                { backgroundColor: colors.primary, opacity: submitting ? 0.6 : pressed ? 0.85 : 1 },
              ]}
            >
              {submitting ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : null}
              <Text style={[styles.confirmLabel, { color: colors.primaryForeground }]}>
                Confirm changes
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ChangeRow({
  colors,
  label,
  from,
  to,
}: {
  colors: ReturnType<typeof useColors>;
  label: string;
  from: string;
  to: string;
}) {
  return (
    <View style={styles.changeRow}>
      <Text style={[styles.changeLabel, { color: colors.mutedForeground }]}>{label.toUpperCase()}</Text>
      <View style={styles.changeValues}>
        <Text style={[styles.changeFrom, { color: colors.mutedForeground }]} numberOfLines={1}>
          {from}
        </Text>
        <Feather name="arrow-right" size={12} color={colors.foregroundSubtle} />
        <Text style={[styles.changeTo, { color: colors.foreground }]} numberOfLines={1}>
          {to}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  content: { padding: 16, gap: 14 },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    gap: 16,
  },
  cardTitle: { fontSize: 15, fontFamily: 'Geist_600SemiBold' },
  cardSubtitle: { fontSize: 12, fontFamily: 'Geist_400Regular', lineHeight: 17, marginTop: 2 },
  fieldLabel: {
    fontSize: 10,
    fontFamily: 'Geist_600SemiBold',
    letterSpacing: 0.8,
    marginBottom: 6,
    color: '#8a8a8a',
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: 'Geist_400Regular',
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  fieldValue: { flex: 1, fontSize: 14, fontFamily: 'Geist_400Regular' },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  lockText: { fontSize: 11, fontFamily: 'Geist_400Regular' },
  validationText: { fontSize: 11, fontFamily: 'Geist_400Regular', marginTop: 5 },
  reviewButton: {
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 2,
  },
  reviewLabel: { fontSize: 14, fontFamily: 'Geist_600SemiBold' },
  resultBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
  },
  resultTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  resultTitle: { fontSize: 12.5, fontFamily: 'Geist_500Medium' },
  resultLists: { marginTop: 10, gap: 10 },
  resultGroupBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  resultGroupLabel: {
    fontSize: 10,
    fontFamily: 'Geist_600SemiBold',
    letterSpacing: 0.8,
  },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupImage: { width: 24, height: 24, borderRadius: 12 },
  groupName: { flex: 1, fontSize: 13.5, fontFamily: 'Geist_400Regular' },
  errorBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  errorTextLines: { fontSize: 12, fontFamily: 'Geist_400Regular', lineHeight: 17 },
  errorText: { fontSize: 14, fontFamily: 'Geist_500Medium', textAlign: 'center' },
  linkHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  linkIconTile: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkInput: { flex: 1 },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  modalPanel: {
    maxHeight: '88%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
    overflow: 'hidden',
  },
  modalScroll: { paddingHorizontal: 20 },
  modalTitle: { fontSize: 17, fontFamily: 'Geist_600SemiBold', marginTop: 14 },
  modalSubtitle: { fontSize: 12.5, fontFamily: 'Geist_400Regular', marginTop: 4, marginBottom: 14 },
  changeBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  changeRow: { gap: 3 },
  changeLabel: { fontSize: 10, fontFamily: 'Geist_600SemiBold', letterSpacing: 0.8 },
  changeValues: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  changeFrom: { fontSize: 13.5, fontFamily: 'Geist_400Regular', textDecorationLine: 'line-through' },
  changeTo: { fontSize: 13.5, fontFamily: 'Geist_500Medium' },
  movesBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 12,
    gap: 8,
  },
  movesTitle: { fontSize: 10, fontFamily: 'Geist_600SemiBold', letterSpacing: 0.8 },
  movesExplainer: { fontSize: 11.5, fontFamily: 'Geist_400Regular', lineHeight: 17 },
  moveRowWrap: { gap: 5 },
  moveLabel: { fontSize: 10, fontFamily: 'Geist_600SemiBold', letterSpacing: 0.8 },
  moveLedger: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: 'hidden',
  },
  moveLine: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  moveSide: { width: 62, fontSize: 10, fontFamily: 'Geist_600SemiBold', letterSpacing: 0.6 },
  moveGroupText: { flex: 1, fontSize: 12.5, fontFamily: 'Geist_400Regular' },
  costBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 12,
    gap: 3,
  },
  costTitle: { fontSize: 12.5, fontFamily: 'Geist_500Medium' },
  costLine: { fontSize: 11.5, fontFamily: 'Geist_400Regular', lineHeight: 16 },
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  backToEdit: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8 },
  backToEditLabel: { fontSize: 12.5, fontFamily: 'Geist_500Medium' },
  confirmButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  confirmLabel: { fontSize: 14, fontFamily: 'Geist_600SemiBold' },
});
