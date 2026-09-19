"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, Heart, MessageCircle } from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { Spinner } from "@/components/ui/Spinner";
import { ShareButton } from "./ShareButton";
import { useEntryInteractions } from "./useEntryInteractions";
import type { CompetitionEntry } from "@/lib/competitions/types";

interface Props {
  slug: string;
  entry: CompetitionEntry;
  currentUserId: string;
  votingOpen: boolean;
  /** Winner/featured treatment for the results page. */
  emphasis?: "none" | "winner" | "featured";
  onOpen?: () => void;
}

/**
 * One submitted design.
 *
 * The artwork is the card: it is served at its natural aspect ratio in a
 * masonry column, with the designer and the vote action kept deliberately quiet
 * underneath. Nothing here ranks entries — the count is a number, not a
 * position, so a live gallery never becomes a scoreboard.
 */
export function EntryCard({ slug, entry, currentUserId, votingOpen, emphasis = "none", onOpen }: Props) {
  const router = useRouter();
  const href = `/dashboard/competitions/${slug}/entries/${entry.id}`;

  const { voted, voteCount, bookmarked, toggleVote, toggleBookmark, votePending, error } =
    useEntryInteractions({
      slug,
      entryId: entry.id,
      voted: entry.user_voted,
      voteCount: entry.vote_count,
      bookmarked: entry.user_bookmarked,
      votingOpen,
    });

  const isOwnEntry = entry.user_id === currentUserId;

  const openEntry = useCallback(() => {
    if (onOpen) {
      onOpen();
      return;
    }
    router.push(href);
  }, [href, onOpen, router]);

  function handleCardClick(event: React.MouseEvent<HTMLElement>) {
    const interactive = (event.target as Element | null)?.closest?.(
      "button, a, [role='button'], video",
    );
    if (interactive && interactive !== event.currentTarget) return;
    openEntry();
  }

  function handleCardKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter") return;
    const interactive = (event.target as Element | null)?.closest?.(
      "button, a, [role='button'], video",
    );
    if (interactive && interactive !== event.currentTarget) return;
    event.preventDefault();
    openEntry();
  }

  const ring =
    emphasis === "winner"
      ? "ring-2 ring-accent/40"
      : emphasis === "featured"
        ? "ring-1 ring-accent/20"
        : "";

  return (
    <article
      role="link"
      tabIndex={0}
      aria-label={`${entry.title} by ${entry.author_name}`}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      className={`group mb-5 break-inside-avoid cursor-pointer overflow-hidden rounded-xl bg-surface-raised shadow-sm transition-shadow duration-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${ring}`}
    >
      <div className="relative bg-background-subtle">
        {/* Design first: natural aspect ratio, no crop, no letterbox. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={entry.cover_image_url}
          alt={entry.title}
          loading="lazy"
          decoding="async"
          className="block w-full object-cover"
        />

        <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              toggleBookmark();
            }}
            aria-label={bookmarked ? "Remove from saved entries" : "Save this entry"}
            aria-pressed={bookmarked}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
          >
            <Bookmark size={15} strokeWidth={2.5} fill={bookmarked ? "currentColor" : "none"} />
          </button>
          <ShareButton
            url={href}
            title={`${entry.title} — ${entry.author_name}`}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
          />
        </div>

        {emphasis === "winner" && (
          <span className="absolute left-2 top-2 rounded-full bg-accent px-2.5 py-1 font-body text-[11px] font-semibold uppercase tracking-wider text-accent-foreground shadow-sm">
            Winner
          </span>
        )}
      </div>

      <div className="p-3.5">
        <h3 className="line-clamp-2 font-display text-sm font-semibold leading-snug text-foreground">
          {entry.title}
        </h3>

        <div className="mt-2.5 flex items-center gap-2.5">
          <AvatarImg
            url={entry.author_avatar_url}
            name={entry.author_name}
            size={28}
            className="h-7 w-7 shrink-0 rounded-full object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate font-body text-[12px] font-semibold text-foreground">
              {entry.author_name}
            </p>
            <p className="truncate font-body text-[11px] text-foreground-subtle">
              {entry.author_role || "Designer"}
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                toggleVote();
              }}
              disabled={!votingOpen}
              aria-pressed={voted}
              aria-busy={votePending}
              title={
                isOwnEntry
                  ? "You cannot vote for your own entry"
                  : votingOpen
                    ? voted
                      ? "Remove your vote"
                      : "Vote for this design"
                    : "Voting is closed"
              }
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 font-body text-xs font-semibold transition-colors ${
                voted
                  ? "bg-accent/15 text-accent"
                  : "bg-background-subtle text-foreground-muted hover:text-foreground"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {votePending ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : (
                <Heart size={14} strokeWidth={2.5} fill={voted ? "currentColor" : "none"} />
              )}
              <span className="tabular-nums">{voteCount.toLocaleString("en-IN")}</span>
              <span className="sr-only">votes</span>
            </button>

            <span className="inline-flex items-center gap-1.5 font-body text-xs text-foreground-subtle">
              <MessageCircle size={14} strokeWidth={2.5} />
              <span className="tabular-nums">{entry.comment_count}</span>
            </span>
          </div>

          <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle transition-colors group-hover:text-foreground">
            View
          </span>
        </div>

        {error && (
          <p role="alert" className="mt-2 font-body text-[11px] text-[var(--color-signal)]">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}
