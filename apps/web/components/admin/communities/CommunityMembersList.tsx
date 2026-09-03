"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";
import type { CommunityMember, CommunityMemberSearchResult } from "./communityTypes";
import { fmtDate } from "./communityTypes";

interface Props {
  members: CommunityMember[];
  memberCount: number;
  /** When provided, a search box is shown that queries the full membership. */
  communityId?: string;
}

const PAGE_SIZE = 30;

function RoleBadge({ role }: { role?: string }) {
  if (role === "owner") {
    return (
      <span className="inline-flex items-center rounded-full bg-accent/10 border border-accent/20 px-2 py-0.5 font-body text-[10px] font-semibold text-accent">
        Owner
      </span>
    );
  }
  if (role === "admin") {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 font-body text-[10px] font-semibold text-amber-500">
        Admin
      </span>
    );
  }
  return null;
}

export function CommunityMembersList({ members, memberCount, communityId }: Props) {
  const router = useRouter();

  // Search state — only used when communityId is present. rows === null while
  // the search box is empty, so the (bounded) members prop is shown instead.
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [rows, setRows] = useState<CommunityMemberSearchResult[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  // The debounced query the current result list was loaded for — busyness is
  // derived from it, so no state is set synchronously inside the effect.
  const [loadedFor, setLoadedFor] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!communityId || !debouncedQ) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    fetch(`/api/admin/communities/${communityId}/members?page=0&search=${encodeURIComponent(debouncedQ)}`, {
      signal: ctrl.signal,
    })
      .then(async (r) => {
        if (ctrl.signal.aborted) return;
        const data = r.ok ? await r.json() : null;
        if (!data || ctrl.signal.aborted) { if (!data) setError("Failed to search members."); return; }
        setRows(data.members ?? []);
        setTotal(data.total ?? 0);
        setHasMore(data.has_more ?? false);
        setPage(0);
        setLoadedFor(debouncedQ);
        setError(null);
      })
      .catch((err) => { if (err.name !== "AbortError") setError("Failed to search members."); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });

    return () => ctrl.abort();
  }, [communityId, debouncedQ]);

  const hasQuery = Boolean(debouncedQ);
  const busy = hasQuery && (loading || debouncedQ !== loadedFor);
  const visibleRows = hasQuery && rows && !busy && loadedFor === debouncedQ ? rows : null;

  async function loadMore() {
    if (!communityId || busy || !hasMore) return;
    setLoading(true);
    const nextPage = page + 1;
    try {
      const res = await fetch(
        `/api/admin/communities/${communityId}/members?page=${nextPage}&search=${encodeURIComponent(debouncedQ)}`
      );
      const data = res.ok ? await res.json() : null;
      if (!data) return;
      setRows((prev) => [...(prev ?? []), ...(data.members ?? [])]);
      setHasMore(data.has_more ?? false);
      setPage(nextPage);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-body text-xs font-semibold text-foreground">
            Members
            <span className="ml-2 font-mono text-[11px] text-foreground-muted font-normal">
              {hasQuery
                ? `${total.toLocaleString()} match${total !== 1 ? "es" : ""}`
                : memberCount > 20
                  ? `Showing 20 of ${memberCount.toLocaleString()}`
                  : memberCount}
            </span>
          </h2>
          <p className="font-body text-[11px] text-foreground-muted mt-0.5">
            {hasQuery
              ? `Results for “${query.trim()}” — click a name for the full member profile.`
              : "Latest joiners — use search to find anyone in this community."}
          </p>
        </div>

        {communityId && (
          <div className="relative w-full sm:w-72">
            <Search
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted pointer-events-none"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search members by name…"
              className="w-full rounded-lg border border-border bg-surface-raised pl-8 pr-8 py-1.5 font-body text-xs text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-foreground-muted hover:text-foreground transition-colors"
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>
        )}
      </div>

      {busy && !visibleRows ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-4 w-4" />
        </div>
      ) : error && hasQuery ? (
        <p className="px-5 py-4 font-body text-xs text-red-400">{error}</p>
      ) : hasQuery && visibleRows && visibleRows.length === 0 ? (
        <p className="px-5 py-8 text-center font-body text-xs text-foreground-muted">
          No members match “{query.trim()}”.
        </p>
      ) : hasQuery && visibleRows ? (
        <div className="divide-y divide-border/70">
          {visibleRows.map((m) => (
            <div
              key={m.user_id}
              className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-surface-raised/60 transition-colors"
            >
              <div className="min-w-0">
                <button
                  onClick={() => router.push(`/admin/users/${m.user_id}`)}
                  className="font-body text-xs font-medium text-foreground hover:text-accent transition-colors flex items-center gap-1"
                >
                  {m.name} <ExternalLink size={10} className="text-foreground-muted" />
                </button>
                <p className="font-body text-[11px] text-foreground-muted truncate">{m.email}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <RoleBadge role={m.role} />
                <span className="font-body text-[11px] text-foreground-muted">
                  Joined {fmtDate(m.joined_at)}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : members.length === 0 ? (
        <p className="px-5 py-6 font-body text-xs text-foreground-muted">No members yet.</p>
      ) : (
        <div className="divide-y divide-border/70">
          {members.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-surface-raised/60 transition-colors"
            >
              <div className="min-w-0">
                <button
                  onClick={() => router.push(`/admin/users/${m.id}`)}
                  className="font-body text-xs font-medium text-foreground hover:text-accent transition-colors flex items-center gap-1"
                >
                  {m.name} <ExternalLink size={10} className="text-foreground-muted" />
                </button>
                <p className="font-body text-[11px] text-foreground-muted truncate">{m.email}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <RoleBadge role={m.role} />
                <span className="font-body text-[11px] text-foreground-muted">
                  Joined {fmtDate(m.joined_at)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {hasQuery && visibleRows && hasMore && (
        <div className="border-t border-border/70 px-5 py-3">
          <button
            onClick={loadMore}
            disabled={busy}
            className="w-full rounded-lg border border-border py-2 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors disabled:opacity-50"
          >
            {busy ? <Spinner className="mx-auto h-3 w-3" /> : `Load more (${visibleRows.length} of ${total})`}
          </button>
        </div>
      )}
    </div>
  );
}
