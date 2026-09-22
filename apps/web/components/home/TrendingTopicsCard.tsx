import { TrendingUp } from "lucide-react";
import { TRENDING_WINDOW_DAYS, type TrendingTopic } from "@/lib/home/trending";

function formatPosts(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "Post" : "Posts"}`;
}

/**
 * Trending topics — the tags members are attaching to public threads this week,
 * ranked by how many threads used them. The percentage is each topic's share of
 * the week's tagged threads, so the column reads as "how much of the
 * conversation this is".
 */
export function TrendingTopicsCard({ topics }: { topics: TrendingTopic[] }) {
  return (
    <section
      aria-labelledby="home-trending-heading"
      className="overflow-hidden rounded-xl border border-border bg-background-subtle"
    >
      <div className="flex items-center gap-2 px-4 pb-1 pt-4">
        <TrendingUp size={15} strokeWidth={2.5} className="text-foreground-muted" aria-hidden="true" />
        <h2
          id="home-trending-heading"
          className="font-display text-sm font-semibold text-foreground"
        >
          Trending Topics
        </h2>
      </div>
      <p className="px-4 pb-3 font-body text-[11px] text-foreground-subtle">
        Most tagged topics in the last {TRENDING_WINDOW_DAYS} days
      </p>

      {topics.length === 0 ? (
        <p className="border-t border-border-subtle px-4 py-3.5 font-body text-xs leading-relaxed text-foreground-muted">
          No topics yet. Add a topic when you post a thread and it will show up here.
        </p>
      ) : (
        <ol className="flex flex-col">
          {topics.map((topic, index) => (
            <li
              key={topic.topic}
              className="flex items-start gap-3 border-t border-border-subtle px-4 py-2.5"
            >
              <span
                className="w-4 shrink-0 pt-px font-mono text-xs text-foreground-subtle tabular-nums"
                aria-hidden="true"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-body text-sm font-medium text-foreground">
                  {topic.topic}
                </span>
                <span className="mt-0.5 block font-body text-[11px] text-foreground-muted">
                  {formatPosts(topic.post_count)}
                </span>
              </span>
              <span className="shrink-0 pt-px font-body text-sm font-medium text-foreground tabular-nums">
                {topic.share.toFixed(1)}%
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
