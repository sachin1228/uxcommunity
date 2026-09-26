"use client";

import { Fragment, useState, useEffect, useRef, useCallback } from "react";
import { Check, ClipboardList, MoreHorizontal, Search, Users, X } from "lucide-react";
import { EVENT_JOIN_QUESTIONS } from "@/lib/communities/event-join-questions";
import { ChatAvatar } from "@/components/communities/chat/ChatAvatar";
import { Spinner } from "@/components/ui/Spinner";
import { fetchJsonCached, getCachedRequest } from "@/lib/request-cache";
import { dedupeFetch } from "@/lib/dedupe-fetch";

interface CommunityMember {
  user_id:     string;
  name:        string;
  avatar_url:  string | null;
  designation: string | null;
  joined_at:   string;
  role:        string;
}

interface PendingRequest {
  id:              string;
  user_id:         string;
  name:            string;
  avatar_url:      string | null;
  requested_at:    string;
  /** Optional note the requester sent with the ask (homepage preview flow). */
  request_message: string | null;
}

/** One member's answers to the event's compulsory join questions. */
interface EventJoinResponse {
  user_id:         string;
  company_name:    string;
  work_experience: string;
  why_attend:      string;
  expectations:    string;
  created_at:      string;
}

interface MembersViewProps {
  communityId: string;
  currentUserId: string;
  isOwner?:    boolean;
  /** Owner or admin granted "manage members" — may remove members & decide requests. */
  canManageMembers?: boolean;
  isPrivate?:  boolean;
  /** Event group chats record each member's answers to the host's join questions. */
  isEventChat?: boolean;
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

export function MembersView({ communityId, currentUserId, isOwner = false, canManageMembers = false, isPrivate = false, isEventChat = false }: MembersViewProps) {
  // Owners can do everything; admins act within their granted permissions.
  const manager = isOwner || canManageMembers;
  const requestUrl = `/api/communities/${communityId}/members?page=0`;
  const hydrated = getCachedRequest<{ members?: CommunityMember[]; has_more?: boolean }>(requestUrl, currentUserId);
  const cachedMembers = membersCache.get(communityId);
  const [members,      setMembers]      = useState<CommunityMember[]>(() => cachedMembers?.data ?? hydrated?.members ?? []);
  const [page,         setPage]         = useState(0);
  const [hasMore,      setHasMore]      = useState(() => cachedMembers?.hasMore ?? hydrated?.has_more ?? false);
  const [loading,      setLoading]      = useState(() => !cachedMembers && !hydrated);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [query,        setQuery]        = useState("");
  const [debouncedQ,   setDebouncedQ]   = useState("");

  // Pending requests (private + owner only)
  const [requests,         setRequests]         = useState<PendingRequest[]>([]);
  const [requestsLoading,  setRequestsLoading]  = useState(false);
  const [requestsLoaded,   setRequestsLoaded]   = useState(false);

  // Join-question answers (event chats + managers only): what each member
  // answered before the host's questions let them in.
  const [joinResponses,    setJoinResponses]    = useState<Map<string, EventJoinResponse>>(new Map());

  // Per-member remove dropdown
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  // The one member whose join answers are expanded (event chats).
  const [expandedAnswersFor, setExpandedAnswersFor] = useState<string | null>(null);
  // Locks a specific pending request (accept/decline) so double-clicks cannot
  // fire the same mutation twice. Cleared on success and on failure.
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
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

    // Bootstrap has already populated the first unfiltered page.
    const hydratedPage = !debouncedQ
      ? getCachedRequest<{ members?: CommunityMember[]; has_more?: boolean }>(requestUrl, currentUserId)
      : undefined;
    if (hydratedPage && !membersCache.has(communityId)) return () => ctrl.abort();

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
    } else if (!isStale && !debouncedQ) {
      setMembers(hit.data);
      setHasMore(hit.hasMore);
      setPage(0);
      setLoading(false);
      return () => ctrl.abort();
    }

    const url = `/api/communities/${communityId}/members?page=0${debouncedQ ? `&search=${encodeURIComponent(debouncedQ)}` : ""}`;
    const request = debouncedQ
      ? fetch(url, { signal: ctrl.signal }).then((response) => response.ok ? response.json() : null)
      : fetchJsonCached<{ members: CommunityMember[]; has_more: boolean }>(
          url,
          { staleMs: MEMBERS_STALE_MS },
          currentUserId,
        );
    void request.then((data: { members: CommunityMember[]; has_more: boolean } | null) => {
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
  }, [communityId, currentUserId, debouncedQ, requestUrl]);

