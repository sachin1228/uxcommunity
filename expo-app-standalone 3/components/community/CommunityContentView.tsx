import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useViewableKeys } from '@/hooks/useViewableKeys';
import { useCommunityContent, communityContentKey } from '@/hooks/useCommunityContent';
import {
  CommunityContent,
  CommunityEvent,
  CommunityThread,
  ContentKind,
  contentLabel,
  deleteCommunityContent,
} from '@/lib/communityContent';
import { communityStore } from '@/lib/communityStore';
import { chatContentEventFromCreated, chatContentKindForTab } from '@/lib/chatContentEvents';
import { notifyContentEvent } from '@/lib/contentEventMirror';
import { CommunityContentEditor } from './CommunityContentEditor';
import { EventGroupCreatedModal } from './EventGroupCreatedModal';
import { ContentCard, ContentDetail, useContentActions } from './contentView';

interface Props {
  communityId: string;
  kind: ContentKind;
  currentUserId: string;
  /** A card tapped in the chat — open this item's detail once the page loads. */
  openContentId?: string | null;
  /** The open request has been honoured (or proved stale) — clear it. */
  onOpenConsumed?: () => void;
  /** Manager holding this tab's moderation grant — Delete on others' cards. */
  canModerate?: boolean;
}

export function CommunityContentView({
  communityId,
  kind,
  currentUserId,
  openContentId = null,
  onOpenConsumed,
  canModerate = false,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const query = useCommunityContent(communityId, kind, currentUserId);
  const actions = useContentActions();
  const [editorVisible, setEditorVisible] = useState(false);
  const [editing, setEditing] = useState<CommunityContent | null>(null);
  const [selected, setSelected] = useState<CommunityContent | null>(null);
  const { visibleKeys, onViewableItemsChanged, viewabilityConfig } = useViewableKeys();
  // A new event arrives with its own group chat, and the creator is in it —
  // the notice says so before they go looking for the room.
  const [createdChat, setCreatedChat] = useState<CommunityEvent | null>(null);

  const items = query.data ?? [];
  const resetActions = actions.reset;

  // Fresh server rows are authoritative — drop optimistic overrides so a
  // confirmed value can never be shadowed by a stale local one.
  useEffect(() => {
    if (!query.isFetchedAfterMount) return;
    resetActions();
  }, [query.dataUpdatedAt, query.isFetchedAfterMount, resetActions]);

  // A card tapped in the chat arrives as openContentId; once this tab's page
  // has loaded, honour it (or give up quietly — the user is on the right tab
  // either way) and clear the request.
  useEffect(() => {
    if (!openContentId || !query.isFetched) return;
    const target = items.find((entry) => entry.id === openContentId);
    if (target) setSelected(target);
    onOpenConsumed?.();
  }, [openContentId, query.isFetched, items, onOpenConsumed]);

  const replace = (item: CommunityContent) => {
    // An edit can change a poll's options, which resets its votes server-side;
    // drop any optimistic poll state so the merged row is what renders.
    actions.resetPoll(item.id);
    const existing = queryClient.getQueryData<CommunityContent[]>(
      communityContentKey(communityId, kind),
    ) ?? [];
    const previous = existing.find((entry) => entry.id === item.id);
    const wasNew = !previous;
    // An edit response carries the poll but not its tallies. Keep the row's
    // vote state when the options did not change; the API clears votes when
    // they did, so a changed poll correctly starts from zero.
    const merged = mergeThreadPoll(previous, item);
    queryClient.setQueryData<CommunityContent[]>(communityContentKey(communityId, kind), (old = []) => {
      const exists = old.some((entry) => entry.id === item.id);
      return exists ? old.map((entry) => entry.id === item.id ? merged : entry) : [merged, ...old];
    });
    // The chat timeline's permanent "You created a …" card lands in the same
    // frame — the realtime echo follows and dedupes by id (see the mirror).
    if (wasNew) {
      notifyContentEvent({
        kind: 'insert',
        communityId,
        event: chatContentEventFromCreated(kind, item),
      });
      // An event comes with its own group chat, which the creator is already in.
      // The room list has to re-read for that pin to appear, and the notice is
      // what tells the creator the room exists at all.
      const created = item as CommunityEvent;
      if (kind === 'events' && created.chat_community) {
        setCreatedChat(created);
        communityStore.notifyCommunityChanged({ kind: 'refresh' });
      }
    }
    setSelected((current) => current?.id === item.id ? merged : current);
  };

  // The options sheet confirms first, in its own styled panel; rejecting here
  // hands the failure back to it so it can stay open with the reason.
  const remove = useCallback(
    async (item: CommunityContent) => {
      await deleteCommunityContent(communityId, kind, item.id);
      queryClient.setQueryData<CommunityContent[]>(
        communityContentKey(communityId, kind),
        (old = []) => old.filter((entry) => entry.id !== item.id),
      );
      // Its "created a …" card leaves the chat timeline in the same frame —
      // the realtime content-delete echo follows.
      notifyContentEvent({
        kind: 'delete',
        communityId,
        id: item.id,
        contentKind: chatContentKindForTab(kind),
      });
      setSelected(null);
    },
    [communityId, kind, queryClient],
  );

  // The comment count is the only route into a post's own page, where the
  // comments live under the post itself.
  const openItem = useCallback((item: CommunityContent) => setSelected(item), []);

  if (query.isLoading) return <Centered><ActivityIndicator color={colors.accent} /></Centered>;

  if (query.isError) {
    return (
      <Centered>
        <Feather name="wifi-off" size={28} color={colors.foregroundMuted} />
        <Text style={[styles.stateTitle, { color: colors.foreground }]}>
          Couldn&apos;t load {kind}
        </Text>
        <Text style={[styles.stateBody, { color: colors.foregroundMuted }]}>
          {query.error instanceof Error ? query.error.message : 'Check your connection and try again.'}
        </Text>
        <Pressable onPress={() => query.refetch()} accessibilityRole="button">
          <Text style={[styles.retry, { color: colors.accent }]}>Try again</Text>
        </Pressable>
      </Centered>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <ContentCard
            item={item}
            kind={kind}
            currentUserId={currentUserId}
            actions={actions}
            onComments={openItem}
            onEdit={(entry) => { setEditing(entry); setEditorVisible(true); }}
            onDelete={remove}
            canModerate={canModerate}
            videoActive={!selected && visibleKeys.has(item.id)}
            videoRank={index}
          />
        )}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 112 }]}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={query.refetch}
            tintColor={colors.foregroundMuted}
          />
        }
        ListEmptyComponent={
          <Centered>
            <Feather
              name={
                kind === 'threads' ? 'message-square'
                  : kind === 'events' ? 'calendar'
                    : kind === 'showcase' ? 'image'
                      : 'bookmark'
              }
              size={32}
              color={colors.foregroundSubtle}
            />
            <Text style={[styles.stateTitle, { color: colors.foreground }]}>No {kind} yet</Text>
            <Text style={[styles.stateBody, { color: colors.foregroundMuted }]}>
              Be the first to add one for this community.
            </Text>
          </Centered>
        }
      />

      <Pressable
        onPress={() => { setEditing(null); setEditorVisible(true); }}
        style={[styles.fab, { backgroundColor: colors.accent, bottom: insets.bottom + 20, shadowColor: '#000' }]}
        accessibilityRole="button"
        accessibilityLabel={`Create ${contentLabel(kind)}`}
      >
        <Feather name="plus" size={24} color={colors.accentForeground} />
        <Text style={[styles.fabText, { color: colors.accentForeground }]}>
          {kind === 'resources' ? 'Share' : 'Create'}
        </Text>
      </Pressable>

      <CommunityContentEditor
        visible={editorVisible}
        communityId={communityId}
        kind={kind}
        item={editing}
        onClose={() => { setEditorVisible(false); setEditing(null); }}
        onSaved={replace}
      />

      {createdChat ? (
        <EventGroupCreatedModal
          eventTitle={createdChat.title}
          eventDate={createdChat.event_date}
          eventEnd={createdChat.end_date ?? createdChat.event_date}
          coverImageUrl={createdChat.cover_image_url}
          onClose={() => setCreatedChat(null)}
        />
      ) : null}

      <ContentDetail
        item={selected}
        kind={kind}
        currentUserId={currentUserId}
        actions={actions}
        visible={Boolean(selected)}
        onClose={() => setSelected(null)}
        onEdit={(entry) => { setEditing(entry); setEditorVisible(true); }}
        onDelete={remove}
        canModerate={canModerate}
      />
    </View>
  );
}

/**
 * Merge an edited thread's existing poll tallies into the server response.
 * Non-thread kinds pass through untouched.
 */
function mergeThreadPoll(
  previous: CommunityContent | undefined,
  next: CommunityContent,
): CommunityContent {
  if (!previous) return next;
  const previousThread = previous as CommunityThread;
  const nextThread = next as CommunityThread;
  if (!previousThread.poll || !nextThread.poll) return next;
  const sameOptions =
    JSON.stringify(previousThread.poll.options) === JSON.stringify(nextThread.poll.options);
  if (!sameOptions) return next;
  return {
    ...next,
    poll_vote_counts: previousThread.poll_vote_counts,
    poll_user_vote: previousThread.poll_user_vote,
    poll_undo_used: previousThread.poll_undo_used,
  } as CommunityThread;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={styles.center}>{children}</View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { padding: 12, gap: 12, flexGrow: 1 },
  center: { flex: 1, minHeight: 260, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 28 },
  stateTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 17 },
  stateBody: { fontFamily: 'Geist_400Regular', fontSize: 14, textAlign: 'center' },
  retry: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  fab: {
    position: 'absolute',
    right: 18,
    height: 52,
    borderRadius: 26,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    elevation: 8,
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
  },
  fabText: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
});
