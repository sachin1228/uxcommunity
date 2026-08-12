"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bookmark,
  ExternalLink,
  Heart,
  Image,
  Loader2,
  MessageCircle,
  Plus,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { CreateShowcaseModal } from "./CreateShowcaseModal";
import {
  SHOWCASE_CATEGORIES,
  SHOWCASE_TYPES,
  type ShowcaseCategory,
  type ShowcasePost,
} from "./types";

const cache = new Map<string, { posts: ShowcasePost[]; at: number }>();
const STALE = 30_000;

function Comments({
  communityId,
  post,
  onClose,
  onAdded,
}: {
  communityId: string;
  post: ShowcasePost;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [comments, setComments] = useState<
    { id: string; body: string; author_name: string; created_at: string }[]
  >([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`/api/communities/${communityId}/showcase/${post.id}`)
      .then((r) => r.json())
      .then((d) => setComments(d.comments ?? []));
  }, [communityId, post.id]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    const response = await fetch(
      `/api/communities/${communityId}/showcase/${post.id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "comment", body }),
      },
    );
    const data = await response.json();
    if (response.ok) {
      setComments((current) => [
        ...current,
        { ...data.comment, author_name: "You" },
      ]);
      setBody("");
      onAdded();
    }
    setBusy(false);
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h3 className="font-display font-semibold text-foreground">
              Feedback
            </h3>
            <p className="font-body text-xs text-foreground-muted">
              {post.title}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close">
            <X size={19} className="text-foreground-muted" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-4">
            {comments.length ? (
              comments.map((comment) => (
                <div key={comment.id}>
                  <p className="font-body text-xs font-semibold text-foreground">
                    {comment.author_name}
                  </p>
                  <p className="mt-1 font-body text-sm leading-relaxed text-foreground-muted">
                    {comment.body}
                  </p>
                </div>
              ))
            ) : (
              <p className="py-8 text-center font-body text-sm text-foreground-muted">
                Start a thoughtful conversation.
              </p>
            )}
          </div>
        </div>
        <form
          onSubmit={submit}
          className="flex gap-2 border-t border-border p-4"
        >
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Leave constructive feedback…"
            className="min-w-0 flex-1 rounded-xl border border-border bg-surface-raised px-3 py-2 font-body text-sm text-foreground outline-none focus:border-accent"
          />
          <button
            disabled={busy}
            className="rounded-xl bg-accent p-2.5 text-accent-foreground"
            aria-label="Send comment"
          >
            {busy ? (
              <Loader2 size={17} className="animate-spin" />
            ) : (
              <Send size={17} />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

export function ShowcaseView({
  communityId,
}: {
  communityId: string;
  currentUserId: string;
}) {
  const cached = cache.get(communityId);
  const [posts, setPosts] = useState<ShowcasePost[]>(cached?.posts ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<ShowcaseCategory | "all">("all");
  const [sort, setSort] = useState<"newest" | "popular">("newest");
  const [creating, setCreating] = useState(false);
  const [commenting, setCommenting] = useState<ShowcasePost | null>(null);
  useEffect(() => {
    const hit = cache.get(communityId);
    if (hit && Date.now() - hit.at < STALE) return;
    setLoading(true);
    fetch(`/api/communities/${communityId}/showcase`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        cache.set(communityId, { posts: data.posts, at: Date.now() });
        setPosts(data.posts);
      })
      .catch(() => setError("We couldn't load the showcase."))
      .finally(() => setLoading(false));
  }, [communityId]);
  const visible = useMemo(
    () =>
      posts
        .filter((post) => category === "all" || post.category === category)
        .sort((a, b) =>
          sort === "popular"
            ? b.like_count + b.comment_count - (a.like_count + a.comment_count)
            : Date.parse(b.created_at) - Date.parse(a.created_at),
        ),
    [posts, category, sort],
  );
  function patch(id: string, change: Partial<ShowcasePost>) {
    setPosts((current) => {
      const next = current.map((post) =>
        post.id === id ? { ...post, ...change } : post,
      );
      cache.set(communityId, { posts: next, at: Date.now() });
      return next;
    });
  }
  async function toggle(post: ShowcasePost, action: "like" | "save") {
    const key = action === "like" ? "user_liked" : "user_saved";
    const active = post[key];
    patch(post.id, {
      [key]: !active,
      ...(action === "like"
        ? { like_count: post.like_count + (active ? -1 : 1) }
        : {}),
    });
    const response = await fetch(
      `/api/communities/${communityId}/showcase/${post.id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      },
    );
    if (!response.ok)
      patch(post.id, {
        [key]: active,
        ...(action === "like" ? { like_count: post.like_count } : {}),
      });
  }
  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-4xl px-5 py-7 md:px-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-2 inline-flex items-center gap-1.5 font-body text-xs font-medium text-accent">
              <Sparkles size={14} />
              Community showcase
            </p>
            <h1 className="text-balance font-display text-2xl font-semibold text-foreground md:text-3xl">
              Work worth talking about.
            </h1>
            <p className="mt-2 max-w-xl font-body text-sm leading-relaxed text-foreground-muted">
              Share what you&apos;re making, unpack your process, and get useful
              feedback from fellow designers.
            </p>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-body text-sm font-medium text-accent-foreground"
          >
            <Plus size={16} />
            Share your work
          </button>
        </div>
        <div className="mt-7 flex flex-col gap-3 border-y border-border py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {SHOWCASE_CATEGORIES.map((item) => (
              <button
                key={item.value}
                onClick={() => setCategory(item.value)}
                className={`shrink-0 rounded-full border px-3 py-1.5 font-body text-xs ${category === item.value ? "border-accent bg-accent/10 text-accent" : "border-border text-foreground-muted hover:text-foreground"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as "newest" | "popular")}
            className="rounded-lg border border-border bg-surface-raised px-3 py-2 font-body text-xs text-foreground outline-none"
          >
            <option value="newest">Newest first</option>
            <option value="popular">Most discussed</option>
          </select>
        </div>
        {loading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="animate-spin text-accent" />
          </div>
        ) : error ? (
          <p className="py-24 text-center font-body text-sm text-foreground-muted">
            {error}
          </p>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center py-24 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface-raised">
              <Image className="text-foreground-muted" />
            </div>
            <h2 className="mt-5 font-display text-lg font-semibold text-foreground">
              The wall is ready for your work.
            </h2>
            <p className="mt-2 max-w-sm font-body text-sm text-foreground-muted">
              Share a polished project, a rough idea, or something you want the
              community to critique.
            </p>
            <button
              onClick={() => setCreating(true)}
              className="mt-5 rounded-xl border border-accent/40 px-4 py-2 font-body text-sm text-accent"
            >
              Be the first to share
            </button>
          </div>
        ) : (
          <div className="relative mt-6 before:pointer-events-none before:absolute before:left-1/2 before:top-0 before:w-screen before:-translate-x-1/2 before:border-t before:border-border">
            {visible.map((post, index) => (
              <article
                key={post.id}
                className={`relative py-6 ${index === visible.length - 1 ? "" : "after:pointer-events-none after:absolute after:bottom-0 after:left-1/2 after:w-screen after:-translate-x-1/2 after:border-b after:border-border"}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    {post.author.avatar_url ? (
                      <img
                        src={post.author.avatar_url}
                        alt={post.author.name}
                        className="size-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex size-10 items-center justify-center rounded-full bg-accent/15 font-body text-sm font-semibold text-accent">
                        {post.author.name.slice(0, 1)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-body text-[15px] font-semibold text-foreground">
                        {post.author.name}
                      </p>
                      <p className="font-body text-[11px] text-foreground-subtle">
                        {SHOWCASE_TYPES.find((item) => item.value === post.post_type)?.label}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full border border-border px-2.5 py-1 font-body text-[11px] text-foreground-muted">
                    {SHOWCASE_CATEGORIES.find((item) => item.value === post.category)?.label}
                  </span>
                </div>
                <h2 className="mt-3 text-pretty font-display text-base font-semibold leading-snug text-foreground">
                  {post.title}
                </h2>
                {post.description && (
                  <p className="mt-1.5 line-clamp-3 font-body text-xs leading-relaxed text-foreground-muted">
                    {post.description}
                  </p>
                )}
                {post.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {post.tags.map((tag) => (
                      <span key={tag} className="font-body text-xs text-foreground-subtle">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-3 max-h-[480px] overflow-hidden rounded-xl border border-border bg-surface-raised">
                  <img
                    src={post.image_url}
                    alt={`Preview of ${post.title}`}
                    className="max-h-[480px] w-full object-cover transition-opacity hover:opacity-95"
                  />
                </div>
                <div className="mt-3 flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => toggle(post, "like")}
                      aria-label={post.user_liked ? "Unlike showcase" : "Like showcase"}
                      aria-pressed={post.user_liked}
                      className="group/like inline-flex items-center gap-2"
                    >
                      <Heart
                        size={20}
                        strokeWidth={2}
                        fill={post.user_liked ? "currentColor" : "none"}
                        className={`transition-transform duration-150 ease-out group-hover/like:scale-110 ${post.user_liked ? "text-red-500" : "text-foreground"}`}
                      />
                      <span
                        className={`font-body text-sm font-semibold tabular-nums ${post.user_liked ? "text-red-500" : "text-foreground"}`}
                      >
                        {post.like_count}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCommenting(post)}
                      aria-label={`${post.comment_count} ${post.comment_count === 1 ? "comment" : "comments"}`}
                      className="group/comment inline-flex items-center gap-1.5 font-body text-xs font-semibold text-foreground"
                    >
                      <MessageCircle
                        size={20}
                        strokeWidth={2}
                        className="transition-transform duration-150 ease-out group-hover/comment:scale-110"
                      />
                      {post.comment_count} {post.comment_count === 1 ? "comment" : "comments"}
                    </button>
                    <div className="flex-1" />
                    {post.project_url && (
                      <a
                        href={post.project_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 font-body text-xs font-medium text-accent hover:underline"
                      >
                        View project
                        <ExternalLink size={14} />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => toggle(post, "save")}
                      aria-label={post.user_saved ? "Unsave showcase" : "Save showcase"}
                      aria-pressed={post.user_saved}
                      className="group/save flex size-7 items-center justify-center rounded-md text-foreground"
                    >
                      <Bookmark
                        size={20}
                        strokeWidth={2}
                        fill={post.user_saved ? "currentColor" : "none"}
                        className="transition-transform duration-150 ease-out group-hover/save:scale-110"
                      />
                    </button>
                  </div>
              </article>
            ))}
          </div>
        )}
      </div>
      {creating && (
        <CreateShowcaseModal
          communityId={communityId}
          onClose={() => setCreating(false)}
          onCreated={(post) => {
            const next = [post, ...posts];
            setPosts(next);
            cache.set(communityId, { posts: next, at: Date.now() });
          }}
        />
      )}{" "}
      {commenting && (
        <Comments
          communityId={communityId}
          post={commenting}
          onClose={() => setCommenting(null)}
          onAdded={() =>
            patch(commenting.id, {
              comment_count: commenting.comment_count + 1,
            })
          }
        />
      )}
    </div>
  );
}
