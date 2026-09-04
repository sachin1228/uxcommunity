"use client";

import { useEffect, useRef, useState } from "react";
import { Search, ShieldCheck, X } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import {
  CommunityAdmin,
  ALL_PERMISSIONS,
  type CommunityMemberSearchResult as MemberRow,
} from "./communityTypes";

interface Props {
  communityId: string;
  communityName: string;
  onClose: () => void;
  onPromoted: (admin: CommunityAdmin) => void;
}

const PAGE_SIZE = 30;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "")).toUpperCase();
}

export function CommunityAdminSearchModal({ communityId, communityName, onClose, onPromoted }: Props) {
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [latestQuery, setLatestQuery] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [promoteError, setPromoteError] = useState<string | null>(null);
  const [promotedIds, setPromotedIds] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Fetch members whenever the query settles. Loading state is derived from
  // which query the current list was last loaded for, so switching searches
  // immediately shows a spinner without syncing state inside the effect.
  useEffect(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const qs = debouncedQ ? `&search=${encodeURIComponent(debouncedQ)}` : "";
    fetch(`/api/admin/communities/${communityId}/members?page=0${qs}`, { signal: ctrl.signal })
      .then(async (r) => {
        const data = r.ok ? await r.json() : null;
        if (!data) { setError("Failed to load members."); return; }
        setMembers(data.members ?? []);
        setTotal(data.total ?? 0);
        setHasMore(data.has_more ?? false);
        setPage(0);
        setLatestQuery(debouncedQ);
      })
      .catch((err) => { if (err.name !== "AbortError") setError("Failed to load members."); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });

    return () => ctrl.abort();
  }, [communityId, debouncedQ]);

  const busy = loading || debouncedQ !== latestQuery;

  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    const qs = debouncedQ ? `&search=${encodeURIComponent(debouncedQ)}` : "";
    try {
      const res = await fetch(`/api/admin/communities/${communityId}/members?page=${nextPage}${qs}`);
      const data = res.ok ? await res.json() : null;
      if (!data) return;
      setMembers((prev) => [...prev, ...(data.members ?? [])]);
      setHasMore(data.has_more ?? false);
      setPage(nextPage);
    } finally {
      setLoadingMore(false);
    }
  }

  async function handlePromote(member: MemberRow) {
    if (busyUserId) return;
    setBusyUserId(member.user_id);
    setPromoteError(null);
    try {
      const res = await fetch(`/api/admin/communities/${communityId}/admins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: member.user_id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPromoteError(data.error ?? "Failed to make admin.");
        return;
      }
      onPromoted({
        user_id: member.user_id,
        name: member.name,
        email: member.email,
        joined_at: member.joined_at,
        permissions: data.admin?.permissions ?? { ...ALL_PERMISSIONS },
        granted_at: new Date().toISOString(),
        updated_at: null,
      });
      setPromotedIds((prev) => new Set(prev).add(member.user_id));
    } catch {
      setPromoteError("Network error — try again.");
    } finally {
      setBusyUserId(null);
    }
  }

  // Close on Escape + focus search on open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    setTimeout(() => inputRef.current?.focus(), 50);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 fade-in duration-150"
        style={{ maxHeight: "min(80vh, 640px)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border shrink-0">
          <div>
            <h2 className="font-display text-base font-semibold text-foreground leading-none flex items-center gap-2">
              <ShieldCheck strokeWidth={2.5} size={16} className="text-accent" /> Add community admin
            </h2>
            <p className="font-body text-[11px] text-foreground-muted mt-1">
              Pick a member of <span className="font-medium text-foreground">{communityName}</span> to promote.
              They get owner-style controls in the app — you can trim permissions afterwards.
            </p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border border-border text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors"
            aria-label="Close"
          >
            <X strokeWidth={2.5} size={15} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 shrink-0">
          <div className="relative">
            <Search strokeWidth={2.5} size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search members by name…"
              className="w-full rounded-lg border border-border bg-surface-raised pl-9 pr-3 py-2 font-body text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:border-accent transition-colors"
            />
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          {error && (
            <p className="px-2 py-3 font-body text-xs text-red-400">{error}</p>
          )}
          {promoteError && (
            <p className="mx-2 mb-2 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 font-body text-xs text-red-400">
              {promoteError}
            </p>
          )}
          {busy ? (
            <div className="flex items-center justify-center py-10">
              <Spinner className="h-4 w-4" />
            </div>
          ) : members.length === 0 ? (
            <p className="px-2 py-6 text-center font-body text-xs text-foreground-muted">
              {debouncedQ ? "No members match your search." : "This community has no members yet."}
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {members.map((member) => {
                const isOwner = member.role === "owner";
                const isAdmin = member.role === "admin";
                const isPromoted = promotedIds.has(member.user_id);
                return (
                  <li key={member.user_id} className="flex items-center gap-3 px-2 py-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-raised border border-border font-body text-[11px] font-semibold text-foreground">
                      {initials(member.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-body text-sm font-medium text-foreground truncate leading-tight">{member.name}</p>
                      <p className="font-body text-[11px] text-foreground-muted truncate">{member.email}</p>
                    </div>
                    {isOwner ? (
                      <span className="shrink-0 rounded-full bg-accent/10 border border-accent/20 px-2.5 py-1 font-body text-[10px] font-semibold text-accent">
                        Owner
                      </span>
                    ) : isAdmin ? (
                      <span className="shrink-0 rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 font-body text-[10px] font-semibold text-amber-500">
                        Admin
                      </span>
                    ) : (
                      <button
                        onClick={() => handlePromote(member)}
                        disabled={busyUserId === member.user_id}
                        className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 font-body text-xs font-medium text-accent hover:bg-accent/20 transition-colors disabled:opacity-60"
                      >
                        {busyUserId === member.user_id ? (
                          <Spinner className="h-3 w-3" />
                        ) : isPromoted ? (
                          "✓ Promoted"
                        ) : (
                          "Add as admin"
                        )}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {!busy && hasMore && (
            <div className="px-2 pt-2">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full rounded-lg border border-border py-2 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors disabled:opacity-50"
              >
                {loadingMore ? <Spinner className="mx-auto h-3 w-3" /> : `Load more (${members.length} of ${total})`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
