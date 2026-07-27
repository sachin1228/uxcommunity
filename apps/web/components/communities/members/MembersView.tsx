"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, Users } from "lucide-react";
import { ChatAvatar } from "@/components/communities/chat/ChatAvatar";

interface CommunityMember {
  user_id:     string;
  name:        string;
  avatar_url:  string | null;
  designation: string | null;
  company:     string | null;
  joined_at:   string;
}

interface MembersViewProps {
  communityId: string;
}

const PAGE_SIZE = 30;

export function MembersView({ communityId }: MembersViewProps) {
  const [members,    setMembers]    = useState<CommunityMember[]>([]);
  const [page,       setPage]       = useState(0);
  const [hasMore,    setHasMore]    = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [loadingMore,setLoadingMore] = useState(false);
  const [query,      setQuery]      = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  const sentinelRef = useRef<HTMLDivElement>(null);
  const abortRef    = useRef<AbortController | null>(null);

  // Debounce search input 300ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim().toLowerCase()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Reset + fetch page 0 whenever communityId or search changes
  useEffect(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setMembers([]);
    setPage(0);
    setHasMore(false);
    setLoading(true);

    const url = `/api/communities/${communityId}/members?page=0${debouncedQ ? `&search=${encodeURIComponent(debouncedQ)}` : ""}`;

    fetch(url, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { members: CommunityMember[]; has_more: boolean } | null) => {
        setMembers(data?.members ?? []);
        setHasMore(data?.has_more ?? false);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name !== "AbortError") setLoading(false);
      });

    return () => ctrl.abort();
  }, [communityId, debouncedQ]);

  // Load next page
  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextPage = page + 1;

    const url = `/api/communities/${communityId}/members?page=${nextPage}${debouncedQ ? `&search=${encodeURIComponent(debouncedQ)}` : ""}`;

    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { members: CommunityMember[]; has_more: boolean } | null) => {
        setMembers((prev) => [...prev, ...(data?.members ?? [])]);
        setHasMore(data?.has_more ?? false);
        setPage(nextPage);
        setLoadingMore(false);
      })
      .catch(() => setLoadingMore(false));
  }, [communityId, debouncedQ, hasMore, loadingMore, page]);

  // Intersection observer triggers loadMore when sentinel is visible
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

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Search bar */}
      <div className="px-5 py-3 shrink-0">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted pointer-events-none"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search members…"
            className="w-full bg-surface-raised text-foreground placeholder:text-foreground-muted font-body text-sm rounded-lg pl-8 pr-3 py-2 border border-border focus:outline-none focus:border-accent transition-colors"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
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
            <ul className="px-3 py-2">
              {members.map((member) => (
                <li
                  key={member.user_id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-raised transition-colors"
                >
                  <ChatAvatar
                    name={member.name}
                    url={member.avatar_url}
                    size={9}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-body text-sm font-semibold text-foreground truncate leading-none mb-1">
                      {member.name}
                    </p>
                    {(member.designation || member.company) && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-medium leading-none">
                        {member.designation && member.company
                          ? `${member.designation} @ ${member.company}`
                          : member.designation ?? `@ ${member.company}`}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {/* Sentinel — triggers next page load */}
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
