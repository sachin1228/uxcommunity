"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bookmark, ExternalLink, Heart, MessageCircle, Send } from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { Spinner } from "@/components/ui/Spinner";
import { ShareButton } from "./ShareButton";
import { formatRelativeDate } from "@/components/communities/threads/threadShared";
import type { CompetitionComment, CompetitionEntry } from "@/lib/competitions/types";

interface Props {
  slug: string;
  entry: CompetitionEntry;
  comments: CompetitionComment[];
  currentUserId: string;
  competitionTitle: string;
  weekNumber: number;
  votingOpen: boolean;
  commentingOpen: boolean;
}

/**
 * One design, in full.
 *
 * The artwork leads (left and sticky on desktop, full-bleed first on mobile)
 * because that is the thing being judged. Everything else — description, tools,
 * links, voting, discussion — sits in a single right-hand column so the reading
 * order on a phone is: design → who made it → what they say → vote → talk.
 */
export function EntryDetailView({
  slug,
  entry,
  comments: initialComments,
  currentUserId,
  competitionTitle,
  weekNumber,
  votingOpen,
  commentingOpen,
}: Props) {
  const [voted, setVoted] = useState(entry.user_voted);
  const [voteCount, setVoteCount] = useState(entry.vote_count);
  const [votePending, setVotePending] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [bookmarked, setBookmarked] = useState(entry.user_bookmarked);
  const [comments, setComments] = useState(initialComments);
  const [activeIndex, setActiveIndex] = useState(0);

  const gallery = useMemo(
    () =>
      [{ url: entry.design_image_url, name: "Main design" }, ...entry.image_urls].filter(
        (image) => image.url,
      ),
    [entry.design_image_url, entry.image_urls],
  );

  const isOwnEntry = entry.user_id === currentUserId;
  const activeImage = gallery[Math.min(activeIndex, gallery.length - 1)];

  const toggleVote = useCallback(async () => {
    if (!votingOpen || votePending) return;
    const next = !voted;
    setVoteError(null);
    setVoted(next);
    setVoteCount((count) => Math.max(0, count + (next ? 1 : -1)));
    setVotePending(true);
    try {
      const response = await fetch(`/api/competitions/${slug}/entries/${entry.id}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next }),
      });
      const result = (await response.json().catch(() => null)) as
        | { active?: boolean; count?: number; error?: string }
        | null;
      if (!response.ok || typeof result?.active !== "boolean") {
        setVoted(!next);
        setVoteCount((count) => Math.max(0, count + (next ? -1 : 1)));
        setVoteError(result?.error ?? "Failed to record your vote.");
        return;
      }
      setVoted(result.active);
      setVoteCount(result.count ?? voteCount);
    } catch {
      setVoted(!next);
      setVoteCount((count) => Math.max(0, count + (next ? -1 : 1)));
      setVoteError("Failed to record your vote.");
    } finally {
      setVotePending(false);
    }
  }, [entry.id, slug, voteCount, voted, votingOpen, votePending]);

  const toggleBookmark = useCallback(async () => {
    const next = !bookmarked;
    setBookmarked(next);
    try {
      const response = await fetch(`/api/competitions/${slug}/entries/${entry.id}/bookmark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next }),
      });
      if (!response.ok) throw new Error("bookmark failed");
    } catch {
      setBookmarked(!next);
    }
  }, [bookmarked, entry.id, slug]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <Link
        href={`/dashboard/competitions/${slug}#entries`}
        className="inline-flex items-center gap-1.5 font-body text-xs font-semibold text-foreground-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft size={14} strokeWidth={2.5} />
        Back to Week {String(weekNumber).padStart(2, "0")}
      </Link>

      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ── The design ─────────────────────────────────────────────── */}
        <section>
          <div className="overflow-hidden rounded-2xl bg-background-subtle shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={activeImage?.url ?? entry.cover_image_url}
              alt={entry.title}
              className="max-h-[70vh] w-full object-contain"
            />
          </div>

          {gallery.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {gallery.map((image, index) => (
                <button
                  key={`${image.url}-${index}`}
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  aria-label={`Show ${image.name}`}
                  aria-pressed={index === activeIndex}
                  className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-background-subtle transition-opacity ${
                    index === activeIndex ? "ring-2 ring-accent" : "opacity-70 hover:opacity-100"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── Everything about it ────────────────────────────────────── */}
        <aside className="flex flex-col gap-6">
          <div>
            <p className="font-body text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
              {competitionTitle}
            </p>
            <h1 className="mt-1.5 text-balance font-display text-xl font-semibold leading-tight text-foreground">
              {entry.title}
            </h1>

            <div className="mt-4 flex items-center gap-3">
              <AvatarImg
                url={entry.author_avatar_url}
                name={entry.author_name}
                size={40}
                className="h-10 w-10 shrink-0 rounded-full object-cover"
              />
              <div className="min-w-0">
                <p className="truncate font-body text-sm font-semibold text-foreground">
                  {entry.author_name}
                </p>
                <p className="truncate font-body text-xs text-foreground-muted">
                  {entry.author_role || "Designer"}
                </p>
              </div>
            </div>
          </div>

          {entry.description && (
            <p className="whitespace-pre-line font-body text-sm leading-relaxed text-foreground-muted">
              {entry.description}
            </p>
          )}

          {entry.tools.length > 0 && (
            <div>
              <h2 className="font-body text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
                Tools
              </h2>
              <p className="mt-1.5 font-body text-sm text-foreground-muted">
                {entry.tools.join(" · ")}
              </p>
            </div>
          )}

          {(entry.figma_url || entry.prototype_url) && (
            <div className="flex flex-wrap gap-2">
              {entry.figma_url && (
                <a
                  href={entry.figma_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-surface-raised px-3 py-2 font-body text-xs font-semibold text-foreground-muted shadow-xs transition-colors hover:text-foreground"
                >
                  <ExternalLink size={14} strokeWidth={2.5} /> Figma file
                </a>
              )}
              {entry.prototype_url && (
                <a
                  href={entry.prototype_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-surface-raised px-3 py-2 font-body text-xs font-semibold text-foreground-muted shadow-xs transition-colors hover:text-foreground"
                >
                  <ExternalLink size={14} strokeWidth={2.5} /> Prototype
                </a>
              )}
            </div>
          )}

          {entry.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {entry.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-background-subtle px-2.5 py-1 font-body text-[11px] text-foreground-muted"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void toggleVote()}
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
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 font-body text-sm font-semibold shadow-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                voted ? "bg-accent/15 text-accent" : "bg-surface-raised text-foreground-muted hover:text-foreground"
              }`}
            >
              {votePending ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <Heart size={15} strokeWidth={2.5} fill={voted ? "currentColor" : "none"} />
              )}
              <span className="tabular-nums">{voteCount.toLocaleString("en-IN")}</span>
              <span className="font-normal text-foreground-subtle">{voted ? "voted" : "vote"}</span>
            </button>

            <button
              type="button"
              onClick={() => void toggleBookmark()}
              aria-pressed={bookmarked}
              aria-label={bookmarked ? "Remove from saved entries" : "Save this entry"}
              className={`inline-flex h-[42px] w-[42px] items-center justify-center rounded-lg shadow-xs transition-colors ${
                bookmarked ? "bg-accent/15 text-accent" : "bg-surface-raised text-foreground-muted hover:text-foreground"
              }`}
            >
              <Bookmark size={16} strokeWidth={2.5} fill={bookmarked ? "currentColor" : "none"} />
            </button>

            <ShareButton
              url={`/dashboard/competitions/${slug}/entries/${entry.id}`}
              title={`${entry.title} — ${entry.author_name}`}
              variant="button"
            />
          </div>

          {voteError && (
            <p role="alert" className="font-body text-xs text-[var(--signal)]">
              {voteError}
            </p>
          )}
          {!votingOpen && (
            <p className="font-body text-xs text-foreground-subtle">
              Voting is closed for this challenge.
            </p>
          )}
        </aside>
      </div>

      <CommentThread
        slug={slug}
        entryId={entry.id}
        comments={comments}
        onCommentsChange={setComments}
        currentUserId={currentUserId}
        commentingOpen={commentingOpen}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Discussion
// ---------------------------------------------------------------------------

function CommentThread({
  slug,
  entryId,
  comments,
  onCommentsChange,
  currentUserId,
  commentingOpen,
}: {
  slug: string;
  entryId: string;
  comments: CompetitionComment[];
  onCommentsChange: (comments: CompetitionComment[]) => void;
  currentUserId: string;
  commentingOpen: boolean;
}) {
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = comments.reduce((count, comment) => count + 1 + comment.replies.length, 0);

  async function submit(parentId: string | null) {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);

    try {
      const response = await fetch(`/api/competitions/${slug}/entries/${entryId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, parent_id: parentId }),
      });
      const result = (await response.json().catch(() => null)) as
        | { comments?: CompetitionComment[]; error?: string }
        | null;

      if (!response.ok || !result?.comments) {
        setError(result?.error ?? "Failed to post your comment.");
        return;
      }

      // The API returns the whole thread; replacing local state keeps replies
      // and ordering exactly right instead of guessing where it belongs.
      onCommentsChange(result.comments);
      setBody("");
      setReplyTo(null);
    } catch {
      setError("Failed to post your comment.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="mt-10 max-w-3xl">
      <h2 className="flex items-center gap-2 font-display text-base font-semibold text-foreground">
        <MessageCircle size={16} strokeWidth={2.5} />
        Discussion
        <span className="font-body text-xs font-normal text-foreground-subtle">{total}</span>
      </h2>

      {commentingOpen ? (
        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(replyTo);
          }}
        >
          {replyTo && (
            <p className="mb-2 font-body text-[11px] text-foreground-subtle">
              Replying to a comment ·{" "}
              <button
                type="button"
                className="font-semibold text-accent hover:underline"
                onClick={() => setReplyTo(null)}
              >
                cancel
              </button>
            </p>
          )}
          <div className="flex items-end gap-2 rounded-xl bg-surface-raised p-2 shadow-sm">
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Talk about the work — what works, what you'd try next."
              className="min-h-11 flex-1 resize-y bg-transparent px-2 py-1.5 font-body text-sm text-foreground outline-none placeholder:text-foreground-subtle"
            />
            <button
              type="submit"
              disabled={!body.trim() || sending}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground transition-[filter] hover:brightness-110 disabled:opacity-40"
              aria-label="Post comment"
            >
              {sending ? <Spinner className="h-4 w-4" /> : <Send size={15} strokeWidth={2.5} />}
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-2 font-body text-xs text-[var(--signal)]">
              {error}
            </p>
          )}
        </form>
      ) : (
        <p className="mt-3 font-body text-xs text-foreground-subtle">
          This challenge is archived, so the discussion is closed.
        </p>
      )}

      <ul className="mt-6 flex flex-col gap-5">
        {comments.map((comment) => (
          <li key={comment.id}>
            <CommentRow comment={comment} currentUserId={currentUserId} />
            {comment.replies.length > 0 && (
              <ul className="mt-4 flex flex-col gap-4 pl-5">
                {comment.replies.map((reply) => (
                  <li key={reply.id}>
                    <CommentRow comment={reply} currentUserId={currentUserId} />
                  </li>
                ))}
              </ul>
            )}
            {commentingOpen && !comment.parent_id && (
              <button
                type="button"
                onClick={() => setReplyTo(comment.id)}
                className="mt-2 font-body text-[11px] font-semibold text-foreground-subtle transition-colors hover:text-foreground"
              >
                Reply
              </button>
            )}
          </li>
        ))}
      </ul>

      {comments.length === 0 && (
        <p className="mt-5 font-body text-sm text-foreground-muted">
          No comments yet. Start the conversation.
        </p>
      )}
    </section>
  );
}

function CommentRow({ comment, currentUserId }: { comment: CompetitionComment; currentUserId: string }) {
  return (
    <div className="flex gap-3">
      <AvatarImg
        url={comment.author_avatar_url}
        name={comment.author_name}
        size={32}
        className="h-8 w-8 shrink-0 rounded-full object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          <span className="font-body text-xs font-semibold text-foreground">
            {comment.author_name}
            {comment.user_id === currentUserId && (
              <span className="ml-1 font-normal text-foreground-subtle">you</span>
            )}
          </span>
          <span className="font-body text-[11px] text-foreground-subtle">
            {formatRelativeDate(comment.created_at)}
          </span>
        </p>
        <p className="mt-1 whitespace-pre-line font-body text-sm leading-relaxed text-foreground-muted">
          {comment.body}
        </p>
      </div>
    </div>
  );
}
