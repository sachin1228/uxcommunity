"use client";

import {
  Heart,
  MessageCircle,
} from "lucide-react";
import { communityFeedLayout } from "../feed-layout";
import { PostAuthorMeta } from "../PostAuthorMeta";
import { CommunityPostLabel } from "../CommunityPostLabel";
import { ShowcaseOptionsMenu } from "./ShowcaseOptionsMenu";
import { useShowcaseInteractions } from "./useShowcaseInteractions";
import { SHOWCASE_CATEGORIES, type ShowcasePost } from "./types";

interface ShowcaseCardProps {
  post: ShowcasePost;
  currentUserId: string;
  isLast?: boolean;
  communityId: string;
  communityName?: string;
  communityImage?: string | null;
  onOpen?: () => void;
  onLikeChanged: (liked: boolean, count: number) => void;
  onSaveChanged: (saved: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function ShowcaseCard({
  post,
  currentUserId,
  communityId,
  communityName,
  communityImage,
  onOpen,
  onLikeChanged,
  onSaveChanged,
  onEdit,
  onDelete,
}: ShowcaseCardProps) {
  const { toggleLike, toggleSave, likePending, savePending } = useShowcaseInteractions({
    communityId,
    postId: post.id,
    liked: post.user_liked,
    likeCount: post.like_count,
    saved: post.user_saved,
    onLikeChanged,
    onSaveChanged,
  });
  const categoryLabel = SHOWCASE_CATEGORIES.find((item) => item.value === post.category)?.label ?? post.category;

  return (
    <article
      tabIndex={onOpen ? 0 : undefined}
      role={onOpen ? "link" : undefined}
      onClick={onOpen}
      onKeyDown={onOpen ? (event) => { if (event.key === "Enter") onOpen(); } : undefined}
      className={`${communityFeedLayout.card} ${onOpen ? communityFeedLayout.cardInteractive : ""} ${onOpen ? "cursor-pointer" : ""}`}
    >
      <div className="flex items-start justify-between gap-4">
        <PostAuthorMeta
          name={post.author.name}
          avatarUrl={post.author.avatar_url}
          createdAt={post.created_at}
          dateInline
          secondaryLabel={`Showcase · ${categoryLabel}`}
        />
        <ShowcaseOptionsMenu
          saved={post.user_saved}
          canManage={post.user_id === currentUserId}
          busy={savePending}
          onToggleSave={toggleSave}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>

      <h2 className="mt-3 text-pretty font-display text-sm font-semibold text-foreground">
        {post.title}
      </h2>

      <div className="mt-3 max-h-[480px] overflow-hidden rounded-xl border border-border bg-surface-raised">
        <img
          src={post.image_url}
          alt={`Preview of ${post.title}`}
          className="max-h-[480px] w-full object-cover"
        />
      </div>

      <div
        className="mt-3 flex items-center gap-4"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={toggleLike}
          aria-label={post.user_liked ? "Unlike showcase post" : "Like showcase post"}
          aria-pressed={post.user_liked}
          aria-busy={likePending}
          className="inline-flex items-center gap-2"
        >
          <Heart
            size={20}
            fill={post.user_liked ? "currentColor" : "none"}
            className={post.user_liked ? "text-red-500" : "text-foreground"}
          />
          <span className="font-body text-sm font-semibold text-foreground">
            {post.like_count}
          </span>
        </button>

        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-1.5 font-body text-xs font-semibold text-foreground"
        >
          <MessageCircle size={20} />
          {post.comment_count}
        </button>

        <div className="flex-1" />
        {communityName && <CommunityPostLabel communityName={communityName} communityImage={communityImage} className="min-w-0 justify-end text-right" />}
      </div>
    </article>
  );
}
