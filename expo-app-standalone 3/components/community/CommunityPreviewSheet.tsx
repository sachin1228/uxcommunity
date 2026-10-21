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
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { CommunityNameBadges, VerifiedDpBadge } from '@/components/communities/CommunityBadges';
import { communityNameBadges } from '@/lib/communityBadges';
import { Initials } from '@/components/communities/CommunityRow';
import { communityStore } from '@/lib/communityStore';
import { type CommunityPreviewData } from '@/lib/communityPreviewData';
import { getCommunityPreview, joinCommunity } from '@/lib/communityPreviewApi';
import { hapticSelection } from '@/lib/haptics';
import { resolveProfilePictureUri } from '@/lib/profilePicture';
import { communityDpShadow } from '@/constants/designSystem';

/**
 * The feed's "posted in …" popup — the mobile reading of the web
 * `CommunityPreviewModal` + `CommunityJoinDialog`.
 *
 * Tapping the community label on a home/profile/member card opens this sheet
 * in place instead of navigating away. It covers the same five states as the
 * web dialog, in the same order:
 *
 *   member    → "already a member", plus View community
 *   requested → "Request sent", plus Done
 *   closed    → the profile-gated notice (no action that cannot work)
 *   open      → About, a private notice when relevant, Join / Request to join
 *   gone      → the deleted-community notice (posts stay in feeds)
 *
 * The fetch is live on every open, so the sheet is the authority on the
 * viewer's standing; joining refreshes the communities list in place.
 */

interface Props {
  visible: boolean;
  communityId: string | null;
  onClose: () => void;
}