  // Fetch pending requests (managers + private only)
  useEffect(() => {
    if (!manager || !isPrivate) { setRequests([]); setRequestsLoaded(true); return; }
    setRequestsLoading(true);
    fetch(`/api/communities/${communityId}/requests`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { requests: PendingRequest[] } | null) => {
        setRequests(data?.requests ?? []);
        setRequestsLoaded(true);
        setRequestsLoading(false);
      })
      .catch(() => { setRequestsLoaded(true); setRequestsLoading(false); });
  }, [communityId, manager, isPrivate]);

  // Fetch the recorded join answers (managers + event chats only). A member
  // who joined before the questions existed simply has no row, and their row
  // in the list renders without the section. Nothing is cleared when the
  // section hides — the answers are only ever read behind the same gate, so
  // stale rows never reach the screen.
  useEffect(() => {
    if (!manager || !isEventChat) return;
    let cancelled = false;
    fetch(`/api/communities/${communityId}/event-join-responses`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { responses?: EventJoinResponse[] } | null) => {
        if (cancelled) return;
        setJoinResponses(new Map((data?.responses ?? []).map((row) => [row.user_id, row])));
      })
      .catch(() => { if (!cancelled) setJoinResponses(new Map()); });
    return () => { cancelled = true; };
  }, [communityId, manager, isEventChat]);

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
    if (busyRequestId) return;
    setBusyRequestId(requestId);
    try {
      const res = await dedupeFetch(`/api/communities/${communityId}/requests/${requestId}/accept`, { method: "POST" });
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
              joined_at:   new Date().toISOString(),
              role:        "member",
            },
          ]);
        }
      }
    } finally {
      setBusyRequestId(null);
    }
  }

  async function handleDecline(requestId: string) {
    if (busyRequestId) return;
    setBusyRequestId(requestId);
    try {
      const res = await dedupeFetch(`/api/communities/${communityId}/requests/${requestId}/decline`, { method: "POST" });
      if (res.ok) setRequests((prev) => prev.filter((r) => r.id !== requestId));
    } finally {
      setBusyRequestId(null);
    }
  }

  async function handleRemoveMember(userId: string) {
    setOpenMenuFor(null);
    const res = await dedupeFetch(`/api/communities/${communityId}/members/${userId}`, { method: "DELETE" });
    if (res.ok) setMembers((prev) => prev.filter((m) => m.user_id !== userId));
  }

  const orderedMembers = [...members].sort((a, b) => {
    const roleRank = (role: string) => role === "owner" ? 0 : role === "admin" ? 1 : 2;
    return roleRank(a.role) - roleRank(b.role);
  });

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* Search */}
      <div className="px-5 py-3 shrink-0">
        <div className="relative">
          <Search strokeWidth={2.5} size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search members…"
            className="field w-full pl-8 pr-3"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Pending Requests section */}
        {manager && isPrivate && (requestsLoading || (requestsLoaded && requests.length > 0)) && (
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
              <div className="flex items-center justify-center py-6">
                <Spinner size={20} />
              </div>
            ) : (
              <ul className="space-y-1">
                {requests.map((req) => (
                  <li key={req.id} className="flex items-start gap-3 rounded-lg px-3 py-2.5 bg-surface-raised/50">
                    <ChatAvatar name={req.name} url={req.avatar_url} size={9} />
                    <div className="min-w-0 flex-1">
                      <p className="font-body text-sm font-semibold text-foreground truncate leading-none">{req.name}</p>
                      <p className="font-body text-xs text-foreground-muted mt-0.5">
                        Requested to join {timeAgo(req.requested_at)}
                      </p>
                      {req.request_message && (
                        <blockquote className="mt-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 font-body text-xs leading-relaxed text-foreground-muted">
                          “{req.request_message}”
                        </blockquote>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleAccept(req.id)}
                        disabled={busyRequestId === req.id}
                        className="inline-flex items-center gap-1 rounded-md bg-green-500/10 border border-green-500/20 px-2.5 py-1.5 font-body text-xs font-medium text-green-400 hover:bg-green-500/20 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Check strokeWidth={2.5} size={11} /> {busyRequestId === req.id ? "Accepting…" : "Accept"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDecline(req.id)}
                        disabled={busyRequestId === req.id}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <X strokeWidth={2.5} size={11} /> {busyRequestId === req.id ? "Declining…" : "Decline"}
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
          <div className="flex items-center justify-center px-5 py-10">
            <Spinner size={24} />
          </div>
        ) : members.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-foreground-muted py-16">
            <Users strokeWidth={2.5} size={32} className="opacity-30" />
            <p className="font-body text-sm">
              {debouncedQ ? "No members match your search." : "No members yet."}
            </p>
          </div>
        ) : (
          <>
            {manager && !debouncedQ && (
              <p className="px-5 pt-1 pb-0.5 font-body text-[10px] font-semibold uppercase tracking-widest text-foreground-muted">
                Members
              </p>
            )}
            <ul className="px-3 py-2" ref={manager ? menuRef : undefined}>
              {orderedMembers.map((member) => {
                const isOwnerRow  = member.role === "owner";
                const isAdminRow  = member.role === "admin";
                // Owners may remove anyone except other owners / themselves.
                // Admins may remove regular members only (never other admins).
                const canRemoveRow =
                  member.user_id !== currentUserId &&
                  !isOwnerRow &&
                  !(isAdminRow && !isOwner);
                return (
                  <Fragment key={member.user_id}>
                  <li
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-raised transition-colors"
                  >
                    <ChatAvatar name={member.name} url={member.avatar_url} size={9} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="font-body text-sm font-semibold text-foreground truncate leading-none">
                          {member.name}
                        </p>
                        {isOwnerRow ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-accent/15 text-accent text-[9px] font-bold uppercase tracking-wider leading-none shrink-0">
                            Owner
                          </span>
                        ) : isAdminRow ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-500 text-[9px] font-bold uppercase tracking-wider leading-none shrink-0">
                            Admin
                          </span>
                        ) : null}
                      </div>
                      {member.designation && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-medium leading-none">
                          {member.designation}
                        </span>
                      )}
                    </div>
                    {/* Remove button — managers only, protected rows excluded */}
                    {manager && canRemoveRow && (
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() => setOpenMenuFor(openMenuFor === member.user_id ? null : member.user_id)}
                          className="h-7 w-7 flex items-center justify-center rounded-md text-foreground-muted hover:text-foreground hover:bg-surface transition-colors"
                          aria-label="Member options"
                        >
                          <MoreHorizontal strokeWidth={2.5} size={14} />
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
                  {/* This member's answers to the host's compulsory join
                      questions — event chats only, collapsed to one line until
                      the manager opens them. Rendered as a sibling row so the
                      member row itself never reflows when it opens. */}
                  {isEventChat && manager && (
                    <li
                      className="-mt-1 px-3 pb-2"
                    >
                      {joinResponses.get(member.user_id) ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setExpandedAnswersFor(expandedAnswersFor === member.user_id ? null : member.user_id)}
                            aria-expanded={expandedAnswersFor === member.user_id}
                            className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 font-body text-[11px] font-medium text-accent transition-colors hover:bg-accent/10"
                          >
                            <ClipboardList strokeWidth={2.5} size={12} />
                            {expandedAnswersFor === member.user_id ? "Hide join answers" : "View join answers"}
                          </button>
                          {expandedAnswersFor === member.user_id && (() => {
                            const answers = joinResponses.get(member.user_id)!;
                            return (
                              <dl className="mt-1.5 flex flex-col gap-2 rounded-lg border border-border bg-surface-raised/50 px-3 py-2.5">
                                {EVENT_JOIN_QUESTIONS.map(({ key, label }) => (
                                  <div key={key}>
                                    <dt className="font-body text-[10px] font-semibold uppercase tracking-widest text-foreground-muted">
                                      {label}
                                    </dt>
                                    <dd className="whitespace-pre-wrap break-words font-body text-xs leading-relaxed text-foreground">
                                      {answers[key]}
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                            );
                          })()}
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-1.5 py-1 font-body text-[11px] text-foreground-subtle">
                          <ClipboardList strokeWidth={2.5} size={12} />
                          No join answers recorded
                        </span>
                      )}
                    </li>
                  )}
                  </Fragment>
                );
              })}
            </ul>

            <div ref={sentinelRef} className="h-4" />

            {loadingMore && (
              <div className="flex items-center justify-center px-5 py-6">
                <Spinner size={18} />
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
