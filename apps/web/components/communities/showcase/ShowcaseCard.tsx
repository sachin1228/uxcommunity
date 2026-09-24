"use client";

import { useState } from "react";
import { Film, Loader2 } from "lucide-react";
import { HeartIcon } from "../HeartIcon";
import { CommentIcon } from "../CommentIcon";
import { communityFeedLayout } from "../feed-layout";
import { PostAuthorMeta } from "../PostAuthorMeta";
import { CommunityPostLabel } from "../CommunityPostLabel";
import { ShowcaseOptionsMenu } from "./ShowcaseOptionsMenu";
import { FeedVideo } from "@/components/communities/FeedVideo";
import { useShowcaseInteractions } from "./useShowcaseInteractions";
import { ThreadImageCarousel } from "../threads/ThreadImageCarousel";
import { ShowcaseMediaLightbox } from "./ShowcaseMediaLightbox";
import {
  SHOWCASE_CATEGORIES,
  type ShowcaseAttachment,
  type ShowcasePost,
} from "./types";

interface ShowcaseCardProps {
  post: ShowcasePost;
  currentUserId: string;
  isLast?: boolean;
  communityId: string;
  communityName?: string;
  communityImage?: string | null;
  onOpen?: () => void;
  /** Homepage only: opens the community preview popup instead of navigating. */
  onCommunityClick?: () => void;
  onLikeChanged: (liked: boolean, count: number) => void;
  onSaveChanged: (saved: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  /**
   * Rendered inside the card, under the engagement row (like · comments ·
   * community). The detail page puts its comment thread here so the post and
   * the discussion read as one card instead of two stacked ones.
   */
  commentSection?: React.ReactNode;
}

/** Media list for a post: attachments when present, else the legacy cover image. */
function mediaForPost(post: ShowcasePost): ShowcaseAttachment[] {
  if (Array.isArray(post.attachments) && post.attachments.length > 0) return post.attachments;
  if (post.image_url) return [{ name: post.title, url: post.image_url, type: "image/webp", size: 0 }];
  return [];
}

export function ShowcaseCard({
  post,
  currentUserId,
  communityId,
  communityName,
  communityImage,
  onOpen,
  onCommunityClick,
  onLikeChanged,
  onSaveChanged,
  onEdit,
  onDelete,
  commentSection,
}: ShowcaseCardProps) {
  const { toggleLike, toggleSave, likePending, savePending, saved } = useShowcaseInteractions({
    communityId,
    postId: post.id,
    liked: post.user_liked,
    likeCount: post.like_count,
    saved: post.user_saved,
    onLikeChanged,
    onSaveChanged,
  });
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // Report is an acknowledgement, not a stored record — the menu item just
  // flips to "Reported" for a moment, like the thread, resource and event menus.
  const [reported, setReported] = useState(false);

  const categoryLabel = SHOWCASE_CATEGORIES.find((item) => item.value === post.category)?.label ?? post.category;
  const media = mediaForPost(post);

  // The card root is a clickable link; clicks on controls (carousel arrows,
  // dots, lightbox triggers) must not also open the detail page.
  function handleCardClick(event: React.MouseEvent<HTMLElement>) {
    if (!onOpen) return;
    const interactiveTarget = (event.target as Element | null)?.closest?.("button, a, [role='link'], [role='button'], video");
    if (interactiveTarget && interactiveTarget !== event.currentTarget) return;
    onOpen();
  }

  function handleCardKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (!onOpen || event.key !== "Enter") return;
    const interactiveTarget = (event.target as Element | null)?.closest?.("button, a, [role='link'], [role='button'], video");
    if (interactiveTarget && interactiveTarget !== event.currentTarget) return;
    event.preventDefault();
    onOpen();
  }