export function CommunityPreviewSheet({ visible, communityId, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [preview, setPreview] = useState<CommunityPreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // A live read on every open — the feed's snapshot of the community may be
  // older than the viewer's membership or a request sent elsewhere.
  useEffect(() => {
    if (!visible || !communityId) return;
    let cancelled = false;
    setPreview(null);
    setDeleted(false);
    setLoadError(null);
    setActionError(null);
    setSubmitting(false);
    setLoading(true);

    void (async () => {
      try {
        const data = await getCommunityPreview(communityId);
        if (cancelled) return;
        if (data) setPreview(data);
        else setDeleted(true);
      } catch (e) {
        if (cancelled) return;
        setLoadError(
          e instanceof Error ? e.message : "Couldn't load this community. Please try again.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, communityId, reloadToken]);

  const openCommunity = (data: CommunityPreviewData) => {
    const params = new URLSearchParams({
      name: data.name,
      type: data.type,
      private: data.is_private ? '1' : '0',
      members: String(data.member_count),
    });
    if (data.image_url) params.set('image', data.image_url);
    onClose();
    router.push(`/community/${data.id}?${params.toString()}`);
  };

  const submit = async () => {
    if (!preview || submitting) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const outcome = await joinCommunity(preview.id);
      communityStore.notifyCommunityChanged({ kind: 'refresh' });
      if (outcome === 'requested') {
        setPreview({ ...preview, has_pending_request: true });
        setSubmitting(false);
      } else {
        setPreview({ ...preview, joined: true });
        // Web parity: a fresh join lands in the community's chat.
        openCommunity({ ...preview, joined: true });
      }
    } catch (e) {
      setSubmitting(false);
      setActionError(
        e instanceof Error ? e.message : 'Something went wrong. Please try again.',
      );
    }
  };

  const close = () => {
    if (submitting) return;
    onClose();
  };

  const imageUri = resolveProfilePictureUri(preview?.image_url);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={close}
    >
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close community preview">
        <Pressable
          onPress={() => undefined}
          style={[
            styles.sheet,
            {
              backgroundColor: colors.overlayElevated,
              borderColor: colors.borderSubtle,
              paddingBottom: insets.bottom + 18,
            },
          ]}
        >
          <View style={styles.grabberRow}>
            <View style={[styles.grabber, { backgroundColor: colors.border }]} />
            <Pressable
              onPress={close}
              style={styles.closeButton}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close community preview"
            >
              <Feather name="x" size={20} color={colors.foregroundSubtle} />
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : deleted ? (
            <View style={styles.state}>
              <Feather name="alert-circle" size={30} color={colors.foregroundSubtle} />
              <Text style={[styles.stateTitle, { color: colors.foregroundMuted }]}>
                This community was deleted
              </Text>
              <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>
                Posts from it stay in your feed, but there&apos;s no community to open or join
                anymore.
              </Text>
              <Pressable
                onPress={close}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.secondaryButton,
                  {
                    borderColor: colors.border,
                    backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
                  },
                ]}
              >
                <Text style={[styles.secondaryButtonText, { color: colors.foregroundMuted }]}>
                  Close
                </Text>
              </Pressable>
            </View>
          ) : loadError ? (
            <View style={styles.state}>
              <Feather name="wifi-off" size={28} color={colors.foregroundSubtle} />
              <Text style={[styles.stateTitle, { color: colors.foregroundMuted }]}>
                Couldn&apos;t load this community
              </Text>
              <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>{loadError}</Text>
              <Pressable
                onPress={() => setReloadToken((value) => value + 1)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.secondaryButton,
                  {
                    borderColor: colors.border,
                    backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
                  },
                ]}
              >
                <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>
                  Try again
                </Text>
              </Pressable>
            </View>
          ) : preview ? (
            <>
              <View style={styles.identity}>
                <View style={styles.avatarWrap}>
                  {imageUri ? (
                    <Image source={{ uri: imageUri }} style={styles.avatar} />
                  ) : (
                    <Initials name={preview.name} size={64} colors={colors} />
                  )}
                  {communityNameBadges(preview.type, preview.is_private).verified && (
                    <VerifiedDpBadge dpSize={64} />
                  )}
                </View>
                <View style={styles.identityCopy}>
                  <View style={styles.nameRow}>
                    <Text
                      style={[styles.name, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {preview.name}
                    </Text>
                    <CommunityNameBadges type={preview.type} isPrivate={preview.is_private} size={13} />
                  </View>
                  <View style={styles.memberRow}>
                    <Feather name="users" size={12} color={colors.foregroundMuted} />
                    <Text style={[styles.memberText, { color: colors.foregroundMuted }]}>
                      {preview.member_count.toLocaleString()}{' '}
                      {preview.member_count === 1 ? 'member' : 'members'}
                    </Text>
                  </View>
                </View>
              </View>

              {preview.joined ? (
                <>
                  <View
                    style={[
                      styles.notice,
                      { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
                    ]}
                  >
                    <Feather name="check-circle" size={14} color={colors.accent} />
                    <Text style={[styles.noticeText, { color: colors.foregroundMuted }]}>
                      You&apos;re already a member of this community.
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      hapticSelection();
                      openCommunity(preview);
                    }}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.primaryButton,
                      { backgroundColor: pressed ? colors.accentHover : colors.accent },
                    ]}
                  >
                    <Text style={[styles.primaryButtonText, { color: colors.accentForeground }]}>
                      View community
                    </Text>
                  </Pressable>
                </>
              ) : preview.has_pending_request ? (
                <View style={styles.state}>
                  <View style={[styles.stateIcon, { backgroundColor: colors.accentSoft }]}>
                    <Feather name="check-circle" size={22} color={colors.accent} />
                  </View>
                  <Text style={[styles.requestTitle, { color: colors.foreground }]}>
                    Request sent
                  </Text>
                  <Text style={[styles.stateBody, { color: colors.foregroundMuted }]}>
                    Your request to join {preview.name} has been sent. We&apos;ll notify you once
                    an owner accepts it.
                  </Text>
                  <Pressable
                    onPress={close}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.primaryButton,
                      { backgroundColor: pressed ? colors.accentHover : colors.accent },
                    ]}
                  >
                    <Text style={[styles.primaryButtonText, { color: colors.accentForeground }]}>
                      Done
                    </Text>
                  </Pressable>
                </View>
              ) : !preview.can_join ? (
                <>
                  <View
                    style={[
                      styles.notice,
                      { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
                    ]}
                  >
                    <Feather name="lock" size={14} color={colors.foregroundSubtle} />
                    <Text style={[styles.noticeText, { color: colors.foregroundMuted }]}>
                      An official community built from member profiles — only members whose profile
                      matches can join.{' '}
                      {preview.is_private
                        ? 'Update your profile to match, then request to join.'
                        : "Update your profile to match and you'll join automatically."}
                    </Text>
                  </View>
                  <Pressable
                    onPress={close}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.secondaryButton,
                      {
                        borderColor: colors.border,
                        backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
                      },
                    ]}
                  >
                    <Text style={[styles.secondaryButtonText, { color: colors.foregroundMuted }]}>
                      Close
                    </Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <ScrollView style={styles.aboutScroll} contentContainerStyle={styles.aboutContent}>
                    {preview.description ? (
                      <View>
                        <Text style={[styles.aboutLabel, { color: colors.foregroundSubtle }]}>
                          ABOUT
                        </Text>
                        <Text style={[styles.about, { color: colors.foregroundMuted }]}>
                          {preview.description}
                        </Text>
                      </View>
                    ) : null}

                    {preview.is_private ? (
                      <View
                        style={[
                          styles.notice,
                          { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
                        ]}
                      >
                        <Feather name="lock" size={14} color={colors.foregroundSubtle} />
                        <Text style={[styles.noticeText, { color: colors.foregroundMuted }]}>
                          This is a private community. You&apos;ll need to request to join — an
                          owner or admin reviews every request before you can enter.
                        </Text>
                      </View>
                    ) : null}

                    {actionError ? (
                      <Text style={[styles.error, { color: colors.destructive }]}>{actionError}</Text>
                    ) : null}
                  </ScrollView>

                  <Pressable
                    onPress={() => {
                      hapticSelection();
                      void submit();
                    }}
                    disabled={submitting}
                    accessibilityRole="button"
                    accessibilityState={{ busy: submitting }}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      {
                        backgroundColor: pressed ? colors.accentHover : colors.accent,
                        opacity: submitting ? 0.6 : 1,
                      },
                    ]}
                  >
                    {submitting ? (
                      <ActivityIndicator size="small" color={colors.accentForeground} />
                    ) : null}
                    <Text style={[styles.primaryButtonText, { color: colors.accentForeground }]}>
                      {preview.is_private
                        ? submitting
                          ? 'Sending…'
                          : 'Request to join'
                        : submitting
                          ? 'Joining…'
                          : 'Join community'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={close}
                    disabled={submitting}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.secondaryButton,
                      {
                        borderColor: colors.border,
                        backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
                        opacity: submitting ? 0.6 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.secondaryButtonText, { color: colors.foregroundMuted }]}>
                      Cancel
                    </Text>
                  </Pressable>
                </>
              )}
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 8,
    maxHeight: '88%',
  },
  grabberRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 32 },
  grabber: { width: 36, height: 4, borderRadius: 2 },
  closeButton: {
    position: 'absolute',
    right: 0,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { minHeight: 180, alignItems: 'center', justifyContent: 'center' },
  state: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 22 },
  stateIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 16, textAlign: 'center' },
  stateBody: {
    fontFamily: 'Geist_400Regular',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 330,
  },
  requestTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 17 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 10 },
  avatarWrap: { position: 'relative' },
  avatar: { width: 64, height: 64, borderRadius: 16, ...communityDpShadow },
  identityCopy: { flex: 1, gap: 5 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontFamily: 'Geist_600SemiBold', fontSize: 18, flexShrink: 1 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  memberText: { fontFamily: 'Geist_400Regular', fontSize: 12.5 },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 16,
  },
  noticeText: { fontFamily: 'Geist_400Regular', fontSize: 12.5, lineHeight: 18, flex: 1 },
  aboutScroll: { marginTop: 16, flexGrow: 0, maxHeight: 220 },
  aboutContent: { gap: 12 },
  aboutLabel: { fontFamily: 'Geist_600SemiBold', fontSize: 11, letterSpacing: 0.8 },
  about: { fontFamily: 'Geist_400Regular', fontSize: 13.5, lineHeight: 20, marginTop: 6 },
  error: { fontFamily: 'Geist_400Regular', fontSize: 12.5, lineHeight: 18 },
  primaryButton: {
    minHeight: 46,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 16,
    alignSelf: 'stretch',
  },
  primaryButtonText: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  secondaryButton: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginTop: 10,
    alignSelf: 'stretch',
  },
  secondaryButtonText: { fontFamily: 'Geist_500Medium', fontSize: 14 },
});
