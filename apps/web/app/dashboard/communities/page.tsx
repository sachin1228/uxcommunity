"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Check, Lock } from "lucide-react";
import { CommunityDp } from "@/components/communities/CommunityDp";
import { dedupeFetch } from "@/lib/dedupe-fetch";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { Spinner } from "@/components/ui/Spinner";
import {
  exploreStore,
  EXPLORE_STALE_MS,
  patchExploreCommunity,
  revalidateSidebarCommunities,
  type CachedExploreCommunity,
} from "@/lib/communities/cache";
import { isExploreVisible, type ExploreTab } from "@/lib/communities/explore-list";

type Community = CachedExploreCommunity;

// ── Config ───────────────────────────────────────────────────────────────────

const LOCK_REASON: Record<string, string> = {};

const TABS = [
  { label: "All",        value: "all"              },
  { label: "Interest",   value: "interest"          },
  { label: "Member-led", value: "user"              },
] as const satisfies ReadonlyArray<{ label: string; value: ExploreTab }>;

type TabValue = typeof TABS[number]["value"];

// ── Compact Reddit-style card ─────────────────────────────────────────────────

function CommunityCard({
  c,
  onJoin,
  joining,
}: {
  c: Community;
  onJoin: (id: string) => void;
  joining: boolean;
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
            lottieUrl={c.lottie_url}
            lottieFormat={c.lottie_format}
            lottieData={c.lottie_data}
            name={c.name}
            size={36}
            className="bg-surface"
          />

          {/* Name + member count */}
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm font-semibold text-foreground truncate leading-tight">
              {c.name}
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
            <button
              disabled
              className="flex items-center gap-1 rounded-full border border-white/[0.06] px-3 py-1 font-body text-xs font-medium text-foreground-muted/60"
            >
              Request sent
            </button>
          ) : (
            <button
              onClick={() => onJoin(c.id)}
              disabled={joining}
              className="rounded-full border border-border px-3 py-1 font-body text-xs font-semibold text-foreground hover:bg-surface hover:border-border-strong transition-colors disabled:opacity-60"
            >
              {joining ? "…" : c.is_private ? "Request to join" : "Join"}
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
  const [communities, setCommunities] = useState<Community[]>(
    () => exploreStore.data?.communities ?? [],
  );
  const [loading, setLoading]     = useState(() => exploreStore.data === null);
  const [activeTab, setActiveTab] = useState<TabValue>("all");
  const [search, setSearch]       = useState("");
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg]   = useState<string | null>(null);
  // Communities joined during this visit. Their cards are exempt from the
  // "hide what you have already joined" rule so the click has a visible result;
  // a fresh page load starts from the server's list and hides them again.
  const [justJoinedIds, setJustJoinedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const load = useCallback(() => {
    if (exploreStore.data && Date.now() - exploreStore.data.fetchedAt < EXPLORE_STALE_MS) {
      setLoading(false);
      return;
    }
    if (exploreStore.inflight) {
      exploreStore.inflight.then(() => {
        if (exploreStore.data) setCommunities(exploreStore.data.communities);
        setLoading(false);
      });
      if (exploreStore.data) setLoading(false);
      return;
    }
    const p: Promise<void> = fetch("/api/communities/all")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (!d) return;
        const fresh = d.communities ?? [];
        exploreStore.data = { communities: fresh, fetchedAt: Date.now() };
        setCommunities(fresh);
      })
      .catch(() => {})
      .finally(() => {
        exploreStore.inflight = null;
        setLoading(false);
      });
    exploreStore.inflight = p;
    if (exploreStore.data) setLoading(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function handleJoin(communityId: string) {
    if (joiningId) return;
    setJoiningId(communityId);
    setErrorMsg(null);

    // Optimistic update — the card switches to "Joined" while the write is in
    // flight, and the joined community is mirrored into the Explore cache so a
    // return to this page inside the stale window still shows it as joined.
    setCommunities((prev) =>
      prev.map((c) => c.id === communityId ? { ...c, joined: true } : c),
    );
    patchExploreCommunity(communityId, { joined: true });

    try {
      const res = await dedupeFetch(`/api/communities/${communityId}/join`, { method: "POST" });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        rollbackJoin(communityId, {}, data.error ?? "Failed to join. Please try again.");
      } else if (data.status === "requested") {
        // Private community — request sent, not yet a member, so the sidebar
        // stays untouched: there is no membership row to show yet.
        rollbackJoin(communityId, { has_pending_request: true });
        setErrorMsg("Request sent! Waiting for owner approval.");
        setTimeout(() => setErrorMsg(null), 4000);
      } else {
        // The membership row exists now, so the sidebar may fetch it. Waiting
        // for the write matters: refreshing from the click handler would return
        // the pre-join list and the joined community would never appear.
        setJustJoinedIds((prev) => new Set(prev).add(communityId));
        revalidateSidebarCommunities();
      }
    } catch {
      rollbackJoin(communityId, {}, "Network error. Please try again.");
    } finally {
      setJoiningId(null);
    }
  }

  /**
   * Undoes an optimistic join in both the rendered list and the Explore cache
   * (the request failed, or the community only accepted a request): the card
   * goes back to an actionable state instead of claiming a membership that
   * does not exist.
   */
  function rollbackJoin(
    communityId: string,
    patch: Partial<Community>,
    error?: string,
  ) {
    setCommunities((prev) =>
      prev.map((c) => c.id === communityId ? { ...c, joined: false, ...patch } : c),
    );
    patchExploreCommunity(communityId, { joined: false, ...patch });
    setJustJoinedIds((prev) => {
      if (!prev.has(communityId)) return prev;
      const next = new Set(prev);
      next.delete(communityId);
      return next;
    });
    if (error) {
      setErrorMsg(error);
      setTimeout(() => setErrorMsg(null), 4000);
    }
  }

  // ── Filtering ──────────────────────────────────────────────────────────────

  const filtered = communities.filter((c) =>
    isExploreVisible(c, activeTab, search, justJoinedIds),
  );

  const isAllTab    = activeTab === "all";
  const recommended = isAllTab ? filtered.filter((c) => c.can_join) : [];
  const rest        = isAllTab ? filtered.filter((c) => !c.can_join) : filtered;

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
        <div className="flex items-center gap-2 pb-1">
          {TABS.map((tab) => {
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
          }          )}
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
        ) : filtered.length === 0 ? (
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
                      onJoin={handleJoin}
                      joining={joiningId === c.id}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Joined / locked / all communities */}
            {rest.length > 0 && (
              <section>
                {isAllTab && recommended.length > 0 && (
                  <h2 className="font-display text-sm font-semibold text-foreground mb-3">
                    All communities
                  </h2>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {rest.map((c) => (
                    <CommunityCard
                      key={c.id}
                      c={c}
                      onJoin={handleJoin}
                      joining={joiningId === c.id}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
