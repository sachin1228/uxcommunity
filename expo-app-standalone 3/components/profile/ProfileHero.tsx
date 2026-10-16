import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { CompanyMark, CompanyVerifiedMark } from '@/components/companies/CompanyMark';
import { PersonAvatar } from '@/components/PersonAvatar';
import { useColors } from '@/hooks/useColors';
import type { ProfileCompany } from '@/lib/profile';

/**
 * The profile hero — the mobile reading of the web hero's own-profile
 * surface: the display picture (the only image), the name with Edit pinned to
 * the right edge, the role line ("Mid-Level Product Designer @ Figma"), the
 * city, the LinkedIn and portfolio circles, and the bio. No cover, no card
 * chrome; the hero sits directly on the page.
 *
 * Owner's surface only: the circles are hollow until a link is saved (they
 * open the add prompt), then live buttons out; with no workplace yet, the
 * role line offers the web's "Add your company" pill.
 */

interface Props {
  name: string;
  avatarUrl: string | null;
  city: string | null;
  roleLabel: string | null;
  bio: string;
  company: ProfileCompany | null;
  linkedinUrl: string;
  portfolioUrl: string;
  onPressAvatar: () => void;
  onAddLinkedIn: () => void;
  onAddPortfolio: () => void;
  /** Opens the "Where do you work?" picker. Omitted to hide the pill. */
  onAddCompany?: () => void;
  onEdit: () => void;
}

/** Only http(s) survives — the `https://` prefix is added when left off. */
function externalUrl(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return /^https?:\/\/[^\s]+$/i.test(candidate) ? candidate : null;
}

function openUrl(value: string | null | undefined) {
  const url = externalUrl(value);
  if (url) void Linking.openURL(url).catch(() => {});
}

