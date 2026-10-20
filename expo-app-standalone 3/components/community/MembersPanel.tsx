import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { PersonAvatar } from '@/components/PersonAvatar';
import { MemberActionsSheet } from '@/components/community/MemberActionsSheet';
import { ModeratorPermissionsModal } from '@/components/community/ModeratorPermissionsModal';
import {
  acceptCommunityJoinRequest,
  declineCommunityJoinRequest,
  getCommunityJoinRequests,
  getCommunityMembersDetailed,
  getEventJoinResponses,
  removeCommunityMember,
  updateCommunityMemberRole,
  type CommunityJoinRequest,
  type CommunityMemberRow,
} from '@/lib/communities';
import { timeAgo } from '@/lib/communityActivity';
import { EVENT_JOIN_QUESTIONS } from '@/lib/eventJoinQuestions';
import {
  MODERATOR_DEFAULT_PERMISSIONS,
  NO_COMMUNITY_PERMISSIONS,
  type CommunityPermissions,
} from '@/lib/communityPermissions';
import { hapticSelection } from '@/lib/haptics';

/**
 * The Members tab — the mobile port of the web MembersView: search, pending
 * join requests for private communities, role badges, and (for the manager
 * tier) the per-row actions that appoint moderators, edit their grants,
 * dismiss them or remove members. Event group chats also expose each
 * member's recorded answers to the host's join questions.
 */

interface Props {
  communityId: string;
  isPrivate: boolean;
  isEventChat: boolean;
  currentUserId: string;
  isOwner: boolean;
  /** Owner or manager granted "manage members". */
  canManageMembers: boolean;
  /** Owner or platform-appointed admin — appoints/edits/dismisses moderators. */
  canManageModerators: boolean;
  /** The hero + tab strip, rendered above this tab's own content. */
  header: React.ReactNode;
}

const ROLE_RANK: Record<string, number> = { owner: 0, admin: 1, moderator: 2, member: 3 };

interface ModeratorTarget {
  member: CommunityMemberRow;
  mode: 'promote' | 'edit';
}

