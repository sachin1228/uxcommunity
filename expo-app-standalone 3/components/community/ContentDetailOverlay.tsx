import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCommunityContent, communityContentKey } from '@/hooks/useCommunityContent';
import {
  CommunityContent,
  ContentKind,
  deleteCommunityContent,
} from '@/lib/communityContent';
import { chatContentKindForTab } from '@/lib/chatContentEvents';
import { notifyContentEvent } from '@/lib/contentEventMirror';
import { CommunityContentEditor } from './CommunityContentEditor';
import { ContentDetail, useContentActions } from './contentView';

/**
 * The post page opened from a chat's "created a …" card.
 *
 * Tapping that card is a request to read the post, not to browse the tab it
 * lives on, so the page is presented over the chat instead of switching tabs
 * first. The row comes from the same cached list the tab renders — mounting
 * this overlay is what fetches it — which keeps likes, saves, polls and
 * comments behaving exactly as they do on the tab.
 */
export function ContentDetailOverlay({
  communityId,
  communityName,
  kind,
  contentId,
  currentUserId,
  onClose,
}: {
  communityId: string;
  communityName?: string | null;
  kind: ContentKind;
  contentId: string;
  currentUserId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const query = useCommunityContent(communityId, kind, currentUserId);
  const actions = useContentActions();
  const [editorVisible, setEditorVisible] = useState(false);
  const [editing, setEditing] = useState<CommunityContent | null>(null);

  const item = query.data?.find((entry) => entry.id === contentId) ?? null;
  // The page's list can be a cached copy from before this post existed — a
  // card for a thread created on the web lands here through realtime — so a
  // missing row is worth one fresh fetch before the page gives up.
  const refetchedForMiss = useRef(false);
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: communityContentKey(communityId, kind) }),
    [communityId, kind, queryClient],
  );

  // The row is gone (deleted here or on another device) — close rather than
  // spin forever on a page that cannot exist.
  const { isFetched, refetch } = query;
  useEffect(() => {
    if (!isFetched || item) return;
    if (!refetchedForMiss.current) {
      refetchedForMiss.current = true;
      void refetch();
      return;
    }
    onClose();
  }, [isFetched, item, onClose, refetch]);

  const remove = useCallback(
    async (entry: CommunityContent) => {
      await deleteCommunityContent(communityId, kind, entry.id);
      // Its "created a …" card leaves the chat timeline in the same frame; the
      // realtime content-delete echo follows.
      notifyContentEvent({
        kind: 'delete',
        communityId,
        id: entry.id,
        contentKind: chatContentKindForTab(kind),
      });
      await refresh();
      onClose();
    },
    [communityId, kind, onClose, refresh],
  );

  return (
    <>
      <ContentDetail
        item={item}
        kind={kind}
        currentUserId={currentUserId}
        actions={actions}
        communityName={communityName}
        visible
        loading={!item && (query.isPending || query.isFetching)}
        onClose={onClose}
        onEdit={(entry) => {
          setEditing(entry);
          setEditorVisible(true);
        }}
        onDelete={remove}
      />

      <CommunityContentEditor
        visible={editorVisible}
        communityId={communityId}
        kind={kind}
        item={editing}
        onClose={() => {
          setEditorVisible(false);
          setEditing(null);
        }}
        onSaved={() => {
          setEditorVisible(false);
          setEditing(null);
          // Fresh server rows win, including a poll whose options changed.
          void refresh();
        }}
      />
    </>
  );
}
