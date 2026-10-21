import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import {
  getCommunityRules,
  type CommunityDetailRow,
  type CommunityRule,
} from '@/lib/communities';
import { loadCommunityDetail, peekCommunityDetail } from '@/lib/communityDetailCache';
import { peekCommunityRules, putCommunityRules } from '@/lib/communityRulesCache';
import { CommunityNameBadges, VerifiedDpBadge } from '@/components/communities/CommunityBadges';
import { MembersPanel } from '@/components/community/MembersPanel';
import { ActivityPanel } from '@/components/community/ActivityPanel';
import { communityNameBadges } from '@/lib/communityBadges';

/**
 * The community info screen behind the chat header's title — WhatsApp's
 * contact-info layout carrying the web right sidebar's content (members,
 * about, rules) plus the management surfaces the web chat header offers:
 * pending requests and member administration in the Members tab, and the
 * manager-tier Activity audit trail as a third tab.
 *
 * Reads the same endpoints the web client reads, so both clients agree on
 * every line, every permission and every request.
 */

export interface CommunityInfoCommunity {
  id: string;
  name: string;
  image_url: string | null;
  type?: string;
  is_private?: boolean;
  reference_name?: string | null;
  member_count?: number | null;
}

interface Props {
  visible: boolean;
  /** The chat screen's live community snapshot. */
  community: CommunityInfoCommunity | null;
  onlineCount: number;
  currentUserId: string;
  /** The caller owns the community. */
  isOwner?: boolean;
  /** Owner or manager granted "manage members". */
  canManageMembers?: boolean;
  /** Owner or platform-appointed admin — sees Activity and appoints moderators. */
  canManageModerators?: boolean;
  onClose: () => void;
}

/** The web TYPE_LABELS — the chip a city/sector/experience/job group wears. */
const TYPE_LABELS: Record<string, string> = {
  city: 'City',
  sector: 'Industry',
  experience_level: 'Experience',
  job_title: 'Job Title',
};

/** The web fallbackDescription — what About says when the row has none. */
function fallbackDescription(type?: string, referenceName?: string | null): string {
  const name = referenceName ?? 'this topic';
  switch (type) {
    case 'city':
      return `Connect with designers based in ${name}.`;
    case 'sector':
      return `A community for designers in the ${name} industry.`;
    case 'experience_level':
      return `A space for ${name} designers to connect and share.`;
    case 'job_title':
      return `Connect with fellow ${name}s and share your work.`;
    case 'user':
      return 'A member-created community on UX Community.';
    default:
      return 'A designer community on UX Community.';
  }
}

