import Link from "next/link";
import { Flame } from "lucide-react";
import { CommentIcon } from "@/components/communities/CommentIcon";
import { HeartIcon } from "@/components/communities/HeartIcon";
import { TRENDING_WINDOW_DAYS, type TrendingPost } from "@/lib/home/trending";

/**
 * Trending posts — the week's most engaging public posts, in rank order.
 *
 * Ranking fades engagement by age (see lib/home/trending.ts), but the numbers
 * on the row are the raw like and comment counts, so nothing a member reads is
 * a score they cannot account for. Each row links to the post itself.
 */
export function TrendingPostsCard({ posts }: { posts: TrendingPost[] }) {
  return (
    <section
      aria-labelledby="home-trending-heading"
      className="overflow-hidden rounded-xl border border-border bg-background-subtle"
    >
      <div className="flex items-center gap-2 px-4 pb-1 pt-4">
        <Flame size={15} strokeWidth={2.5} className="text-foreground-muted" aria-hidden="true" />
        <h2
          id="home-trending-heading"
          className="font-display text-sm font-semibold text-foreground"
        >
          Trending Posts
        </h2>
      </div>
      <p className="px-4 pb-3 font-body text-[11px] text-foreground-subtle">
        Most loved in the last {TRENDING_WINDOW_DAYS} days
      </p>

      {posts.length === 0 ? (
        <p className="px-4 pb-4 font-body text-xs leading-relaxed text-foreground-muted">
          Nothing is trending yet. Likes and comments push a post up here.
        </p>
      ) : (
        <ol className="flex flex-col px-4 pb-3">
          {posts.map((post, index) => (
            <li key={post.id} className="py-2.5">
              <Link
                href={`/dashboard/threads/${post.id}`}
                className="group flex items-start gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span
                  className="w-4 shrink-0 pt-px font-mono text-xs text-foreground-subtle tabular-nums"
                  aria-hidden="true"
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 font-body text-sm font-medium leading-snug text-foreground group-hover:underline">
                    {post.title}
                  </span>
                  <span className="mt-1 flex items-center gap-2.5 font-body text-[11px] text-foreground-muted">
                    <span
                      className="flex shrink-0 items-center gap-1"
                      aria-label={`${post.like_count} ${post.like_count === 1 ? "like" : "likes"}`}
                    >
                      <HeartIcon size={11} strokeWidth={1.6} className="shrink-0" />
                      <span className="tabular-nums">{post.like_count}</span>
                    </span>
                    <span
                      className="flex shrink-0 items-center gap-1"
                      aria-label={`${post.comment_count} ${post.comment_count === 1 ? "comment" : "comments"}`}
                    >
                      <CommentIcon className="h-[11px] w-[11px] shrink-0" />
                      <span className="tabular-nums">{post.comment_count}</span>
                    </span>
                    {post.community_name && (
                      <span className="truncate text-foreground-subtle" title={post.community_name}>
                        {post.community_name}
                      </span>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
