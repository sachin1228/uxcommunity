"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Users, Search } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import {
  exploreStore,
  EXPLORE_STALE_MS,
  type CachedExploreCommunity,
} from "@/lib/communities/cache";

type Community = CachedExploreCommunity;

const TYPE_EMOJI: Record<string, string> = {
  city:             "📍",
  sector:           "🏢",
  interest:         "✦",
  company:          "🏬",
  experience_level: "🎯",
};

const TABS = [
  { label: "All",        value: "all"              },
  { label: "Company",    value: "company"          },
  { label: "Industry",   value: "sector"            },
  { label: "Interest",   value: "interest"          },
  { label: "Experience", value: "experience_level"  },
  { label: "City",       value: "city"              },
] as const;

type TabValue = typeof TABS[number]["value"];

function CommunityCard({
  c,
  onClick,
}: {
  c: Community;
  onClick: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const fallback = TYPE_EMOJI[c.type] ?? "💬";

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 w-full px-6 py-3 text-left hover:bg-surface-raised transition-colors group"
    >
      {/* Avatar */}
      {c.image_url && !imgFailed ? (
        <img
          src={c.image_url}
          alt={c.name}
          className="h-10 w-10 rounded-full object-cover shrink-0"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div className="h-10 w-10 rounded-full bg-surface-raised flex items-center justify-center shrink-0 text-base select-none">
          {fallback}
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-body text-sm font-normal text-foreground truncate group-hover:text-accent transition-colors">
          {c.name}
        </p>
        <div className="flex items-center gap-1 mt-0.5">
          <Users size={10} className="text-foreground-muted" />
          <span className="font-mono text-[11px] text-foreground-muted">{c.member_count} member{c.member_count !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* Joined badge */}
      {c.joined && (
        <span className="shrink-0 font-body text-[10px] font-normal text-accent bg-accent/10 px-2 py-0.5 rounded-full">
          Joined
        </span>
      )}
    </button>
  );
}

export default function CommunitiesIndexPage() {
  const router = useRouter();

  /**
   * Seed state from the module-level cache on first render (synchronous).
   * If cache exists the spinner is skipped entirely — render is instant.
   * If cache is absent, loading=true shows the spinner until the fetch resolves.
   *
   * To add join/leave invalidation later, call invalidateOnJoin(id) /
   * invalidateOnLeave(id) from cache.ts after the API call succeeds — the
   * exploreStore will be updated in place and the next mount reflects it.
   */
  const [communities, setCommunities] = useState<Community[]>(
    () => exploreStore.data?.communities ?? []
  );
  const [loading, setLoading] = useState(() => exploreStore.data === null);
  const [activeTab, setActiveTab] = useState<TabValue>("all");
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    // Already fresh — render the cached result, do nothing else.
    if (
      exploreStore.data &&
      Date.now() - exploreStore.data.fetchedAt < EXPLORE_STALE_MS
    ) {
      setLoading(false);
      return;
    }

    // A fetch is already running (e.g. triggered by another tab/component).
    // Attach to it instead of firing a duplicate request.
    if (exploreStore.inflight) {
      exploreStore.inflight.then(() => {
        if (exploreStore.data) setCommunities(exploreStore.data.communities);
        setLoading(false);
      });
      // Stale data is still usable — hide the spinner while we wait.
      if (exploreStore.data) setLoading(false);
      return;
    }

    // Kick off the fetch and register the promise so any concurrent consumer
    // can join it rather than issuing a second identical request.
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

    // Stale data is already showing — keep it visible, no spinner.
    if (exploreStore.data) setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = communities.filter((c) => {
    const matchesTab = activeTab === "all" || c.type === activeTab;
    const matchesSearch = c.name.toLowerCase().includes(search.trim().toLowerCase());
    return matchesTab && matchesSearch;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-6 pb-0 shrink-0">
        <h1 className="font-display text-xl font-semibold text-foreground mb-4">
          Explore Communities
        </h1>

        {/* Search */}
        <div className="relative mb-4">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search communities…"
            className="w-full rounded-lg border border-border bg-surface pl-8 pr-4 py-2 font-body text-sm text-foreground placeholder:text-foreground-muted outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors"
          />
        </div>

        {/* Tab filters */}
        <div className="flex items-center gap-0 overflow-x-auto border-b border-border">
          {TABS.map((tab) => {
            const count = tab.value === "all"
              ? communities.length
              : communities.filter((c) => c.type === tab.value).length;
            const isActive = activeTab === tab.value;
            return (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                className={`relative shrink-0 flex items-center gap-2 px-4 py-2.5 font-body text-xs font-normal transition-colors ${
                  isActive
                    ? "text-accent"
                    : "text-foreground-muted hover:text-foreground"
                }`}
              >
                {tab.label}
                <span className={`font-mono text-[11px] font-medium px-1.5 py-0.5 rounded-full ${
                  isActive
                    ? "bg-accent/15 text-accent"
                    : "bg-surface-raised text-foreground-muted"
                }`}>
                  {count}
                </span>
                {/* Active underline */}
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent rounded-t-full" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner className="h-5 w-5 text-foreground-muted" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="font-body text-sm text-foreground-muted">No communities found</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((c, i) => (
              <div key={c.id}>
                <CommunityCard
                  c={c}
                  onClick={() => {
                    if (c.joined) router.push(`/dashboard/communities/${c.id}`);
                  }}
                />
                {i < filtered.length - 1 && (
                  <div className="mx-6 h-px bg-border" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
