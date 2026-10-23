import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { CompanyMark, CompanyVerifiedMark } from '@/components/companies/CompanyMark';
import { DmIcon } from '@/components/DmIcon';
import { PersonAvatar } from '@/components/PersonAvatar';
import { useColors } from '@/hooks/useColors';
import type { ProfileCompany } from '@/lib/profile';

/**
 * Another member's hero — the read-only reading of the web ProfileCard: display
 * picture, name, the role line with its workplace, city, bio and the outside
 * links as labeled chips. Messaging anyone starts here, so the Message chip is
 * the first action in the row; while the viewer has this member blocked the
 * row reduces to the blocked notice and its way back.
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
  blockedByMe: boolean;
  onMessage: () => void;
  onUnblock: () => void;
  unblocking?: boolean;
  /** Disable member actions until the server confirms profile access. */
  actionsDisabled?: boolean;
}

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

export function MemberProfileHero({
  name,
  avatarUrl,
  city,
  roleLabel,
  bio,
  company,
  linkedinUrl,
  portfolioUrl,
  blockedByMe,
  onMessage,
  onUnblock,
  unblocking,
  actionsDisabled = false,
}: Props) {
  const colors = useColors();
  const linkedin = externalUrl(linkedinUrl);
  const portfolio = externalUrl(portfolioUrl);

  return (
    <View style={styles.root}>
      <PersonAvatar
        name={name}
        url={avatarUrl}
        size={96}
        style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}
      />

      <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
        {name}
      </Text>

      {(roleLabel || company) && (
        <View style={styles.lineRow}>
          {roleLabel ? (
            <Text style={[styles.lineText, { color: colors.mutedForeground }]} numberOfLines={1}>
              {roleLabel}
            </Text>
          ) : null}
          {roleLabel && company ? (
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
        </View>
      )}

      {city ? (
        <View style={styles.lineRow}>
          <Feather name="map-pin" size={13} color={colors.mutedForeground} />
          <Text style={[styles.lineText, { color: colors.mutedForeground }]}>{city}</Text>
        </View>
      ) : null}

      {bio ? <Text style={[styles.bio, { color: colors.mutedForeground }]}>{bio}</Text> : null}

      <View style={styles.actionsRow}>
        {blockedByMe ? (
          <>
            <View
              style={[
                styles.blockedChip,
                { borderColor: colors.border, backgroundColor: colors.surface },
              ]}
            >
              <Feather name="slash" size={12} color={colors.destructive} />
              <Text style={[styles.blockedText, { color: colors.mutedForeground }]}>
                You blocked {name}. They can&apos;t message you or see your profile.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={unblocking || actionsDisabled}
              onPress={onUnblock}
              style={({ pressed }) => [
                styles.secondaryChip,
                {
                  borderColor: colors.border,
                  backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
                },
              ]}
            >
              <Text style={[styles.secondaryChipText, { color: colors.foreground }]}>
                {unblocking ? 'Unblocking…' : 'Unblock'}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Message ${name}`}
              disabled={actionsDisabled}
              onPress={onMessage}
              style={({ pressed }) => [
                styles.messageChip,
                {
                  backgroundColor: colors.chatOwnBubble,
                  opacity: actionsDisabled ? 0.5 : pressed ? 0.85 : 1,
                },
              ]}
            >
              <DmIcon size={12} color="#FFFFFF" />
              <Text style={styles.messageChipText}>Message</Text>
            </Pressable>

            {linkedin ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`${name} on LinkedIn`}
                onPress={() => openUrl(linkedin)}
                style={({ pressed }) => [
                  styles.secondaryChip,
                  {
                    borderColor: colors.border,
                    backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
                  },
                ]}
              >
                <Ionicons name="logo-linkedin" size={13} color={colors.foreground} />
                <Text style={[styles.secondaryChipText, { color: colors.foreground }]}>
                  LinkedIn
                </Text>
              </Pressable>
            ) : null}

            {portfolio ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`${name}'s portfolio`}
                onPress={() => openUrl(portfolio)}
                style={({ pressed }) => [
                  styles.secondaryChip,
                  {
                    borderColor: colors.border,
                    backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
                  },
                ]}
              >
                <Feather name="globe" size={13} color={colors.foreground} />
                <Text style={[styles.secondaryChipText, { color: colors.foreground }]}>
                  Portfolio
                </Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', paddingTop: 8 },
  name: {
    fontSize: 23,
    fontFamily: 'Geist_700Bold',
    letterSpacing: -0.3,
    textAlign: 'center',
    marginTop: 16,
    maxWidth: '100%',
  },
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
  bio: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: 'Geist_400Regular',
    textAlign: 'center',
    marginTop: 12,
    maxWidth: 480,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
  },
  messageChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  messageChipText: { color: '#FFFFFF', fontSize: 12, fontFamily: 'Geist_600SemiBold' },
  secondaryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  secondaryChipText: { fontSize: 12, fontFamily: 'Geist_500Medium' },
  blockedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 7,
    maxWidth: '100%',
  },
  blockedText: { fontSize: 12, fontFamily: 'Geist_400Regular', flexShrink: 1 },
});
