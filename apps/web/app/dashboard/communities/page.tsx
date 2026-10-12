"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Check, Lock } from "lucide-react";
import { CommunityDp } from "@/components/communities/CommunityDp";
import { CommunityNameBadges } from "@/components/communities/CommunityBadges";
import { JoinCommunityModal } from "@/components/communities/JoinCommunityModal";
import { dedupeFetch } from "@/lib/dedupe-fetch";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { Spinner } from "@/components/ui/Spinner";
import {
  exploreStore,
  EXPLORE_STALE_MS,
  setCommunityViewerState,
  setExploreCommunities,
  type CachedExploreCommunity,
} from "@/lib/communities/cache";
import { useExploreCommunities } from "@/lib/communities/cache/use-community-stores";
import {
  EXPLORE_TABS,
  visibleExploreRows,
  type ExploreTabValue,
} from "@/lib/communities/explore-filter";

type Community = CachedExploreCommunity;

// ── Config ───────────────────────────────────────────────────────────────────

const LOCK_REASON: Record<string, string> = {};

// ── Compact Reddit-style card ─────────────────────────────────────────────────

function CommunityCard({
  c,
  onJoin,
  onWithdraw,
  withdrawing = false,
}: {
  c: Community;
  onJoin: (community: Community) => void;
  /** Present on the Requests tab; turns the pending row into a withdraw action. */
  onWithdraw?: (community: Community) => void;
  withdrawing?: boolean;
}) {
  const router              = useGuardedRouter();
  const locked              = !c.can_join && !c.joined;
  const lockBtnRef          = useRef<HTMLButtonElement>(null);
  const [tipPos, setTipPos] = useState<{ top: number; right: number } | null>(null);

  function showTip() {
    if (!lockBtnRef.current) return;
    const r = lockBtnRef.current.getBoundingClientRect();
    setTipPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
  }
  function hideTip() { setTipPos(null); }

  function handleCardClick() {
    if (c.joined) router.push(`/dashboard/communities/${c.id}`);
  }

  return (
    <div
      onClick={handleCardClick}
      className={`group flex flex-col gap-2 rounded-xl border bg-surface-raised p-3 transition-colors ${
        c.joined
          ? "border-white/[0.1] hover:border-white/[0.18] cursor-pointer"
          : locked
          ? "border-white/[0.06]"
          : "border-white/[0.08] hover:border-white/[0.15] cursor-default"
      }`}
    >
      {/* ── Header row: avatar · name/count · action ── */}
      <div className="flex items-center gap-2.5">
        {/* Avatar + name/count — faded when locked, but keeps action at full opacity */}
        <div className={`flex items-center gap-2.5 flex-1 min-w-0 ${locked ? "opacity-50" : ""}`}>
          {/* Avatar */}
          <CommunityDp
            imageUrl={c.image_url}
            name={c.name}
            size={36}
            className="bg-surface"
          />

          {/* Name + member count */}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 font-display text-sm font-semibold text-foreground leading-tight">
              <span className="min-w-0 truncate">{c.name}</span>
              <CommunityNameBadges type={c.type} isPrivate={c.is_private} />
            </p>
            <p className="font-body text-[11px] text-foreground-muted leading-tight mt-0.5">
              {c.member_count.toLocaleString()} member{c.member_count !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {/* Action — never faded so tooltip stays fully visible */}
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          {c.joined ? (
            <button
              onClick={() => router.push(`/dashboard/communities/${c.id}`)}
              className="flex items-center gap-1 rounded-full border border-accent/40 px-3 py-1 font-body text-xs font-medium text-accent hover:bg-accent/10 transition-colors"
            >
              <Check size={10} strokeWidth={2.5} />
              Joined
            </button>
          ) : locked ? (
            <>
              <button
                ref={lockBtnRef}
                disabled
                onMouseEnter={showTip}
                onMouseLeave={hideTip}
                className="flex items-center cursor-pointer gap-1 rounded-full border border-white/[0.06] px-3 py-1 font-body text-xs font-medium text-foreground-muted/60"
              >
                <Lock strokeWidth={2.5} size={10} />
                Join
              </button>
              {tipPos && typeof document !== "undefined" && createPortal(
                <div
                  className="pointer-events-none w-56 rounded-xl border border-white/10 bg-[#1c1c1e] px-3 py-2.5 shadow-2xl"
                  style={{ position: "fixed", top: tipPos.top, right: tipPos.right, zIndex: 9999 }}
                >
                  <p className="font-body text-[11px] text-foreground-muted/90 text-center leading-relaxed">
                    {LOCK_REASON[c.type] ?? "Update your profile to join"}
                  </p>
                </div>,
                document.body
              )}
            </>
          ) : c.has_pending_request ? (
            onWithdraw ? (
              <button
                onClick={() => onWithdraw(c)}
                disabled={withdrawing}
                className="rounded-full border border-border px-3 py-1 font-body text-xs font-semibold text-foreground hover:bg-surface hover:border-border-strong transition-colors disabled:opacity-60"
              >
                {withdrawing ? "…" : "Withdraw"}
              </button>
            ) : (
              <button
                disabled
                className="flex items-center gap-1 rounded-full border border-white/[0.06] px-3 py-1 font-body text-xs font-medium text-foreground-muted/60"
              >
                Request sent
              </button>
            )
          ) : (
            <button
              onClick={() => onJoin(c)}
              className="rounded-full border border-border px-3 py-1 font-body text-xs font-semibold text-foreground hover:bg-surface hover:border-border-strong transition-colors"
            >
              {c.is_private ? "Request to join" : "Join"}
            </button>
          )}
        </div>
      </div>

      {/* ── Description — faded when locked ── */}
      {c.description && (
        <p className={`font-body text-[11px] leading-relaxed text-foreground-muted line-clamp-2 pl-[46px] ${locked ? "opacity-50" : ""}`}>
          {c.description}
        </p>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CommunitiesIndexPage() {
  const router = useGuardedRouter();
  // The rows come straight from the shared store: a request filed from the home
  // feed, an acceptance, a withdraw and a fresh fetch all land there, and every
  // one of them re-renders this list. The page keeps no copy of its own — that
  // copy is what let Explore offer "Request to join" for a community the member
  // had already asked to join from the feed.
  const communities = useExploreCommunities();
  // "nothing to show yet", i.e. no fetch has settled for an empty store. Rows in
  // the store (cached or fresh) end the spinner even while a refetch runs.
  const [settled, setSettled]         = useState(() => exploreStore.data !== null);
  const loading                       = !settled && communities.length === 0;
  const [activeTab, setActiveTab]     = useState<ExploreTabValue>("all");
  const [search, setSearch]           = useState("");
  const [joinTarget, setJoinTarget]   = useState<Community | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg]       = useState<string | null>(null);

  const load = useCallback(() => {
    if (exploreStore.data && Date.now() - exploreStore.data.fetchedAt < EXPLORE_STALE_MS) {
      setSettled(true);
      return;
    }
    if (exploreStore.inflight) {
      // Another mount is already fetching; this one just waits for it and
      // stops its own spinner when the answer lands (in the store).
      void exploreStore.inflight.finally(() => setSettled(true));
      return;
    }
    const p: Promise<void> = fetch("/api/communities/all")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (!d) return;
        setExploreCommunities(d.communities ?? []);
      })
      .catch(() => {})
      .finally(() => {
        exploreStore.inflight = null;
        setSettled(true);
      });
    exploreStore.inflight = p;
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  /**
   * Public join (or an auto-accepted request): the member is in — open the chat.
   * The dialog has already recorded the membership in the shared cache.
   */
  function handleJoined(communityId: string) {
    setJoinTarget(null);
    router.push(`/dashboard/communities/${communityId}`);
  }

  /** Take back a pending request — the row leaves the Requests tab on success. */
  async function handleWithdraw(community: Community) {
    if (withdrawingId) return;
    setWithdrawingId(community.id);
    setErrorMsg(null);
    try {
      const res = await dedupeFetch(`/api/communities/${community.id}/join`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setErrorMsg("Couldn't withdraw the request. Please try again.");
        return;
      }
      setCommunityViewerState(community.id, { joined: false });
    } catch {
      setErrorMsg("Network error. Please try again.");
    } finally {
      setWithdrawingId(null);
    }
  }

  // ── Filtering ──────────────────────────────────────────────────────────────

  // Which tab hides what lives in lib/communities/explore-filter.ts, so the rule
  // is pinned by tests rather than by reading this JSX.
  const visible = visibleExploreRows(communities, activeTab, search);

  const isAllTab      = activeTab === "all";
  const isRequestsTab = activeTab === "requests";
  // Recommended = the member can join outright; the rest need a request, an
  // invite or a profile change. The split reads the same on every browse tab.
  const recommended   = visible.filter((c) => c.can_join);
  const rest          = visible.filter((c) => !c.can_join);

  return (
    <div className="flex flex-col h-full">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="px-6 pt-6 pb-4 shrink-0">
        <h1 className="font-display text-xl font-semibold text-foreground mb-4">
          Explore Communities
        </h1>

        {/* Search */}
        <div className="relative mb-4">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted pointer-events-none"
            width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search communities…"
            className="field w-full pl-8 pr-4"
          />
        </div>

        {/* Pill filters */}
        <div className="flex flex-wrap items-center gap-2 pb-1">
          {EXPLORE_TABS.map((tab) => {
            const isActive = activeTab === tab.value;
            return (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                className={`shrink-0 rounded-full border px-4 py-1.5 font-body text-sm font-medium transition-colors ${
                  isActive
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-transparent text-foreground-muted hover:border-border-strong hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Error banner ─────────────────────────────────────────────────── */}
      {errorMsg && (
        <div className="mx-6 mb-3 shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 font-body text-xs text-red-400">
          {errorMsg}
        </div>
      )}

      {/* ── Community lists ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-6">
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner className="h-5 w-5" />
          </div>
        ) : isRequestsTab ? (
          visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="font-body text-sm text-foreground-muted">No pending requests</p>
              <p className="mt-1 max-w-xs font-body text-xs text-foreground-subtle">
                Requests you send to private communities will wait here until an owner accepts them.
              </p>
            </div>
          ) : (
            <section>
              <h2 className="font-display text-sm font-semibold text-foreground mb-3">
                Pending requests
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {visible.map((c) => (
                  <CommunityCard
                    key={c.id}
                    c={c}
                    onJoin={setJoinTarget}
                    onWithdraw={handleWithdraw}
                    withdrawing={withdrawingId === c.id}
                  />
                ))}
              </div>
            </section>
          )
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="font-body text-sm text-foreground-muted">No communities found</p>
          </div>
        ) : (
          <>
            {/* Recommended for you */}
            {recommended.length > 0 && (
              <section>
                <h2 className="font-display text-sm font-semibold text-foreground mb-3">
                  Recommended for you
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {recommended.map((c) => (
                    <CommunityCard
                      key={c.id}
                      c={c}
                      onJoin={setJoinTarget}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Joined / locked / all communities */}
            {rest.length > 0 && (
              <section>
                {recommended.length > 0 && (
                  <h2 className="font-display text-sm font-semibold text-foreground mb-3">
                    {isAllTab ? "All communities" : "More communities"}
                  </h2>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {rest.map((c) => (
                    <CommunityCard
                      key={c.id}
                      c={c}
                      onJoin={setJoinTarget}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* ── Join / request modal ─────────────────────────────────────────── */}
      {joinTarget && (
        <JoinCommunityModal
          community={joinTarget}
          joined={joinTarget.joined}
          canJoin={joinTarget.can_join}
          hasPendingRequest={joinTarget.has_pending_request}
          onClose={() => setJoinTarget(null)}
          onJoined={handleJoined}
        />
      )}
    </div>
  );
}
