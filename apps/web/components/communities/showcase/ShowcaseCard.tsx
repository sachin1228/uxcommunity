"use client";

import {
  Heart,
  MessageCircle,
} from "lucide-react";
import { communityFeedLayout } from "../feed-layout";
import { PostAuthorMeta } from "../PostAuthorMeta";
import { ShowcaseOptionsMenu } from "./ShowcaseOptionsMenu";
import { useShowcaseInteractions } from "./useShowcaseInteractions";
import { type ShowcasePost } from "./types";

interface ShowcaseCardProps {
  post: ShowcasePost;
  currentUserId: string;
  variant?: "list" | "detail";
  isLast?: boolean;
  communityId: string;
  onOpen?: () => void;
  onLikeChanged: (liked: boolean, count: number) => void;
  onSaveChanged: (saved: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function ShowcaseCard({
  post,
  currentUserId,
  variant = "list",
  communityId,
  onOpen,
  onLikeChanged,
  onSaveChanged,
  onEdit,
  onDelete,
}: ShowcaseCardProps) {
  const isDetail = variant === "detail";
  const { toggleLike, toggleSave, likePending, savePending } = useShowcaseInteractions({
    communityId,
    postId: post.id,
    liked: post.user_liked,
    likeCount: post.like_count,
    saved: post.user_saved,
    onLikeChanged,
    onSaveChanged,
  });
  const typeLabel = "Showcase";

  const card = (
    <>
      <div className="flex items-start justify-between gap-4">
        <PostAuthorMeta
          name={post.author.name}
          avatarUrl={post.author.avatar_url}
          createdAt={post.created_at}
          dateInline
          secondaryLabel={`Showcase · ${typeLabel}`}
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

      {isDetail ? (
        <h1 className="mt-4 text-pretty font-display text-xl font-semibold text-foreground">
          {post.title}
        </h1>
      ) : (
        <h2 className="mt-3 text-pretty font-display text-base font-semibold text-foreground">
          {post.title}
        </h2>
      )}

      {post.description && (
        <p
          className={`font-body text-foreground-muted ${
            isDetail
              ? "mt-2 whitespace-pre-wrap text-sm leading-relaxed"
              : "mt-1.5 line-clamp-3 text-xs leading-relaxed"
          }`}
        >
          {post.description}
        </p>
      )}

      <div
        className={`overflow-hidden rounded-xl border border-border bg-surface-raised ${
          isDetail ? "mt-4" : "mt-3 max-h-[480px]"
        }`}
      >
        <img
          src={post.image_url}
          alt={`Preview of ${post.title}`}
          className={`w-full object-cover ${
            isDetail ? "max-h-[620px]" : "max-h-[480px]"
          }`}
        />
      </div>

      <div
        className={`flex items-center gap-4 ${isDetail ? "mt-4" : "mt-3"}`}
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

        {isDetail ? (
          <span className="inline-flex items-center gap-2 font-body text-sm text-foreground">
            <MessageCircle size={20} />
            {post.comment_count}
          </span>
        ) : (
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex items-center gap-1.5 font-body text-xs font-semibold text-foreground"
          >
            <MessageCircle size={20} />
            {post.comment_count} {post.comment_count === 1 ? "comment" : "comments"}
          </button>
        )}

        <div className="flex-1" />
      </div>
    </>
  );

  if (isDetail) {
    return <article className={`mx-5 md:mx-8 ${communityFeedLayout.detailCard}`}>{card}</article>;
  }

  return (
    <article
      tabIndex={0}
      role="link"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen?.();
      }}
      className={`${communityFeedLayout.card} ${communityFeedLayout.cardInteractive} cursor-pointer`}
    >
      {card}
    </article>
  );
}