/** "Jul 19, 2026" — the web info panel's created-date format (en-US). */
function fmtCreatedAt(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Rules endpoint's 60-second freshness, like the web panel's request cache. */
type InfoTab = 'about' | 'members' | 'activity';

export function CommunityInfoView({
  visible,
  community,
  onlineCount,
  currentUserId,
  isOwner = false,
  canManageMembers = false,
  canManageModerators = false,
  onClose,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const communityId = community?.id ?? '';

  const [detail, setDetail] = useState<CommunityDetailRow | null>(null);
  const [rules, setRules] = useState<CommunityRule[] | null>(null);
  const [activeTab, setActiveTab] = useState<InfoTab>('about');

  // Each opening starts back on Overview; the detail cache paints instantly
  // when it is fresh, and the request refreshes it in the background.
  useEffect(() => {
    if (!visible) return;
    setActiveTab('about');
    setDetail(peekCommunityDetail(communityId) ?? null);
  }, [visible, communityId]);

  useEffect(() => {
    if (!visible || !communityId) return undefined;
    let cancelled = false;

    loadCommunityDetail(communityId)
      .then((row) => {
        if (!cancelled) setDetail(row);
      })
      .catch(() => {
        /* the route snapshot still carries the hero */
      });

    const freshRules = peekCommunityRules(communityId);
    if (freshRules) {
      setRules(freshRules);
    } else {
      setRules(null);
      getCommunityRules(communityId)
        .then((list) => {
          putCommunityRules(communityId, list);
          if (!cancelled) setRules(list);
        })
        .catch(() => {
          if (!cancelled) setRules([]);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [visible, communityId]);

  // A role change elsewhere (or a save in settings) can take Activity away.
  useEffect(() => {
    if (activeTab === 'activity' && !canManageModerators) setActiveTab('about');
  }, [activeTab, canManageModerators]);

  const name = detail?.name ?? community?.name ?? 'Community';
  const imageUrl = detail?.image_url ?? community?.image_url ?? null;
  const type = detail?.type ?? community?.type;
  const referenceName = detail?.reference_name ?? community?.reference_name ?? null;
  const memberCount = detail?.member_count ?? community?.member_count ?? null;
  const isPrivate = detail?.is_private ?? community?.is_private;
  const isEventChat = type === 'event';
  const description = detail?.description ?? fallbackDescription(type, referenceName);

  // The web panel's chips: the type's label, then the reference name.
  const tags = [
    ...(type && TYPE_LABELS[type] ? [TYPE_LABELS[type]] : []),
    ...(referenceName ? [referenceName] : []),
  ];

  const infoTabs = useMemo<Array<{ key: InfoTab; label: string }>>(
    () => [
      { key: 'about', label: 'Overview' },
      { key: 'members', label: 'Members' },
      ...(canManageModerators ? [{ key: 'activity' as InfoTab, label: 'Activity' }] : []),
    ],
    [canManageModerators]
  );

  if (!visible) return null;

  const header = (
    <View>
      <InfoHero
        name={name}
        imageUrl={imageUrl}
        type={type}
        isPrivate={isPrivate}
        memberCount={memberCount}
        onlineCount={onlineCount}
      />
      <View
        style={[
          styles.tabsShell,
          { backgroundColor: colors.background, borderBottomColor: colors.border },
        ]}
      >
        {infoTabs.map((tab) => {
          const active = activeTab === tab.key;
          const labelColor = active ? colors.foreground : colors.mutedForeground;
          return (
            <Pressable
              key={tab.key}
              onPress={() => {
                if (active) return;
                setActiveTab(tab.key);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[
                styles.tab,
                { borderBottomColor: active ? colors.accent : 'transparent' },
              ]}
            >
              <View style={styles.tabInner}>
                {tab.key === 'about' ? (
                  <Feather name="info" size={14} strokeWidth={2.5} color={labelColor} />
                ) : tab.key === 'members' ? (
                  <Ionicons name="people" size={14} color={labelColor} />
                ) : (
                  <Feather name="activity" size={14} strokeWidth={2.5} color={labelColor} />
                )}
                <Text style={[styles.tabText, { color: labelColor }]}>{tab.label}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <StatusBar style={colors.isDark ? 'light' : 'dark'} />

        {/* Top bar — WhatsApp's contact info: close on the left, title beside. */}
        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close community info"
            style={styles.closeBtn}
          >
            <Feather name="x" size={24} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.topTitle, { color: colors.foreground }]}>Community info</Text>
        </View>

        {activeTab === 'members' ? (
          <MembersPanel
            communityId={communityId}
            isPrivate={Boolean(isPrivate)}
            isEventChat={isEventChat}
            currentUserId={currentUserId}
            isOwner={isOwner}
            canManageMembers={canManageMembers}
            canManageModerators={canManageModerators}
            header={header}
          />
        ) : activeTab === 'activity' ? (
          <ActivityPanel communityId={communityId} currentUserId={currentUserId} header={header} />
        ) : (
          <ScrollView
            contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
            showsVerticalScrollIndicator={false}
          >
            {header}

            {/* ── About ── */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>About</Text>
              <Text style={[styles.aboutText, { color: colors.mutedForeground }]}>
                {description}
              </Text>
              <View style={styles.aboutRows}>
                {type === 'city' && referenceName && (
                  <View style={styles.aboutRow}>
                    <Feather name="map-pin" size={15} color={colors.foregroundSubtle} />
                    <Text style={[styles.aboutRowText, { color: colors.mutedForeground }]}>
                      {referenceName}
                    </Text>
                  </View>
                )}
                <View style={styles.aboutRow}>
                  <Feather name="calendar" size={15} color={colors.foregroundSubtle} />
                  <Text style={[styles.aboutRowText, { color: colors.mutedForeground }]}>
                    Created {fmtCreatedAt(detail?.created_at)}
                  </Text>
                </View>
              </View>
              {tags.length > 0 && (
                <View style={styles.tagRow}>
                  {tags.map((tag) => (
                    <View key={tag} style={[styles.tag, { borderColor: colors.border }]}>
                      <Text style={[styles.tagText, { color: colors.mutedForeground }]}>
                        {tag}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            {/* ── Rules ── */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Rules</Text>
              {rules === null ? (
                <ActivityIndicator color={colors.accent} style={styles.rulesSpinner} />
              ) : rules.length > 0 ? (
                <View style={styles.rulesList}>
                  {rules.map((rule, index) => (
                    <View key={rule.id} style={styles.ruleRow}>
                      <View style={[styles.ruleNumber, { backgroundColor: colors.surfaceRaised }]}>
                        <Text style={[styles.ruleNumberText, { color: colors.mutedForeground }]}>
                          {index + 1}
                        </Text>
                      </View>
                      <Text style={[styles.ruleText, { color: colors.mutedForeground }]}>
                        {rule.rule_text}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={[styles.aboutText, { color: colors.mutedForeground }]}>
                  No community rules have been added yet.
                </Text>
              )}
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function InfoHero({
  name,
  imageUrl,
  type,
  isPrivate,
  memberCount,
  onlineCount,
}: {
  name: string;
  imageUrl: string | null;
  type?: string;
  isPrivate?: boolean;
  memberCount: number | null;
  onlineCount: number;
}) {
  const colors = useColors();
  // The name renders word by word so the badges can flow after the last word
  // on the final line (a single Text block would seat them beside the block,
  // vertically centred across both lines). One a11y element out of the runs.
  const nameWords = name.split(/\s+/).filter(Boolean);
  const heroBadges = communityNameBadges(type, isPrivate);
  const heroLabel = [
    name,
    heroBadges.visibility === 'lock'
      ? 'Private community'
      : heroBadges.visibility === 'globe'
        ? 'Public community'
        : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={styles.hero}>
      <View style={styles.heroAvatarWrap}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={[styles.heroAvatar, { borderColor: colors.border }]} />
        ) : (
          <View style={[styles.heroAvatar, styles.heroAvatarFallback, { backgroundColor: colors.surfaceRaised }]}>
            <Text style={[styles.heroAvatarText, { color: colors.mutedForeground }]}>
              {name.slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}
        {heroBadges.verified && <VerifiedDpBadge dpSize={96} />}
      </View>
      <View style={styles.heroNameRow} accessible accessibilityLabel={heroLabel}>
        {nameWords.map((word, index) => (
          <Text key={`${word}-${index}`} style={[styles.heroName, { color: colors.foreground }]}>
            {word}
          </Text>
        ))}
        <CommunityNameBadges type={type} isPrivate={isPrivate} size={14} />
      </View>
      {memberCount !== null && (
        <View style={styles.heroMetaRow}>
          <View style={styles.metaItem}>
            <Ionicons name="people" size={12} color={colors.mutedForeground} />
            <Text style={[styles.heroMeta, { color: colors.mutedForeground }]}>
              {memberCount} member{memberCount === 1 ? '' : 's'}
            </Text>
          </View>
          {onlineCount > 0 && (
            <View style={styles.metaItem} accessible accessibilityLabel={`${onlineCount} online`}>
              <View style={styles.onlineDot} />
              <Text style={[styles.heroMeta, { color: colors.mutedForeground }]}>
                {onlineCount} online
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  closeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  topTitle: { fontSize: 17, fontFamily: 'Geist_600SemiBold' },

  hero: { alignItems: 'center', paddingHorizontal: 32, paddingTop: 8, paddingBottom: 24 },
  heroAvatarWrap: {
    position: 'relative',
  },
  heroAvatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: StyleSheet.hairlineWidth,
  },
  heroAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  heroAvatarText: { fontSize: 34, fontFamily: 'Geist_600SemiBold' },
  heroNameRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 5,
    marginTop: 14,
    paddingHorizontal: 8,
  },
  heroName: { fontSize: 20, fontFamily: 'Geist_600SemiBold', flexShrink: 1, textAlign: 'center' },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  heroMeta: { fontSize: 12, fontFamily: 'Geist_400Regular' },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22C55E' },

  divider: { height: StyleSheet.hairlineWidth },

  // The chat header's tab-strip language: equal cells, icon + label, accent
  // underline.
  tabsShell: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tabText: { fontSize: 12, fontFamily: 'Geist_500Medium' },

  section: { paddingHorizontal: 20, paddingVertical: 20 },
  sectionTitle: { fontSize: 15, fontFamily: 'Geist_600SemiBold' },

  aboutText: { fontSize: 14, lineHeight: 21, fontFamily: 'Geist_400Regular', marginTop: 12 },
  aboutRows: { marginTop: 14, gap: 8 },
  aboutRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aboutRowText: { fontSize: 14, fontFamily: 'Geist_400Regular' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  tag: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 4 },
  tagText: { fontSize: 12, fontFamily: 'Geist_400Regular' },

  rulesSpinner: { alignSelf: 'flex-start', marginTop: 12 },
  rulesList: { marginTop: 12, gap: 12 },
  ruleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  ruleNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  ruleNumberText: { fontSize: 12, fontFamily: 'Geist_600SemiBold' },
  ruleText: { flex: 1, fontSize: 14, lineHeight: 20, fontFamily: 'Geist_400Regular', paddingTop: 2 },
});
