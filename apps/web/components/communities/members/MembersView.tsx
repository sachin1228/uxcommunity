"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Check, MoreHorizontal, Search, Users, X } from "lucide-react";
import { ChatAvatar } from "@/components/communities/chat/ChatAvatar";

interface CommunityMember {
  user_id:     string;
  name:        string;
  avatar_url:  string | null;
  designation: string | null;
  company:     string | null;
  joined_at:   string;
  role:        string;
}

interface PendingRequest {
  id:           string;
  user_id:      string;
  name:         string;
  avatar_url:   string | null;
  requested_at: string;
}

interface MembersViewProps {
  communityId: string;
  isOwner?:    boolean;
  isPrivate?:  boolean;
}

const PAGE_SIZE = 30;

// ── Module-level cache for page-0, no-search members list ────────────────────
const membersCache = new Map<string, { data: CommunityMember[]; hasMore: boolean; fetchedAt: number }>();
const MEMBERS_STALE_MS = 60_000;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function MembersView({ communityId, isOwner = false, isPrivate = false }: MembersViewProps) {
  const cachedMembers = membersCache.get(communityId);
  const [members,      setMembers]      = useState<CommunityMember[]>(() => cachedMembers?.data ?? []);
  const [page,         setPage]         = useState(0);
  const [hasMore,      setHasMore]      = useState(() => cachedMembers?.hasMore ?? false);
  const [loading,      setLoading]      = useState(() => !cachedMembers);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [query,        setQuery]        = useState("");
  const [debouncedQ,   setDebouncedQ]   = useState("");

  // Pending requests (private + owner only)
  const [requests,         setRequests]         = useState<PendingRequest[]>([]);
  const [requestsLoading,  setRequestsLoading]  = useState(false);
  const [requestsLoaded,   setRequestsLoaded]   = useState(false);

  // Per-member remove dropdown
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const abortRef    = useRef<AbortController | null>(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim().toLowerCase()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Fetch members (page 0)
  useEffect(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Use cache for the no-search initial load
    const hit = !debouncedQ ? membersCache.get(communityId) : undefined;
    const isStale = !hit || Date.now() - hit.fetchedAt > MEMBERS_STALE_MS;

    if (hit && isStale) {
      // Show cached data immediately, fetch fresh in background
      setMembers(hit.data);
      setHasMore(hit.hasMore);
      setPage(0);
      setLoading(false);
    } else if (!hit) {
      setMembers([]);
      setPage(0);
      setHasMore(false);
      setLoading(true);
    }

    const url = `/api/communities/${communityId}/members?page=0${debouncedQ ? `&search=${encodeURIComponent(debouncedQ)}` : ""}`;
    fetch(url, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { members: CommunityMember[]; has_more: boolean } | null) => {
        const freshMembers = data?.members ?? [];
        const freshHasMore = data?.has_more ?? false;
        setMembers(freshMembers);
        setHasMore(freshHasMore);
        setPage(0);
        // Only cache the un-filtered page-0 result
        if (!debouncedQ) {
          membersCache.set(communityId, { data: freshMembers, hasMore: freshHasMore, fetchedAt: Date.now() });
        }
        setLoading(false);
      })
      .catch((err) => { if (err.name !== "AbortError") setLoading(false); });

    return () => ctrl.abort();
  }, [communityId, debouncedQ]);

  // Fetch pending requests (owner + private only)
  useEffect(() => {
    if (!isOwner || !isPrivate) { setRequests([]); setRequestsLoaded(true); return; }
    setRequestsLoading(true);
    fetch(`/api/communities/${communityId}/requests`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { requests: PendingRequest[] } | null) => {
        setRequests(data?.requests ?? []);
        setRequestsLoaded(true);
        setRequestsLoading(false);
      })
      .catch(() => { setRequestsLoaded(true); setRequestsLoading(false); });
  }, [communityId, isOwner, isPrivate]);

  // Close menu on outside click
  useEffect(() => {
    if (!openMenuFor) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpenMenuFor(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [openMenuFor]);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    fetch(`/api/communities/${communityId}/members?page=${nextPage}${debouncedQ ? `&search=${encodeURIComponent(debouncedQ)}` : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { members: CommunityMember[]; has_more: boolean } | null) => {
        setMembers((prev) => [...prev, ...(data?.members ?? [])]);
        setHasMore(data?.has_more ?? false);
        setPage(nextPage);
        setLoadingMore(false);
      })
      .catch(() => setLoadingMore(false));
  }, [communityId, debouncedQ, hasMore, loadingMore, page]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMore(); },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  async function handleAccept(requestId: string) {
    const res = await fetch(`/api/communities/${communityId}/requests/${requestId}/accept`, { method: "POST" });
    if (res.ok) {
      const accepted = requests.find((r) => r.id === requestId);
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
      if (accepted) {
        // Add them to the members list optimistically
        setMembers((prev) => [
          ...prev,
          {
            user_id:     accepted.user_id,
            name:        accepted.name,
            avatar_url:  accepted.avatar_url,
            designation: null,
            company:     null,
            joined_at:   new Date().toISOString(),
            role:        "member",
          },
        ]);
      }
    }
  }

  async function handleDecline(requestId: string) {
    const res = await fetch(`/api/communities/${communityId}/requests/${requestId}/decline`, { method: "POST" });
    if (res.ok) setRequests((prev) => prev.filter((r) => r.id !== requestId));
  }

  async function handleRemoveMember(userId: string) {
    setOpenMenuFor(null);
    const res = await fetch(`/api/communities/${communityId}/members/${userId}`, { method: "DELETE" });
    if (res.ok) setMembers((prev) => prev.filter((m) => m.user_id !== userId));
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Search */}
      <div className="px-5 py-3 shrink-0">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search members…"
            className="w-full bg-surface-raised text-foreground placeholder:text-foreground-muted font-body text-sm rounded-lg pl-8 pr-3 py-2 border border-border focus:outline-none focus:border-accent transition-colors"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Pending Requests section */}
        {isOwner && isPrivate && (requestsLoading || (requestsLoaded && requests.length > 0)) && (
          <div className="px-5 pb-2">
            <p className="font-body text-[10px] font-semibold uppercase tracking-widest text-foreground-muted mb-2">
              Pending Requests
              {requests.length > 0 && (
                <span className="ml-2 inline-flex items-center justify-center h-4 min-w-4 rounded-full bg-accent/15 text-accent text-[10px] font-bold px-1">
                  {requests.length}
                </span>
              )}
            </p>
            {requestsLoading ? (
              <div className="space-y-3 py-1">
                {[1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3 animate-pulse">
                    <div className="h-9 w-9 rounded-full bg-surface-raised shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-28 rounded bg-surface-raised" />
                      <div className="h-2.5 w-20 rounded bg-surface-raised" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <ul className="space-y-1">
                {requests.map((req) => (
                  <li key={req.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5 bg-surface-raised/50">
                    <ChatAvatar name={req.name} url={req.avatar_url} size={9} />
                    <div className="min-w-0 flex-1">
                      <p className="font-body text-sm font-semibold text-foreground truncate leading-none">{req.name}</p>
                      <p className="font-body text-xs text-foreground-muted mt-0.5">
                        Requested to join {timeAgo(req.requested_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleAccept(req.id)}
                        className="inline-flex items-center gap-1 rounded-md bg-green-500/10 border border-green-500/20 px-2.5 py-1.5 font-body text-xs font-medium text-green-400 hover:bg-green-500/20 transition-colors"
                      >
                        <Check size={11} /> Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDecline(req.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors"
                      >
                        <X size={11} /> Decline
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 border-t border-border" />
          </div>
        )}

        {/* Members list */}
        {loading ? (
          <div className="px-5 py-4 space-y-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 animate-pulse">
                <div className="h-9 w-9 rounded-full bg-surface-raised shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-32 rounded bg-surface-raised" />
                  <div className="h-2.5 w-48 rounded bg-surface-raised" />
                </div>
              </div>
            ))}
          </div>
        ) : members.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-foreground-muted py-16">
            <Users size={32} className="opacity-30" />
            <p className="font-body text-sm">
              {debouncedQ ? "No members match your search." : "No members yet."}
            </p>
          </div>
        ) : (
          <>
            {isOwner && !debouncedQ && (
              <p className="px-5 pt-1 pb-0.5 font-body text-[10px] font-semibold uppercase tracking-widest text-foreground-muted">
                Members
              </p>
            )}
            <ul className="px-3 py-2" ref={isOwner ? menuRef : undefined}>
              {members.map((member) => {
                const isOwnerRow = member.role === "owner";
                return (
                  <li
                    key={member.user_id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-raised transition-colors"
                  >
                    <ChatAvatar name={member.name} url={member.avatar_url} size={9} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="font-body text-sm font-semibold text-foreground truncate leading-none">
                          {member.name}
                        </p>
                        {isOwnerRow && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-accent/15 text-accent text-[9px] font-bold uppercase tracking-wider leading-none shrink-0">
                            Owner
                          </span>
                        )}
                      </div>
                      {(member.designation || member.company) && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-medium leading-none">
                          {member.designation && member.company
                            ? `${member.designation} @ ${member.company}`
                            : member.designation ?? `@ ${member.company}`}
                        </span>
                      )}
                    </div>
                    {/* Remove button — owner only, non-owner rows */}
                    {isOwner && !isOwnerRow && (
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() => setOpenMenuFor(openMenuFor === member.user_id ? null : member.user_id)}
                          className="h-7 w-7 flex items-center justify-center rounded-md text-foreground-muted hover:text-foreground hover:bg-surface transition-colors"
                          aria-label="Member options"
                        >
                          <MoreHorizontal size={14} />
                        </button>
                        {openMenuFor === member.user_id && (
                          <div className="absolute right-0 top-[calc(100%+4px)] z-30 min-w-44 rounded-xl border border-white/[0.08] bg-surface-raised p-1 shadow-2xl animate-in fade-in zoom-in-95 duration-100 origin-top-right">
                            <button
                              type="button"
                              onClick={() => handleRemoveMember(member.user_id)}
                              className="flex w-full items-center rounded-lg px-3 py-2 text-left font-body text-xs text-red-400 hover:bg-red-400/10 transition-colors"
                            >
                              Remove from community
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            <div ref={sentinelRef} className="h-4" />

            {loadingMore && (
              <div className="px-5 pb-4 space-y-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 animate-pulse">
                    <div className="h-9 w-9 rounded-full bg-surface-raised shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-32 rounded bg-surface-raised" />
                      <div className="h-2.5 w-48 rounded bg-surface-raised" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!hasMore && members.length > 0 && (
              <p className="text-center font-body text-[11px] text-foreground-muted/50 pb-4 pt-1">
                {members.length} member{members.length !== 1 ? "s" : ""}
                {debouncedQ ? " matched" : " total"}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
