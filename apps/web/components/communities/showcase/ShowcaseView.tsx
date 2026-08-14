"use client";

import { useEffect, useMemo, useState } from "react";
import { useGuardedRouter } from "@/lib/navigation-guard";
import {
  Box,
  CalendarClock,
  ChevronDown,
  CircleEllipsis,
  Image,
  LayoutGrid,
  Monitor,
  PenTool,
  Play,
  Plus,
  Tag,
} from "lucide-react";
import { CreateShowcaseModal } from "./CreateShowcaseModal";
import {
  SHOWCASE_CATEGORIES,
  type ShowcaseCategory,
  type ShowcasePost,
} from "./types";
import { communityFeedLayout } from "../feed-layout";
import { ShowcaseCard } from "./ShowcaseCard";
import { fetchJsonCached, getCachedRequest, initRequestCache, patchCachedRequest } from "@/lib/request-cache";
import { dedupeFetch } from "@/lib/dedupe-fetch";

const STALE = 30_000;

export function ShowcaseView({
  communityId,
  currentUserId,
}: {
  communityId: string;
  currentUserId: string;
}) {
  const router = useGuardedRouter();
  initRequestCache(currentUserId);
  const requestUrl = `/api/communities/${communityId}/showcase`;
  const cached = getCachedRequest<{ posts?: ShowcasePost[]; nextCursor?: string | null }>(requestUrl, currentUserId);
  const [posts, setPosts] = useState<ShowcasePost[]>(cached?.posts ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(cached?.nextCursor ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [category, setCategory] = useState<ShowcaseCategory | "all">("all");
  const [sort, setSort] = useState<"newest" | "popular">("newest");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ShowcasePost | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchJsonCached<{ posts?: ShowcasePost[]; nextCursor?: string | null }>(
      requestUrl,
      { staleMs: STALE },
      currentUserId,
    )
      .then((data) => {
        if (!cancelled) {
          setPosts(data.posts ?? []);
          setNextCursor(data.nextCursor ?? null);
        }
      })
      .catch(() => setError("We couldn't load the showcase."))
      .finally(() => setLoading(false));
    return () => { cancelled = true; };
  }, [currentUserId, requestUrl]);

  const visible = useMemo(
    () =>
      posts
        .filter((post) => category === "all" || post.category === category)
        .sort((a, b) =>
          sort === "popular"
            ? b.like_count + b.comment_count - a.like_count - a.comment_count
            : Date.parse(b.created_at) - Date.parse(a.created_at),
        ),
    [posts, category, sort],
  );

  function replacePosts(next: ShowcasePost[]) {
    setPosts(next);
    patchCachedRequest<{ posts?: ShowcasePost[] }>(
      requestUrl,
      (current) => ({ ...current, posts: next }),
      currentUserId,
    );
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(`${requestUrl}?cursor=${encodeURIComponent(nextCursor)}`);
      if (!response.ok) throw new Error();
      const data = await response.json() as { posts?: ShowcasePost[]; nextCursor?: string | null };
      const byId = new Map(posts.map((post) => [post.id, post]));
      for (const post of data.posts ?? []) byId.set(post.id, post);
      replacePosts([...byId.values()]);
      setNextCursor(data.nextCursor ?? null);
      setError(null);
    } catch {
      setError("We couldn't load more showcase posts.");
    } finally {
      setLoadingMore(false);
    }
  }

  function patch(id: string, change: Partial<ShowcasePost>) {
    replacePosts(
      posts.map((post) => (post.id === id ? { ...post, ...change } : post)),
    );
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

    const response = await dedupeFetch(
      `/api/communities/${communityId}/showcase/${post.id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      },
      { cooldownMode: "url" },
    );

    if (!response.ok) {
      patch(post.id, {
        [key]: active,
        ...(action === "like" ? { like_count: post.like_count } : {}),
      });
    }
  }

  async function remove(post: ShowcasePost) {
    if (!confirm("Delete this showcase post? This cannot be undone.")) return;
    const response = await fetch(
      `/api/communities/${communityId}/showcase/${post.id}`,
      { method: "DELETE" },
    );
    if (response.ok) {
      replacePosts(posts.filter((item) => item.id !== post.id));
    }
  }

  const open = (post: ShowcasePost) =>
    router.push(`/dashboard/communities/${communityId}/showcase/${post.id}`);

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div
        className={`${communityFeedLayout.content} ${
          !loading && posts.length
            ? communityFeedLayout.pageHeaderWithFilters
            : communityFeedLayout.pageHeader
        }`}
      >
        <div className={communityFeedLayout.pageHeaderMain}>
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold text-foreground">
              Showcase
            </h2>
            <p className="mt-1 max-w-sm text-pretty font-body text-sm leading-5 text-foreground-muted">
              Share what you&apos;re making, unpack your process, and get useful
              feedback from fellow designers.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-2.5 font-body text-sm font-medium text-accent-foreground hover:bg-accent-hover"
          >
            <Plus size={14} />
            Share your work
          </button>
        </div>
        {!loading && posts.length > 0 && (
          <div
            className={`${communityFeedLayout.pageHeaderFilters} flex items-center gap-2 overflow-x-auto pb-1`}
          >
            {SHOWCASE_CATEGORIES.map((item) => {
              const Icon = {
                all: LayoutGrid,
                ui_ux: Monitor,
                branding: Tag,
                illustration: PenTool,
                motion: Play,
                product: Box,
                other: CircleEllipsis,
              }[item.value];

              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setCategory(item.value)}
                  aria-pressed={category === item.value}
                  className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 font-body text-xs ${
                    category === item.value
                      ? "border-accent bg-accent/5 text-accent"
                      : "border-border text-foreground-muted"
                  }`}
                >
                  <Icon size={14} />
                  {item.label}
                </button>
              );
            })}
            <div className="relative shrink-0">
              <CalendarClock
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-muted"
              />
              <select
                value={sort}
                onChange={(event) =>
                  setSort(event.target.value as "newest" | "popular")
                }
                aria-label="Sort showcase posts"
                className="h-8 appearance-none rounded-lg border border-border bg-surface-raised py-1 pl-8 pr-8 font-body text-xs text-foreground"
              >
                <option value="newest">Newest first</option>
                <option value="popular">Most discussed</option>
              </select>
              <ChevronDown
                size={14}
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground-muted"
              />
            </div>
          </div>
        )}
      </div>

      <div className={communityFeedLayout.content}>
        {loading ? (
          <p className="py-24 text-center font-body text-sm text-foreground-muted">
            Loading showcase…
          </p>
        ) : error ? (
          <p className="py-24 text-center font-body text-sm text-foreground-muted">
            {error}
          </p>
        ) : !visible.length ? (
          <div className={communityFeedLayout.emptyState}>
            <Image size={24} className={communityFeedLayout.emptyIcon} />
            <h3 className={communityFeedLayout.emptyTitle}>
              No showcase posts yet
            </h3>
            <p className={communityFeedLayout.emptyDescription}>
              Be the first to share your work.
            </p>
          </div>
        ) : (
          <div>
            {visible.map((post, index) => (
              <ShowcaseCard
                key={post.id}
                post={post}
                currentUserId={currentUserId}
                isLast={index === visible.length - 1}
                onOpen={() => open(post)}
                onToggleLike={() => void toggle(post, "like")}
                onToggleSave={() => void toggle(post, "save")}
                onEdit={() => setEditing(post)}
                onDelete={() => void remove(post)}
              />
            ))}
            {nextCursor && (
              <div className="flex justify-center py-6">
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="rounded-lg border border-border px-4 py-2 font-body text-sm text-foreground hover:bg-surface-raised disabled:opacity-60"
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {creating && (
        <CreateShowcaseModal
          communityId={communityId}
          onClose={() => setCreating(false)}
          onCreated={(post) => replacePosts([post, ...posts])}
        />
      )}
      {editing && (
        <CreateShowcaseModal
          communityId={communityId}
          post={editing}
          onClose={() => setEditing(null)}
          onUpdated={(post) =>
            replacePosts(
              posts.map((item) => (item.id === post.id ? post : item)),
            )
          }
        />
      )}
    </div>
  );
}
