"use client";

// The library curation console: handpick the threads, showcase posts and
// resources that appear on the member Library page. The top block is the
// shelf itself, in order (move up/down, remove); below it the pick queue —
// every post of the active kind with its engagement counts, ranked by
// engagement (likes + comments; resources: saves + comments) or recency, so
// the best posts surface first without leaving the page.

import { useCallback, useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Loader2,
  Search,
  Star,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CONTENT_KIND_ICONS } from "@/components/communities/content-kind-icons";
import { Spinner } from "@/components/ui/Spinner";
import { THREAD_CATEGORIES } from "@/lib/communities/models/threads";
import { SHOWCASE_CATEGORY_OPTIONS } from "@/lib/communities/showcase-categories";
import { RESOURCE_TYPES } from "@/lib/communities/models/resources";

type Kind = "thread" | "showcase" | "resource";
type Sort = "engagement" | "newest";

interface FeaturedItem {
  item_type: Kind;
  item_id: string;
  position: number;
  title: string | null;
  category: string | null;
  community_name: string | null;
  author_name: string | null;
  is_public: boolean | null;
  like_count: number;
  comment_count: number;
  created_at: string | null;
}

interface Candidate {
  id: string;
  title: string;
  category: string;
  community_name: string | null;
  author_name: string | null;
  is_public: boolean;
  created_at: string;
  like_count: number;
  comment_count: number;
  featured: boolean;
}

const KINDS: Array<{ value: Kind; label: string; badge: string; icon: LucideIcon }> = [
  { value: "thread", label: "Threads", badge: "Thread", icon: CONTENT_KIND_ICONS.thread },
  { value: "showcase", label: "Showcase", badge: "Showcase", icon: CONTENT_KIND_ICONS.showcase },
  { value: "resource", label: "Resources", badge: "Resource", icon: CONTENT_KIND_ICONS.resource },
];

const PAGE_SIZE = 25;

/** The kind's own vocabulary labels a category value for display. */
function categoryLabel(kind: Kind, value: string | null): string | null {
  if (!value) return null;
  if (kind === "thread") return THREAD_CATEGORIES.find((item) => item.value === value)?.label ?? value;
  if (kind === "showcase") return SHOWCASE_CATEGORY_OPTIONS.find((item) => item.value === value)?.label ?? value;
  return RESOURCE_TYPES.find((item) => item.value === value)?.label ?? value;
}