  let mediaBlock: React.ReactNode = null;
  if (media.length === 1) {
    const item = media[0];
    const videoReady = item.type.startsWith("video/") && (item.status ?? "ready") === "ready";
    if (item.type.startsWith("video/")) {
      if (videoReady) {
        mediaBlock = (
          <div className="mt-3 overflow-hidden rounded-xl border border-border bg-black">
            <FeedVideo
              src={item.url}
              ariaLabel={post.title}
              poster={item.poster}
              className="mx-auto block max-h-[480px] w-full object-contain"
            />
          </div>
        );
      } else {
        // Video is still in the pipeline (or failed) — never render a broken
        // player; show a labeled placeholder instead.
        const failed = item.status === "failed";
        mediaBlock = (
          <div className="mt-3 flex aspect-video w-full items-center justify-center gap-2 overflow-hidden rounded-xl border border-border bg-black/80">
            {failed ? (
              <>
                <Film strokeWidth={2} size={20} className="text-foreground-subtle" />
                <span className="font-body text-sm text-foreground-subtle">Video unavailable</span>
              </>
            ) : (
              <>
                <Loader2 strokeWidth={2} size={20} className="animate-spin text-foreground-muted" />
                <span className="font-body text-sm text-foreground-muted">Processing video…</span>
              </>
            )}
          </div>
        );
      }
    } else {
      mediaBlock = (
        <div
          role="button"
          tabIndex={0}
          aria-label="Open media viewer"
          onClick={(event) => { event.stopPropagation(); setLightboxIndex(0); }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              setLightboxIndex(0);
            }
          }}
          className="mt-3 block cursor-pointer overflow-hidden rounded-xl border border-border bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <img
            src={item.url}
            alt={`Preview of ${post.title}`}
            className="max-h-[480px] w-full object-cover"
          />
        </div>
      );
    }
  } else if (media.length > 1) {
    mediaBlock = (
      <ThreadImageCarousel
        images={media}
        onImageClick={(index) => setLightboxIndex(index)}
      />
    );
  }

  return (
    <>
      <article
        tabIndex={onOpen ? 0 : undefined}
        role={onOpen ? "link" : undefined}
        onClick={handleCardClick}
        onKeyDown={handleCardKeyDown}
        // Same shell rule as the thread card: a list card is clickable, the
        // detail card (which now holds the discussion) is not and takes the
        // roomier detail padding.
        className={onOpen
          ? `group cursor-pointer ${communityFeedLayout.card} ${communityFeedLayout.cardInteractive}`
          : communityFeedLayout.detailCard}
      >
        <div className="flex items-start justify-between gap-3">
          <PostAuthorMeta
            name={post.author.name}
            avatarUrl={post.author.avatar_url}
            createdAt={post.created_at}
            dateInline
            secondaryLabel={`Showcase · ${categoryLabel}`}
          />
          <ShowcaseOptionsMenu
            saved={saved}
            canManage={post.user_id === currentUserId}
            reported={reported}
            busy={savePending}
            onToggleSave={toggleSave}
            onEdit={onEdit}
            onDelete={onDelete}
            onReport={() => setReported(true)}
          />
        </div>

        <h2 className="mt-3 text-pretty whitespace-pre-wrap break-words font-display text-sm font-normal leading-snug text-foreground">
          {post.title}
        </h2>

        {mediaBlock}

        {/* Engagement row — the thread card's shape: actions left, community
            attribution right. */}
        <div className="mt-3 flex items-center justify-between gap-4">
          <div className="flex shrink-0 items-center gap-4">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggleLike(); }}
              aria-label={post.user_liked ? "Unlike showcase post" : "Like showcase post"}
              aria-pressed={post.user_liked}
              aria-busy={likePending}
              className="group/like inline-flex cursor-pointer items-center gap-2"
            >
              <HeartIcon
                size={16}
                active={post.user_liked}
                fill="none"
                className={`transition-transform duration-150 ease-out group-hover/like:scale-110 ${post.user_liked ? "text-[var(--like)]" : "text-foreground-subtle group-hover/like:text-white"}`}
              />
              <span
                className={`font-body text-sm font-semibold tabular-nums ${
                  post.user_liked ? "text-[var(--like)]" : "text-foreground-subtle group-hover/like:text-white"
                }`}
              >
                {post.like_count}
              </span>
            </button>

            {post.allow_replies !== false && (
              <span className="inline-flex items-center gap-1.5 font-body text-xs font-semibold text-foreground-subtle transition-colors duration-150 hover:text-white">
                <CommentIcon />
                {post.comment_count}
              </span>
            )}
          </div>

          {communityName && <CommunityPostLabel communityId={communityId} communityName={communityName} communityImage={communityImage} className="min-w-0 justify-end text-right" onOpenPreview={onCommunityClick} />}
        </div>

        {/* ── Comment thread (detail page only) ── */}
        {commentSection && <div className="mt-4">{commentSection}</div>}
      </article>

      {lightboxIndex !== null && (
        <ShowcaseMediaLightbox
          media={media}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
}
