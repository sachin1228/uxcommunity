import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useCommunityContent, communityContentKey } from '@/hooks/useCommunityContent';
import {
  CommunityContent,
  ContentKind,
  contentLabel,
  deleteCommunityContent,
} from '@/lib/communityContent';
import { CommentsSheet } from './CommentsSheet';
import { CommunityContentEditor } from './CommunityContentEditor';
import { ContentCard, ContentDetail, useContentActions } from './contentView';

interface Props { communityId: string; kind: ContentKind; currentUserId: string }

export function CommunityContentView({ communityId, kind, currentUserId }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const query = useCommunityContent(communityId, kind);
  const actions = useContentActions();
  const [editorVisible, setEditorVisible] = useState(false);
  const [editing, setEditing] = useState<CommunityContent | null>(null);
  const [selected, setSelected] = useState<CommunityContent | null>(null);
  const [commentTarget, setCommentTarget] = useState<CommunityContent | null>(null);

  const items = query.data ?? [];
  const resetActions = actions.reset;

  // Fresh server rows are authoritative — drop optimistic overrides so a
  // confirmed value can never be shadowed by a stale local one.
  useEffect(() => {
    if (!query.isFetchedAfterMount) return;
    resetActions();
  }, [query.dataUpdatedAt, query.isFetchedAfterMount, resetActions]);

  const replace = (item: CommunityContent) => {
    queryClient.setQueryData<CommunityContent[]>(communityContentKey(communityId, kind), (old = []) => {
      const exists = old.some((entry) => entry.id === item.id);
      return exists ? old.map((entry) => entry.id === item.id ? item : entry) : [item, ...old];
    });
    setSelected((current) => current?.id === item.id ? item : current);
  };

  const remove = useCallback(
    (item: CommunityContent) => Alert.alert(
      `Delete ${contentLabel(kind).toLowerCase()}?`,
      'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteCommunityContent(communityId, kind, item.id);
              queryClient.setQueryData<CommunityContent[]>(
                communityContentKey(communityId, kind),
                (old = []) => old.filter((entry) => entry.id !== item.id),
              );
              setSelected(null);
            } catch (e) {
              Alert.alert('Could not delete', e instanceof Error ? e.message : 'Please try again.');
            }
          },
        },
      ],
    ),
    [communityId, kind, queryClient],
  );

  const openComments = useCallback((item: CommunityContent) => setCommentTarget(item), []);

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
        renderItem={({ item }) => (
          <ContentCard
            item={item}
            kind={kind}
            currentUserId={currentUserId}
            actions={actions}
            onOpen={setSelected}
            onComments={openComments}
            onEdit={(entry) => { setEditing(entry); setEditorVisible(true); }}
            onDelete={remove}
          />
        )}
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

      <ContentDetail
        item={selected}
        kind={kind}
        currentUserId={currentUserId}
        actions={actions}
        visible={Boolean(selected)}
        onClose={() => setSelected(null)}
        onComments={openComments}
        onEdit={(entry) => { setEditing(entry); setEditorVisible(true); }}
        onDelete={remove}
      />

      {commentTarget ? (
        <CommentsSheet
          visible
          communityId={communityId}
          kind={kind}
          targetId={commentTarget.id}
          currentUserId={currentUserId}
          title={commentTarget.title}
          allowReplies={
            kind === 'events'
              ? true
              : (commentTarget as { allow_replies?: boolean }).allow_replies !== false
          }
          onClose={() => setCommentTarget(null)}
          onCountChange={(total) => actions.setCommentCount(commentTarget.id, total)}
        />
      ) : null}
    </View>
  );
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