export function MembersPanel({
  communityId,
  isPrivate,
  isEventChat,
  currentUserId,
  isOwner,
  canManageMembers,
  canManageModerators,
  header,
}: Props) {
  const colors = useColors();
  const router = useRouter();

  // Web parity: anyone on the management ladder sees the requests section and
  // the row menus, each action still scoped by its own capability.
  const manager = isOwner || canManageMembers || canManageModerators;

  const [members, setMembers] = useState<CommunityMemberRow[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const [requests, setRequests] = useState<CommunityJoinRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsLoaded, setRequestsLoaded] = useState(false);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [busyRequestAction, setBusyRequestAction] = useState<'accept' | 'decline' | null>(null);

  const [joinResponses, setJoinResponses] = useState<Map<string, { why_attend: string; expectations: string }>>(
    new Map()
  );
  const [expandedAnswersFor, setExpandedAnswersFor] = useState<string | null>(null);

  const [actionMember, setActionMember] = useState<CommunityMemberRow | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [moderatorTarget, setModeratorTarget] = useState<ModeratorTarget | null>(null);
  const [moderatorSaving, setModeratorSaving] = useState(false);
  const [moderatorError, setModeratorError] = useState<string | null>(null);

  const inFlight = useRef(false);

  // Debounce the server-side name search (web uses 300ms).
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const loadPage0 = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await getCommunityMembersDetailed(communityId, 0, debouncedQuery);
      setMembers(result.members);
      setHasMore(result.hasMore);
      setTotal(result.total);
      setPage(0);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load members.');
    } finally {
      setLoading(false);
    }
  }, [communityId, debouncedQuery]);

  useEffect(() => {
    void loadPage0();
  }, [loadPage0]);

  // Pending requests — private communities, manager tier only.
  useEffect(() => {
    if (!manager || !isPrivate) {
      setRequests([]);
      setRequestsLoaded(true);
      return undefined;
    }
    let cancelled = false;
    setRequestsLoading(true);
    getCommunityJoinRequests(communityId)
      .then((rows) => {
        if (!cancelled) setRequests(rows);
      })
      .catch(() => {
        /* the section simply stays empty; a retry happens on reopen */
      })
      .finally(() => {
        if (!cancelled) {
          setRequestsLoading(false);
          setRequestsLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [communityId, manager, isPrivate]);

  // Join-question answers — event rooms, manager tier only.
  useEffect(() => {
    if (!manager || !isEventChat) return undefined;
    let cancelled = false;
    getEventJoinResponses(communityId)
      .then((rows) => {
        if (cancelled) return;
        setJoinResponses(new Map(rows.map((row) => [row.user_id, row])));
      })
      .catch(() => {
        if (!cancelled) setJoinResponses(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [communityId, manager, isEventChat]);

  const loadMore = useCallback(async () => {
    if (inFlight.current || loadingMore || loading || !hasMore) return;
    inFlight.current = true;
    setLoadingMore(true);
    const nextPage = page + 1;
    try {
      const result = await getCommunityMembersDetailed(communityId, nextPage, debouncedQuery);
      setMembers((prev) => {
        const seen = new Set(prev.map((member) => member.user_id));
        return [...prev, ...result.members.filter((member) => !seen.has(member.user_id))];
      });
      setPage(nextPage);
      setHasMore(result.hasMore);
      setTotal(result.total);
    } catch {
      /* keep what is loaded; the next scroll retries */
    } finally {
      inFlight.current = false;
      setLoadingMore(false);
    }
  }, [communityId, debouncedQuery, hasMore, loading, loadingMore, page]);

  const applyMemberUpdate = useCallback((userId: string, patch: Partial<CommunityMemberRow>) => {
    setMembers((prev) =>
      prev.map((member) => (member.user_id === userId ? { ...member, ...patch } : member))
    );
  }, []);

  const handleAccept = useCallback(
    async (request: CommunityJoinRequest) => {
      if (busyRequestId) return;
      setBusyRequestId(request.id);
      setBusyRequestAction('accept');
      try {
        await acceptCommunityJoinRequest(communityId, request.id);
        setRequests((prev) => prev.filter((row) => row.id !== request.id));
        setMembers((prev) =>
          prev.some((member) => member.user_id === request.user_id)
            ? prev
            : [
                ...prev,
                {
                  user_id: request.user_id,
                  name: request.name,
                  avatar_url: request.avatar_url,
                  designation: null,
                  joined_at: new Date().toISOString(),
                  role: 'member',
                },
              ]
        );
        setTotal((prev) => prev + 1);
      } catch (e) {
        Alert.alert('Could not accept request', e instanceof Error ? e.message : 'Please try again.');
      } finally {
        setBusyRequestId(null);
        setBusyRequestAction(null);
      }
    },
    [busyRequestId, communityId]
  );

  const handleDecline = useCallback(
    async (request: CommunityJoinRequest) => {
      if (busyRequestId) return;
      setBusyRequestId(request.id);
      setBusyRequestAction('decline');
      try {
        await declineCommunityJoinRequest(communityId, request.id);
        setRequests((prev) => prev.filter((row) => row.id !== request.id));
      } catch (e) {
        Alert.alert('Could not decline request', e instanceof Error ? e.message : 'Please try again.');
      } finally {
        setBusyRequestId(null);
        setBusyRequestAction(null);
      }
    },
    [busyRequestId, communityId]
  );

  const handleSaveModerator = useCallback(
    async (permissions: CommunityPermissions) => {
      if (!moderatorTarget || moderatorSaving) return;
      setModeratorSaving(true);
      setModeratorError(null);
      try {
        const saved = await updateCommunityMemberRole(communityId, moderatorTarget.member.user_id, {
          role: 'moderator',
          permissions,
        });
        applyMemberUpdate(moderatorTarget.member.user_id, {
          role: 'moderator',
          permissions: saved.permissions ?? permissions,
        });
        setActionMember((prev) =>
          prev && prev.user_id === moderatorTarget.member.user_id
            ? { ...prev, role: 'moderator', permissions: saved.permissions ?? permissions }
            : prev
        );
        setModeratorTarget(null);
      } catch (e) {
        setModeratorError(e instanceof Error ? e.message : 'Failed to save permissions. Try again.');
      } finally {
        setModeratorSaving(false);
      }
    },
    [applyMemberUpdate, communityId, moderatorSaving, moderatorTarget]
  );

  const handleDismissModerator = useCallback(async () => {
    if (!actionMember || actionBusy) return;
    setActionBusy(true);
    try {
      await updateCommunityMemberRole(communityId, actionMember.user_id, { role: 'member' });
      applyMemberUpdate(actionMember.user_id, { role: 'member', permissions: null });
      setActionMember(null);
    } catch (e) {
      Alert.alert(
        'Could not dismiss moderator',
        e instanceof Error ? e.message : 'Please try again.'
      );
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, actionMember, applyMemberUpdate, communityId]);

  const handleRemoveMember = useCallback(async () => {
    if (!actionMember || actionBusy) return;
    setActionBusy(true);
    try {
      await removeCommunityMember(communityId, actionMember.user_id);
      setMembers((prev) => prev.filter((member) => member.user_id !== actionMember.user_id));
      setTotal((prev) => Math.max(0, prev - 1));
      setActionMember(null);
    } catch (e) {
      Alert.alert(
        'Could not remove member',
        e instanceof Error ? e.message : 'Please try again.'
      );
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, actionMember, communityId]);

  const openMember = useCallback(
    (userId: string) => {
      if (userId === currentUserId) {
        router.push('/profile');
        return;
      }
      router.push({ pathname: '/member/[id]', params: { id: userId } });
    },
    [currentUserId, router]
  );

  const orderedMembers = useMemo(
    () =>
      [...members].sort(
        (a, b) => (ROLE_RANK[a.role] ?? 3) - (ROLE_RANK[b.role] ?? 3)
      ),
    [members]
  );

  const actionCapabilities = useMemo(() => {
    if (!actionMember) return { canRemove: false, canModerate: false };
    const role = actionMember.role;
    const isSelf = actionMember.user_id === currentUserId;
    // Owner may remove moderators and admins; an app-created admin may remove
    // moderators (platform admins stay off limits). Never yourself or the owner.
    const canRemove =
      (isOwner || canManageMembers) &&
      !isSelf &&
      role !== 'owner' &&
      !(role === 'admin' && !isOwner) &&
      !(role === 'moderator' && !canManageModerators);
    const canModerate =
      canManageModerators && !isSelf && role !== 'owner' && role !== 'admin';
    return { canRemove, canModerate };
  }, [actionMember, canManageMembers, canManageModerators, currentUserId, isOwner]);

  const renderMember = ({ item: member }: { item: CommunityMemberRow }) => {
    const role = member.role;
    const isSelf = member.user_id === currentUserId;
    const canRemoveRow =
      (isOwner || canManageMembers) &&
      !isSelf &&
      role !== 'owner' &&
      !(role === 'admin' && !isOwner) &&
      !(role === 'moderator' && !canManageModerators);
    const canModerateRow =
      canManageModerators && !isSelf && role !== 'owner' && role !== 'admin';
    const answers = joinResponses.get(member.user_id);
    const expanded = expandedAnswersFor === member.user_id;

    return (
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${member.name}. Open profile`}
          onPress={() => openMember(member.user_id)}
          style={({ pressed }) => [
            styles.memberRow,
            pressed && { backgroundColor: colors.surfaceRaised },
          ]}
        >
          <PersonAvatar name={member.name} url={member.avatar_url} size={40} />
          <View style={styles.memberText}>
            <View style={styles.nameRow}>
              <Text numberOfLines={1} style={[styles.memberName, { color: colors.foreground }]}>
                {member.name}
              </Text>
              {role === 'owner' ? (
                <RoleChip label="OWNER" tone="accent" colors={colors} />
              ) : role === 'admin' ? (
                <RoleChip label="ADMIN" tone="amber" colors={colors} />
              ) : role === 'moderator' ? (
                <RoleChip label="MODERATOR" tone="sky" colors={colors} />
              ) : null}
            </View>
            {member.designation ? (
              <Text
                numberOfLines={1}
                style={[styles.memberDesignation, { color: colors.mutedForeground }]}
              >
                {member.designation}
              </Text>
            ) : null}
          </View>
          {manager && (canRemoveRow || canModerateRow) ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${member.name} options`}
              hitSlop={8}
              onPress={(event) => {
                event.stopPropagation?.();
                hapticSelection();
                setActionMember(member);
              }}
              style={({ pressed }) => [
                styles.moreButton,
                pressed && { backgroundColor: colors.surfaceRaised },
              ]}
            >
              <Feather name="more-vertical" size={16} strokeWidth={2.5} color={colors.mutedForeground} />
            </Pressable>
          ) : (
            <Feather name="chevron-right" size={16} color={colors.foregroundSubtle} />
          )}
        </Pressable>

        {isEventChat && manager ? (
          <View style={styles.answersWrap}>
            {answers ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  onPress={() =>
                    setExpandedAnswersFor(expanded ? null : member.user_id)
                  }
                  style={styles.answersToggle}
                >
                  <Feather name="clipboard" size={12} strokeWidth={2.5} color={colors.accent} />
                  <Text style={[styles.answersToggleText, { color: colors.accent }]}>
                    {expanded ? 'Hide join answers' : 'View join answers'}
                  </Text>
                </Pressable>
                {expanded ? (
                  <View
                    style={[
                      styles.answersCard,
                      { borderColor: colors.border, backgroundColor: colors.surfaceRaised },
                    ]}
                  >
                    {EVENT_JOIN_QUESTIONS.map(({ key, label }) => (
                      <View key={key} style={styles.answerBlock}>
                        <Text style={[styles.answerLabel, { color: colors.mutedForeground }]}>
                          {label.toUpperCase()}
                        </Text>
                        <Text style={[styles.answerText, { color: colors.foreground }]}>
                          {answers[key]}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </>
            ) : (
              <View style={styles.answersToggle}>
                <Feather name="clipboard" size={12} strokeWidth={2.5} color={colors.foregroundSubtle} />
                <Text style={[styles.answersToggleText, { color: colors.foregroundSubtle }]}>
                  No join answers recorded
                </Text>
              </View>
            )}
          </View>
        ) : null}
      </View>
    );
  };

  const listHeader = (
    <View>
      {header}

      {/* Search — server-side, matching web MembersView. */}
      <View style={styles.searchWrap}>
        <View
          style={[
            styles.searchField,
            { borderColor: colors.border, backgroundColor: colors.card },
          ]}
        >
          <Feather name="search" size={14} strokeWidth={2.5} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search members…"
            placeholderTextColor={colors.mutedForeground}
            accessibilityLabel="Search members"
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.searchInput, { color: colors.foreground }]}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
              <Feather name="x" size={14} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Pending join requests — private communities, manager tier. */}
      {manager && isPrivate && (requestsLoading || (requestsLoaded && requests.length > 0)) ? (
        <View style={styles.requestsSection}>
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
              PENDING REQUESTS
            </Text>
            {requests.length > 0 ? (
              <View style={[styles.countPill, { backgroundColor: colors.accentSoft }]}>
                <Text style={[styles.countPillText, { color: colors.accent }]}>
                  {requests.length}
                </Text>
              </View>
            ) : null}
          </View>

          {requestsLoading ? (
            <View style={styles.requestsLoading}>
              <ActivityIndicator size="small" color={colors.accent} />
            </View>
          ) : (
            requests.map((request) => (
              <View
                key={request.id}
                style={[
                  styles.requestRow,
                  { backgroundColor: colors.surfaceRaised },
                ]}
              >
                <PersonAvatar name={request.name} url={request.avatar_url} size={36} />
                <View style={styles.requestBody}>
                  <Pressable onPress={() => openMember(request.user_id)}>
                    <Text
                      numberOfLines={1}
                      style={[styles.requestName, { color: colors.foreground }]}
                    >
                      {request.name}
                    </Text>
                  </Pressable>
                  <Text style={[styles.requestMeta, { color: colors.mutedForeground }]}>
                    Requested to join {timeAgo(request.requested_at)}
                  </Text>
                  {request.request_message ? (
                    <View
                      style={[
                        styles.requestMessage,
                        { borderColor: colors.border, backgroundColor: colors.surface },
                      ]}
                    >
                      <Text style={[styles.requestMessageText, { color: colors.mutedForeground }]}>
                        “{request.request_message}”
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.requestActions}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void handleAccept(request)}
                      disabled={busyRequestId === request.id}
                      style={({ pressed }) => [
                        styles.acceptButton,
                        {
                          borderColor: 'rgba(34,197,94,0.3)',
                          backgroundColor: pressed ? 'rgba(34,197,94,0.24)' : 'rgba(34,197,94,0.12)',
                          opacity: busyRequestId === request.id ? 0.6 : 1,
                        },
                      ]}
                    >
                      {busyRequestId === request.id && busyRequestAction === 'accept' ? (
                        <ActivityIndicator size="small" color={colors.success} />
                      ) : (
                        <>
                          <Feather name="check" size={11} strokeWidth={2.5} color={colors.success} />
                          <Text style={[styles.acceptText, { color: colors.success }]}>Accept</Text>
                        </>
                      )}
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void handleDecline(request)}
                      disabled={busyRequestId === request.id}
                      style={({ pressed }) => [
                        styles.declineButton,
                        {
                          borderColor: colors.border,
                          backgroundColor: pressed ? colors.surface : 'transparent',
                          opacity: busyRequestId === request.id ? 0.6 : 1,
                        },
                      ]}
                    >
                      {busyRequestId === request.id && busyRequestAction === 'decline' ? (
                        <ActivityIndicator size="small" color={colors.mutedForeground} />
                      ) : (
                        <>
                          <Feather name="x" size={11} strokeWidth={2.5} color={colors.mutedForeground} />
                          <Text style={[styles.declineText, { color: colors.mutedForeground }]}>
                            Decline
                          </Text>
                        </>
                      )}
                    </Pressable>
                  </View>
                </View>
              </View>
            ))
          )}
          <View style={[styles.requestsDivider, { backgroundColor: colors.border }]} />
        </View>
      ) : null}

      {manager && !debouncedQuery ? (
        <Text style={[styles.membersLabel, { color: colors.mutedForeground }]}>MEMBERS</Text>
      ) : null}

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : null}

      {loadError && !loading ? (
        <View style={styles.errorWrap}>
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>{loadError}</Text>
          <Pressable
            onPress={() => void loadPage0()}
            style={[styles.retryButton, { borderColor: colors.border }]}
          >
            <Text style={[styles.retryText, { color: colors.foreground }]}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      {!loading && !loadError && members.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Feather name="users" size={30} strokeWidth={2.5} color={colors.foregroundSubtle} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            {debouncedQuery ? 'No members match your search.' : 'No members yet.'}
          </Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.root}>
      <FlatList
        data={loading || loadError ? [] : orderedMembers}
        keyExtractor={(member) => member.user_id}
        renderItem={renderMember}
        ListHeaderComponent={listHeader}
        ListFooterComponent={
          <View>
            {loadingMore ? (
              <View style={styles.loadingMore}>
                <ActivityIndicator size="small" color={colors.accent} />
              </View>
            ) : null}
            {!loading && !hasMore && members.length > 0 ? (
              <Text style={[styles.totalText, { color: colors.mutedForeground }]}>
                {total || members.length} member{(total || members.length) === 1 ? '' : 's'}
                {debouncedQuery ? ' matched' : ' total'}
              </Text>
            ) : null}
          </View>
        }
        contentContainerStyle={styles.listContent}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.4}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        ListHeaderComponentStyle={styles.listHeader}
      />

      <MemberActionsSheet
        member={actionMember}
        canRemove={actionCapabilities.canRemove}
        canModerate={actionCapabilities.canModerate}
        busy={actionBusy}
        onClose={() => {
          if (!actionBusy) setActionMember(null);
        }}
        onMakeModerator={() => {
          if (!actionMember) return;
          setModeratorError(null);
          setModeratorTarget({ member: actionMember, mode: 'promote' });
          setActionMember(null);
        }}
        onEditPermissions={() => {
          if (!actionMember) return;
          setModeratorError(null);
          setModeratorTarget({ member: actionMember, mode: 'edit' });
          setActionMember(null);
        }}
        onDismissModerator={() => void handleDismissModerator()}
        onRemove={() => void handleRemoveMember()}
      />

      <ModeratorPermissionsModal
        visible={moderatorTarget !== null}
        member={moderatorTarget?.member ?? null}
        mode={moderatorTarget?.mode ?? 'promote'}
        initialPermissions={
          moderatorTarget?.mode === 'edit'
            ? (moderatorTarget.member.permissions ?? NO_COMMUNITY_PERMISSIONS)
            : MODERATOR_DEFAULT_PERMISSIONS
        }
        saving={moderatorSaving}
        error={moderatorError}
        onClose={() => {
          if (moderatorSaving) return;
          setModeratorTarget(null);
          setModeratorError(null);
        }}
        onSave={(permissions) => void handleSaveModerator(permissions)}
      />
    </View>
  );
}

function RoleChip({
  label,
  tone,
  colors,
}: {
  label: string;
  tone: 'accent' | 'amber' | 'sky';
  colors: ReturnType<typeof useColors>;
}) {
  const toneColor =
    tone === 'accent' ? colors.accent : tone === 'amber' ? '#F59E0B' : '#38BDF8';
  const background =
    tone === 'accent' ? colors.accentSoft : tone === 'amber' ? 'rgba(245,158,11,0.14)' : 'rgba(56,189,248,0.14)';
  return (
    <View style={[styles.roleChip, { backgroundColor: background }]}>
      <Text style={[styles.roleChipText, { color: toneColor }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  listContent: { paddingBottom: 28 },
  listHeader: { paddingBottom: 0 },
  searchWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Geist_400Regular', paddingVertical: 0 },

  requestsSection: { paddingHorizontal: 16, paddingTop: 6 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  sectionTitle: { fontSize: 9.5, fontFamily: 'Geist_600SemiBold', letterSpacing: 1.2 },
  countPill: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countPillText: { fontSize: 10, fontFamily: 'Geist_700Bold' },
  requestsLoading: { paddingVertical: 22, alignItems: 'center' },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 6,
  },
  requestBody: { flex: 1, minWidth: 0 },
  requestName: { fontSize: 14, fontFamily: 'Geist_600SemiBold' },
  requestMeta: { fontSize: 11.5, fontFamily: 'Geist_400Regular', marginTop: 2 },
  requestMessage: {
    marginTop: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  requestMessageText: { fontSize: 11.5, fontFamily: 'Geist_400Regular', lineHeight: 16 },
  requestActions: { flexDirection: 'row', gap: 8, marginTop: 9 },
  acceptButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 76,
    justifyContent: 'center',
  },
  acceptText: { fontSize: 11.5, fontFamily: 'Geist_500Medium' },
  declineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 76,
    justifyContent: 'center',
  },
  declineText: { fontSize: 11.5, fontFamily: 'Geist_400Regular' },
  requestsDivider: { height: StyleSheet.hairlineWidth, marginTop: 10, marginBottom: 4 },

  membersLabel: { fontSize: 9.5, fontFamily: 'Geist_600SemiBold', letterSpacing: 1.2, paddingHorizontal: 16, paddingTop: 8 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  memberText: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  memberName: { fontSize: 14.5, fontFamily: 'Geist_500Medium', flexShrink: 1 },
  memberDesignation: { fontSize: 11.5, fontFamily: 'Geist_400Regular', marginTop: 2 },
  moreButton: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  roleChip: { borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  roleChipText: { fontSize: 8, fontFamily: 'Geist_700Bold', letterSpacing: 0.6 },

  answersWrap: { paddingHorizontal: 16, paddingLeft: 68, paddingBottom: 8, marginTop: -2 },
  answersToggle: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4 },
  answersToggleText: { fontSize: 11, fontFamily: 'Geist_500Medium' },
  answersCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 10,
    gap: 10,
    marginTop: 4,
  },
  answerBlock: { gap: 3 },
  answerLabel: { fontSize: 8.5, fontFamily: 'Geist_600SemiBold', letterSpacing: 1 },
  answerText: { fontSize: 12, fontFamily: 'Geist_400Regular', lineHeight: 17 },

  loadingWrap: { paddingVertical: 32, alignItems: 'center' },
  loadingMore: { paddingVertical: 16, alignItems: 'center' },
  errorWrap: { alignItems: 'center', paddingVertical: 28, gap: 10 },
  errorText: { fontSize: 13, fontFamily: 'Geist_400Regular' },
  retryButton: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  retryText: { fontSize: 12.5, fontFamily: 'Geist_500Medium' },
  emptyWrap: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyText: { fontSize: 13.5, fontFamily: 'Geist_400Regular' },
  totalText: { textAlign: 'center', fontSize: 11, fontFamily: 'Geist_400Regular', paddingTop: 10, paddingBottom: 6 },
});
