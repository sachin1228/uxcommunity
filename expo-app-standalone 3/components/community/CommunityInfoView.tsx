import React, { useEffect, useState } from 'react';
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
import { Feather } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import {
  getCommunityDetail,
  getCommunityRules,
  type Community,
  type CommunityDetailRow,
  type CommunityRule,
} from '@/lib/communities';
import { loadCommunityRoster } from '@/lib/communityRoster';
import { PersonAvatar } from '@/components/PersonAvatar';
import { CommunityNameBadges } from '@/components/communities/CommunityBadges';
import type { MentionCandidate } from '@/lib/chat';

/**
 * The community info screen behind the chat header's title — WhatsApp's
 * contact-info layout (close + "Community info", centred hero, divided
 * sections) carrying the web right sidebar's content: the member list, About
 * (description / created date / type chips) and the numbered rules. Reads the
 * same endpoints the web panel reads (GET /api/communities/:id and its
 * /members and /rules), so both clients agree on every line.
 */

interface Props {
  visible: boolean;
  /** The chat screen's resolved community — the hero renders instantly from it. */
  community: Community | null;
  onlineCount: number;
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

// Module-level memos so reopening the screen inside the windows costs no
// Worker invocations — the same freshness rules the web panel applies
// (metaCache's 5-minute staleness; the rules endpoint's 60-second cache).
const DETAIL_STALE_MS = 5 * 60_000;
const RULES_STALE_MS = 60_000;
const detailCache = new Map<string, { fetchedAt: number; row: CommunityDetailRow | null }>();
const rulesCache = new Map<string, { fetchedAt: number; rules: CommunityRule[] }>();

export function CommunityInfoView({
  visible,
  community,
  onlineCount,
  onClose,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const communityId = community?.id ?? '';

  const [detail, setDetail] = useState<CommunityDetailRow | null>(null);
  const [members, setMembers] = useState<MentionCandidate[] | null>(null);
  const [rules, setRules] = useState<CommunityRule[] | null>(null);

  // Fill from cache when fresh; otherwise fetch and remember. Only the roster
  // shows a spinner — detail and rules land quietly into their sections.
  useEffect(() => {
    if (!visible || !communityId) return;
    let cancelled = false;

    const freshDetail = detailCache.get(communityId);
    if (freshDetail && Date.now() - freshDetail.fetchedAt < DETAIL_STALE_MS) {
      setDetail(freshDetail.row);
    } else {
      setDetail(null);
      getCommunityDetail(communityId)
        .then((row) => {
          detailCache.set(communityId, { fetchedAt: Date.now(), row });
          if (!cancelled) setDetail(row);
        })
        .catch(() => {});
    }

    setMembers(null);
    loadCommunityRoster(communityId)
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });

    const freshRules = rulesCache.get(communityId);
    if (freshRules && Date.now() - freshRules.fetchedAt < RULES_STALE_MS) {
      setRules(freshRules.rules);
    } else {
      setRules(null);
      getCommunityRules(communityId)
        .then((list) => {
          rulesCache.set(communityId, { fetchedAt: Date.now(), rules: list });
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

  const name = detail?.name ?? community?.name ?? 'Community';
  const imageUrl = detail?.image_url ?? community?.image_url ?? null;
  const type = detail?.type ?? community?.type;
  const referenceName = detail?.reference_name ?? community?.reference_name ?? null;
  const memberCount = detail?.member_count ?? community?.member_count ?? members?.length ?? null;
  const description =
    detail?.description ?? fallbackDescription(type, referenceName);
  // The web panel's chips: the type's label, then the reference name.
  const tags = [
    ...(type && TYPE_LABELS[type] ? [TYPE_LABELS[type]] : []),
    ...(referenceName ? [referenceName] : []),
  ];

  if (!visible) return null;

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

        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Hero: avatar, name, the room's size ── */}
          <View style={styles.hero}>
            {imageUrl ? (
              <Image source={{ uri: imageUrl }} style={[styles.heroAvatar, { borderColor: colors.border }]} />
            ) : (
              <View style={[styles.heroAvatar, styles.heroAvatarFallback, { backgroundColor: colors.surfaceRaised }]}>
                <Text style={[styles.heroAvatarText, { color: colors.mutedForeground }]}>
                  {name.slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.heroNameRow}>
              <Text numberOfLines={2} style={[styles.heroName, { color: colors.foreground }]}>
                {name}
              </Text>
              <CommunityNameBadges type={type} isPrivate={detail?.is_private ?? community?.is_private} size={14} />
            </View>
            {memberCount !== null && (
              <View style={styles.heroMetaRow}>
                <View style={styles.metaItem}>
                  <Feather name="users" size={12} color={colors.mutedForeground} />
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

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          {/* ── Members ── */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Members{memberCount !== null ? ` (${memberCount})` : ''}
              </Text>
              {onlineCount > 0 && (
                <View style={styles.metaItem} accessible accessibilityLabel={`${onlineCount} online`}>
                  <View style={styles.onlineDot} />
                  <Text style={[styles.onlineText, { color: colors.mutedForeground }]}>
                    {onlineCount} online
                  </Text>
                </View>
              )}
            </View>

            {members === null ? (
              <ActivityIndicator color={colors.accent} style={styles.membersSpinner} />
            ) : (
              members.map((member) => (
                <View
                  key={member.user_id}
                  style={styles.memberRow}
                  accessible
                  accessibilityLabel={
                    member.designation ? `${member.name}, ${member.designation}` : member.name
                  }
                >
                  <PersonAvatar
                    name={member.name}
                    url={member.avatar_url}
                    size={40}
                  />
                  <View style={styles.memberText}>
                    <Text numberOfLines={1} style={[styles.memberName, { color: colors.foreground }]}>
                      {member.name}
                    </Text>
                    {!!member.designation && (
                      <Text
                        numberOfLines={1}
                        style={[styles.memberDesignation, { color: colors.mutedForeground }]}
                      >
                        {member.designation}
                      </Text>
                    )}
                  </View>
                </View>
              ))
            )}
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          {/* ── About ── */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>About</Text>
            <Text style={[styles.aboutText, { color: colors.mutedForeground }]}>{description}</Text>
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
                  <View
                    key={tag}
                    style={[styles.tag, { borderColor: colors.border }]}
                  >
                    <Text style={[styles.tagText, { color: colors.mutedForeground }]}>{tag}</Text>
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
              <ActivityIndicator color={colors.accent} style={styles.membersSpinner} />
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
      </View>
    </Modal>
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
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 8,
  },
  heroName: { fontSize: 20, fontFamily: 'Geist_600SemiBold', flexShrink: 1, textAlign: 'center' },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  heroMeta: { fontSize: 12, fontFamily: 'Geist_400Regular' },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22C55E' },

  divider: { height: StyleSheet.hairlineWidth },

  section: { paddingHorizontal: 20, paddingVertical: 20 },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sectionTitle: { fontSize: 15, fontFamily: 'Geist_600SemiBold' },
  onlineText: { fontSize: 12, fontFamily: 'Geist_400Regular' },

  membersSpinner: { alignSelf: 'flex-start', marginTop: 12 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    marginTop: 4,
  },
  memberText: { flex: 1, minWidth: 0 },
  memberName: { fontSize: 15, fontFamily: 'Geist_500Medium' },
  memberDesignation: { fontSize: 12, fontFamily: 'Geist_400Regular', marginTop: 1 },

  aboutText: { fontSize: 14, lineHeight: 21, fontFamily: 'Geist_400Regular', marginTop: 12 },
  aboutRows: { marginTop: 14, gap: 8 },
  aboutRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aboutRowText: { fontSize: 14, fontFamily: 'Geist_400Regular' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  tag: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 4 },
  tagText: { fontSize: 12, fontFamily: 'Geist_400Regular' },

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