export function ProfileHero({
  name,
  avatarUrl,
  city,
  roleLabel,
  bio,
  company,
  linkedinUrl,
  portfolioUrl,
  onPressAvatar,
  onAddLinkedIn,
  onAddPortfolio,
  onAddCompany,
  onEdit,
}: Props) {
  const colors = useColors();

  const linkedin = externalUrl(linkedinUrl);
  const portfolio = externalUrl(portfolioUrl);

  return (
    <View style={styles.root}>
      {/* ── Display picture — tap to change it ── */}
      <Pressable
        onPress={onPressAvatar}
        accessibilityRole="button"
        accessibilityLabel="Change profile picture"
        style={styles.avatarWrap}
      >
        <PersonAvatar
          name={name}
          url={avatarUrl}
          size={96}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}
        />
        <View
          style={[
            styles.cameraBadge,
            { backgroundColor: colors.background, borderColor: colors.border },
          ]}
        >
          <Feather name="camera" size={13} color={colors.foregroundMuted} />
        </View>
      </Pressable>

      {/* ── Name row — Edit pinned to the right edge, name stays centred ── */}
      <View style={styles.nameRow}>
        <View style={styles.nameSide} />
        <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
          {name}
        </Text>
        <View style={[styles.nameSide, styles.editSide]}>
          <Pressable
            onPress={onEdit}
            accessibilityRole="button"
            accessibilityLabel="Edit profile"
            style={({ pressed }) => [
              styles.editPill,
              {
                borderColor: colors.border,
                backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
              },
            ]}
          >
            <Text style={[styles.editLabel, { color: colors.foreground }]}>Edit</Text>
          </Pressable>
        </View>
      </View>

      {/* ── Role line — seniority + designation, then "@ workplace", or the
          hollow "Add your company" pill when none is set ── */}
      {(roleLabel || company || onAddCompany) && (
        <View style={styles.lineRow}>
          {roleLabel ? (
            <Text style={[styles.lineText, { color: colors.mutedForeground }]} numberOfLines={1}>
              {roleLabel}
            </Text>
          ) : null}
          {roleLabel && (company || onAddCompany) ? (
            <Text style={[styles.lineText, { color: colors.mutedForeground }]}>@</Text>
          ) : null}
          {company ? (
            <View style={styles.companyRow}>
              <CompanyMark name={company.name} logoUrl={company.logoUrl} size={16} />
              <Text
                style={[styles.lineText, { color: colors.mutedForeground }]}
                numberOfLines={1}
              >
                {company.name}
              </Text>
              {company.isActive && company.domainVerified ? (
                <CompanyVerifiedMark size={11} color={colors.accent} />
              ) : null}
            </View>
          ) : null}
          {!company && onAddCompany ? (
            <Pressable
              onPress={onAddCompany}
              accessibilityRole="button"
              accessibilityLabel="Add your company"
              style={({ pressed }) => [
                styles.addCompanyPill,
                {
                  borderColor: colors.border,
                  backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
                },
              ]}
            >
              <Feather name="plus" size={12} color={colors.mutedForeground} />
              <Text style={[styles.addCompanyLabel, { color: colors.mutedForeground }]}>
                Add your company
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {/* ── City — omitted when unset, rather than leaving an empty line ── */}
      {city ? (
        <View style={styles.lineRow}>
          <Feather name="map-pin" size={13} color={colors.mutedForeground} />
          <Text style={[styles.lineText, { color: colors.mutedForeground }]}>{city}</Text>
        </View>
      ) : null}

      {/* ── LinkedIn and portfolio — hollow until saved, then live ── */}
      <View style={styles.circlesRow}>
        <Pressable
          onPress={() => (linkedin ? openUrl(linkedin) : onAddLinkedIn())}
          accessibilityRole="button"
          accessibilityLabel={linkedin ? 'LinkedIn profile' : 'Add your LinkedIn'}
          style={({ pressed }) => [
            styles.linkCircle,
            linkedin ? styles.linkCircleLive : styles.linkCircleEmpty,
            {
              borderColor: colors.border,
              backgroundColor: linkedin ? colors.surfaceRaised : 'transparent',
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Ionicons name="logo-linkedin" size={15} color={linkedin ? colors.foreground : colors.mutedForeground} />
        </Pressable>

        <Pressable
          onPress={() => (portfolio ? openUrl(portfolio) : onAddPortfolio())}
          accessibilityRole="button"
          accessibilityLabel={portfolio ? 'Portfolio' : 'Add your portfolio'}
          style={({ pressed }) => [
            styles.linkCircle,
            portfolio ? styles.linkCircleLive : styles.linkCircleEmpty,
            {
              borderColor: colors.border,
              backgroundColor: portfolio ? colors.surfaceRaised : 'transparent',
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Feather name="globe" size={15} color={portfolio ? colors.foreground : colors.mutedForeground} />
        </Pressable>
      </View>

      {/* ── Bio — hidden while empty ── */}
      {bio ? (
        <Text style={[styles.bio, { color: colors.mutedForeground }]}>{bio}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', paddingTop: 8 },
  avatarWrap: { marginBottom: 16 },
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', gap: 12 },
  nameSide: { flex: 1 },
  editSide: { alignItems: 'flex-end' },
  name: {
    fontSize: 23,
    fontFamily: 'Geist_700Bold',
    letterSpacing: -0.3,
    textAlign: 'center',
    flexShrink: 1,
  },
  editPill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  editLabel: { fontSize: 12, fontFamily: 'Geist_500Medium' },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 6,
    maxWidth: '100%',
  },
  lineText: { fontSize: 14, fontFamily: 'Geist_400Regular', flexShrink: 1 },
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  addCompanyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexShrink: 0,
  },
  addCompanyLabel: { fontSize: 12, fontFamily: 'Geist_400Regular' },
  circlesRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  linkCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkCircleLive: { borderWidth: StyleSheet.hairlineWidth },
  linkCircleEmpty: { borderWidth: 1, borderStyle: 'dashed' },
  bio: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: 'Geist_400Regular',
    textAlign: 'center',
    marginTop: 12,
    maxWidth: 480,
  },
});