/** "12 likes · 3 comments" — resources count saves, not likes. */
function engagementLabel(kind: Kind, likes: number, comments: number): string {
  const likeWord = kind === "resource" ? "save" : "like";
  return `${likes} ${likeWord}${likes === 1 ? "" : "s"} · ${comments} comment${comments === 1 ? "" : "s"}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function KindBadge({ kind }: { kind: Kind }) {
  const label = KINDS.find((item) => item.value === kind)?.badge ?? kind;
  return (
    <span className="rounded-full bg-surface-raised px-1.5 py-0.5 font-body text-[10px] uppercase tracking-wide text-foreground-muted">
      {label}
    </span>
  );
}

export default function AdminLibraryPage() {
  const [featured, setFeatured] = useState<FeaturedItem[]>([]);
  const [featuredLoading, setFeaturedLoading] = useState(true);
  const [featuredError, setFeaturedError] = useState(false);
  const [kind, setKind] = useState<Kind>("thread");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("engagement");
  const [page, setPage] = useState(1);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Typing settles before the request fires; every keystroke would otherwise
  // re-order and re-page the table under the admin's cursor.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const fetchFeatured = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/library/featured");
      if (!res.ok) {
        setFeaturedError(true);
        return;
      }
      const data = await res.json();
      setFeatured(data.items ?? []);
      setFeaturedError(false);
    } catch {
      setFeaturedError(true);
    } finally {
      setFeaturedLoading(false);
    }
  }, []);

  const fetchCandidates = useCallback(async () => {
    try {
      const params = new URLSearchParams({ kind, sort, page: String(page) });
      if (search) params.set("search", search);
      const res = await fetch(`/api/admin/library?${params}`);
      const data = await res.json();
      setCandidates(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch {
      // ignore — the table keeps its last good page
    } finally {
      setLoading(false);
    }
  }, [kind, sort, search, page]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchFeatured();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchFeatured]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchCandidates();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchCandidates]);

  async function curate(type: Kind, id: string, action: "feature" | "unfeature" | "up" | "down") {
    setBusyKey(`${type}:${id}`);
    setActionError(null);
    try {
      const res = await fetch("/api/admin/library/featured", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, id, action }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setActionError(payload?.message ?? payload?.error ?? "Failed to update the library.");
        return;
      }
      await Promise.all([fetchFeatured(), fetchCandidates()]);
    } catch {
      setActionError("Failed to update the library.");
    } finally {
      setBusyKey(null);
    }
  }

  const featuredByKind: Record<Kind, FeaturedItem[]> = { thread: [], showcase: [], resource: [] };
  for (const item of featured) {
    if (featuredByKind[item.item_type]) featuredByKind[item.item_type].push(item);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">Library</h1>
          <p className="mt-0.5 font-body text-xs text-foreground-muted">
            Handpicked posts shown on the member Library page.
          </p>
        </div>
        <span className="font-mono text-xs text-foreground-muted">
          {featured.length} in the library
        </span>
      </div>

      {actionError && (
        <p role="alert" className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-body text-xs text-red-400">
          {actionError}
        </p>
      )}

      {/* The shelf */}
      <h2 className="mb-2 font-body text-[10px] font-medium uppercase tracking-wider text-foreground-muted">
        In the library
      </h2>
      <div className="mb-8 overflow-hidden rounded-xl border border-border bg-surface">
        {featuredLoading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-4 w-4" />
          </div>
        ) : featuredError ? (
          <p className="py-10 text-center font-body text-xs text-foreground-muted">
            Couldn&apos;t load the library. Reload the page to try again.
          </p>
        ) : featured.length === 0 ? (
          <p className="py-10 text-center font-body text-xs text-foreground-muted">
            Nothing in the library yet. Feature a post from the queue below.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem]">
              <thead>
                <tr className="border-b border-border">
                  {["#", "Post", "Community", "Engagement", "Order"].map((heading) => (
                    <th
                      key={heading}
                      className={`px-4 py-2.5 font-body text-[10px] font-medium uppercase tracking-wider text-foreground-muted ${
                        heading === "Order" ? "text-right" : "text-left"
                      }`}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {KINDS.map(({ value: itemKind }) => {
                  const group = featuredByKind[itemKind];
                  return group.map((item, idx) => {
                    const key = `${item.item_type}:${item.item_id}`;
                    const busy = busyKey === key;
                    return (
                      <tr
                        key={key}
                        className="border-b border-border-subtle align-top transition-colors last:border-b-0 hover:bg-surface-raised"
                      >
                        <td className="px-4 py-3">
                          <span className="font-mono text-[11px] text-foreground-subtle">{item.position}</span>
                        </td>
                        <td className="max-w-[22rem] px-4 py-3">
                          <p className="truncate font-body text-xs font-medium text-foreground">
                            {item.title ?? "Untitled"}
                          </p>
                          <p className="mt-0.5 flex items-center gap-1.5 font-body text-[11px] text-foreground-muted">
                            <KindBadge kind={item.item_type} />
                            {categoryLabel(item.item_type, item.category) && (
                              <span className="truncate">{categoryLabel(item.item_type, item.category)}</span>
                            )}
                          </p>
                        </td>
                        <td className="max-w-[14rem] px-4 py-3">
                          <p className="truncate font-body text-xs text-foreground-muted">
                            {item.community_name ?? "No community"}
                          </p>
                          <p className="truncate font-body text-[11px] text-foreground-subtle">
                            by {item.author_name ?? "Unknown member"}
                            {item.is_public === false && (
                              <span className="ml-1.5 rounded-full border border-border px-1.5 py-px text-[9px] uppercase tracking-wide">
                                Members only
                              </span>
                            )}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-[10px] text-foreground-muted">
                            {engagementLabel(item.item_type, item.like_count, item.comment_count)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => void curate(item.item_type, item.item_id, "up")}
                              disabled={idx === 0 || busy}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted transition-colors hover:text-foreground disabled:opacity-30 disabled:hover:text-foreground-muted"
                              aria-label={`Move ${item.title ?? "post"} up`}
                            >
                              <ArrowUp strokeWidth={2.5} size={13} />
                            </button>
                            <button
                              onClick={() => void curate(item.item_type, item.item_id, "down")}
                              disabled={idx === group.length - 1 || busy}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted transition-colors hover:text-foreground disabled:opacity-30 disabled:hover:text-foreground-muted"
                              aria-label={`Move ${item.title ?? "post"} down`}
                            >
                              <ArrowDown strokeWidth={2.5} size={13} />
                            </button>
                            <button
                              onClick={() => void curate(item.item_type, item.item_id, "unfeature")}
                              disabled={busy}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                              aria-label={`Remove ${item.title ?? "post"} from the library`}
                              title="Remove from the library"
                            >
                              {busy ? (
                                <Loader2 strokeWidth={2.5} size={13} className="animate-spin" />
                              ) : (
                                <X strokeWidth={2.5} size={13} />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* The pick queue */}
      <h2 className="mb-2 font-body text-[10px] font-medium uppercase tracking-wider text-foreground-muted">
        Add to the library
      </h2>

      <div className="mb-3 flex gap-0.5 border-b border-border">
        {KINDS.map(({ value, label, icon: Icon }) => {
          const isActive = kind === value;
          return (
            <button
              key={value}
              onClick={() => {
                setLoading(true);
                setKind(value);
                setPage(1);
              }}
              className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2 font-body text-xs font-medium transition-colors ${
                isActive
                  ? "border-accent text-accent"
                  : "border-transparent text-foreground-muted hover:text-foreground"
              }`}
            >
              <Icon strokeWidth={2.5} size={13} />
              {label}
            </button>
          );
        })}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[15rem] flex-1">
          <Search
            size={13}
            strokeWidth={2.5}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-foreground-subtle"
          />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search title or author…"
            className="w-full rounded-md border border-border bg-surface py-1.5 pr-2.5 pl-8 font-body text-xs text-foreground placeholder:text-foreground-subtle focus:border-accent focus:outline-none"
          />
        </div>
        <select
          value={sort}
          onChange={(event) => {
            setLoading(true);
            setSort(event.target.value as Sort);
            setPage(1);
          }}
          aria-label="Sort posts"
          className="h-[30px] rounded-md border border-border bg-surface px-2 font-body text-xs text-foreground focus:border-accent focus:outline-none"
        >
          <option value="engagement">Most engagement</option>
          <option value="newest">Newest first</option>
        </select>
        {search && (
          <button
            onClick={() => {
              setLoading(true);
              setSearchInput("");
              setSearch("");
              setPage(1);
            }}
            className="rounded-md px-2 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            Clear search
          </button>
        )}
      </div>

      <div className="mb-3 overflow-hidden rounded-xl border border-border bg-surface">
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-4 w-4" />
          </div>
        ) : candidates.length === 0 ? (
          <p className="py-10 text-center font-body text-xs text-foreground-muted">
            {search ? "Nothing matches that search." : "No posts of this kind yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem]">
              <thead>
                <tr className="border-b border-border">
                  {["Post", "Author", "Community", "Engagement", "Posted", ""].map((heading) => (
                    <th
                      key={heading}
                      className="px-4 py-2.5 text-left font-body text-[10px] font-medium uppercase tracking-wider text-foreground-muted"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {candidates.map((item, index) => {
                  const key = `${kind}:${item.id}`;
                  const busy = busyKey === key;
                  return (
                    <tr
                      key={item.id}
                      className={`${index < candidates.length - 1 ? "border-b border-border-subtle" : ""} align-top transition-colors hover:bg-surface-raised`}
                    >
                      <td className="max-w-[22rem] px-4 py-3">
                        <p className="truncate font-body text-xs font-medium text-foreground">
                          {item.title}
                        </p>
                        <p className="mt-0.5 font-body text-[11px] text-foreground-muted">
                          {categoryLabel(kind, item.category) ?? item.category}
                        </p>
                      </td>
                      <td className="max-w-[12rem] px-4 py-3">
                        <p className="truncate font-body text-xs text-foreground-muted">
                          {item.author_name ?? "Unknown member"}
                        </p>
                      </td>
                      <td className="max-w-[14rem] px-4 py-3">
                        <p className="truncate font-body text-xs text-foreground-muted">
                          {item.community_name ?? "No community"}
                        </p>
                        {!item.is_public && (
                          <p className="font-body text-[11px] text-foreground-subtle">
                            Members only — shown to its community
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-[10px] text-foreground-muted">
                          {engagementLabel(kind, item.like_count, item.comment_count)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="font-mono text-[10px] text-foreground-muted">
                          {formatDate(item.created_at)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <button
                            onClick={() => void curate(kind, item.id, item.featured ? "unfeature" : "feature")}
                            disabled={busy}
                            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-body text-xs transition-colors disabled:opacity-50 ${
                              item.featured
                                ? "border-accent/40 bg-accent/10 text-accent hover:bg-accent/15"
                                : "border-border text-foreground-muted hover:bg-surface-raised hover:text-foreground"
                            }`}
                          >
                            {busy ? (
                              <Loader2 strokeWidth={2.5} size={12} className="animate-spin" />
                            ) : (
                              <Star size={12} strokeWidth={2.5} fill={item.featured ? "currentColor" : "none"} />
                            )}
                            {item.featured ? "In library" : "Feature"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="font-body text-xs text-foreground-muted">
            Page {page} of {totalPages} · {total} post{total === 1 ? "" : "s"}
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                setLoading(true);
                setPage((current) => Math.max(1, current - 1));
              }}
              disabled={page === 1}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-40"
            >
              Prev
            </button>
            <button
              onClick={() => {
                setLoading(true);
                setPage((current) => Math.min(totalPages, current + 1));
              }}
              disabled={page === totalPages}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
