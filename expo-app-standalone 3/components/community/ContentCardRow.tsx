import React, { memo } from 'react';
import type { CommunityContent, ContentKind } from '@/lib/communityContent';
import { useIsViewable, type ViewableKeyStore } from '@/hooks/useViewableKeys';
import { ContentCard, type ContentActionsApi } from './contentView';

interface ContentCardRowProps {
  item: CommunityContent;
  /** Stable list key — feed rows prefix the kind, community tabs use the id. */
  itemKey: string;
  kind: ContentKind;
  currentUserId: string;
  actions: ContentActionsApi;
  /** Per-key viewability store owned by the screen's `useViewableKeys`. */
  viewableStore: ViewableKeyStore;
  videoRank: number;
  communityName?: string | null;
  communityImage?: string | null;
  onComments: (item: CommunityContent) => void;
  onEdit?: (item: CommunityContent) => void;
  onDelete?: (item: CommunityContent) => Promise<void> | void;
  canModerate?: boolean;
}

/**
 * One list row around `ContentCard`.
 *
 * The row — not the screen — subscribes to this item's viewability, so a
 * scroll that changes which video is on screen re-renders one card instead of
 * recreating `renderItem` and re-rendering every mounted card. `memo` also
 * keeps the stable callbacks from the screen from leaking into the card.
 */
export const ContentCardRow = memo(function ContentCardRow({
  item,
  itemKey,
  kind,
  currentUserId,
  actions,
  viewableStore,
  videoRank,
  communityName,
  communityImage,
  onComments,
  onEdit,
  onDelete,
  canModerate = false,
}: ContentCardRowProps) {
  const videoActive = useIsViewable(viewableStore, itemKey);
  return (
    <ContentCard
      item={item}
      kind={kind}
      currentUserId={currentUserId}
      actions={actions}
      communityName={communityName}
      communityImage={communityImage}
      onComments={onComments}
      onEdit={onEdit}
      onDelete={onDelete}
      canModerate={canModerate}
      videoActive={videoActive}
      videoRank={videoRank}
    />
  );
});
