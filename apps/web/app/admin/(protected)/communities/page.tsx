"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, Trash2, Sparkles, Users } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { CommunityRow, type CommunityListItem } from "@/components/admin/communities/CommunityRow";

// Main origin tabs: communities the uxcommunity app creates itself vs the
// personal/public communities members create.
const MAIN_TABS = [
  { label: "App-created", value: "app", icon: Sparkles },
  { label: "Member-created", value: "member", icon: Users },
] as const;

type MainTabValue = typeof MAIN_TABS[number]["value"];

// Type sub-tabs (shown below the origin tabs, always the same row).
const TYPE_TABS = [
  { label: "All", value: "all" },
  { label: "General", value: "general" },
  { label: "Industry", value: "sector" },
  { label: "Interest", value: "interest" },
  { label: "Experience", value: "experience_level" },
  { label: "City", value: "city" },
] as const;

type TypeTabValue = typeof TYPE_TABS[number]["value"];

export default function AdminCommunitiesPage() {
  const router = useRouter();
  const [communities, setCommunities] = useState<CommunityListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [mainTab, setMainTab] = useState<MainTabValue>("app");
  const [typeTab, setTypeTab] = useState<TypeTabValue>("all");
  const [search, setSearch] = useState("");

  // Reset all chat state
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetResult, setResetResult] = useState<{ deleted: number } | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  async function handleResetAllChat() {
    setResetLoading(true);
    setResetError(null);
    try {
      const res = await fetch("/api/admin/communities/messages", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setResetError(data.error ?? "Failed to reset chat.");
        return;
      }
      setResetResult({ deleted: data.deleted });
      setShowResetConfirm(false);
      // Refresh communities list to update message counts
      fetch("/api/admin/communities")
        .then((r) => r.json())
        .then((d) => setCommunities(d.communities ?? []))
        .catch(() => {});
    } finally {
      setResetLoading(false);
    }
  }

  useEffect(() => {
    fetch("/api/admin/communities")
      .then((r) => r.json())
      .then((d) => setCommunities(d.communities ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const appCreated = useMemo(
    () => communities.filter((c) => c.owner_id == null),
    [communities]
  );
  const memberCreated = useMemo(
    () => communities.filter((c) => c.owner_id != null),
    [communities]
  );

  const baseCommunities = mainTab === "app" ? appCreated : memberCreated;

  const filtered = baseCommunities
    .filter((c) => typeTab === "all" || c.type === typeTab)
    .filter((c) => {
      const q = search.trim().toLowerCase();
      return q ? c.name.toLowerCase().includes(q) : true;
    });

  const countByMainTab = (tab: MainTabValue) =>
    tab === "app" ? appCreated.length : memberCreated.length;

  const countByTypeTab = (tab: TypeTabValue) => {
    if (tab === "all") return baseCommunities.length;
    return baseCommunities.filter((c) => c.type === tab).length;
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">Communities</h1>
          <p className="font-body text-xs text-foreground-muted mt-0.5">
            {loading
              ? "Loading…"
              : `${communities.length} live communit${communities.length !== 1 ? "ies" : "y"}`}
          </p>
        </div>
        <button
          onClick={() => { setShowResetConfirm(true); setResetResult(null); setResetError(null); }}
          className="flex items-center gap-1.5 rounded-md border border-red-500/30 px-3 py-1.5 font-body text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <Trash2 size={12} />
          Reset all chat
        </button>
      </div>

      {/* Reset success banner */}
      {resetResult && (
        <div className="rounded-lg border border-green-500/20 bg-green-500/10 px-4 py-2.5 flex items-center justify-between">
          <p className="font-body text-xs text-green-400">
            ✓ Deleted {resetResult.deleted} message{resetResult.deleted !== 1 ? "s" : ""} across all communities.
          </p>
          <button
            onClick={() => setResetResult(null)}
            className="font-body text-[11px] text-green-400/70 hover:text-green-400 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Origin + type filters */}
      <div className="flex flex-col gap-2">
        {/* Main tabs — origin of the community (GitHub-style tab containers). The
            divider line sits on a layer BEHIND the tabs, so the active tab's opaque
            background covers it — the active tab has no visible bottom border. */}
        <div className="relative">
          <div className="relative z-10 flex items-end gap-1 overflow-x-auto">
            {MAIN_TABS.map((tab) => {
              const isActive = mainTab === tab.value;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.value}
                  onClick={() => { setMainTab(tab.value); setTypeTab("all"); }}
                  // border-b-0 on both states keeps every tab the same height, so
                  // switching the active tab never shifts the row.
                  className={`relative flex items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-2 font-body text-xs whitespace-nowrap transition-colors ${
                    isActive
                      ? "border-border bg-background text-foreground"
                      : "border-transparent text-foreground-muted hover:text-foreground"
                  }`}
                >
                  <Icon size={13} />
                  {tab.label}
                  <span
                    className={`font-mono text-[11px] font-medium px-1.5 py-0.5 rounded-full ${
                      isActive
                        ? "bg-accent/15 text-accent"
                        : "bg-surface-raised text-foreground-muted"
                    }`}
                  >
                    {countByMainTab(tab.value)}
                  </span>
                </button>
              );
            })}
          </div>
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border"
            aria-hidden="true"
          />
        </div>

        {/* Type sub-tabs — always the same row, so switching the main origin tab
            never changes the buttons below it. Counts are scoped to the active
            origin (member-created communities have no type, so those read 0). */}
        <div className="flex gap-1 border-b border-border overflow-x-auto pb-0">
          {TYPE_TABS.map((tab) => {
            const isActive = typeTab === tab.value;
            return (
              <button
                key={tab.value}
                onClick={() => setTypeTab(tab.value)}
                className={`relative flex items-center gap-1.5 px-3 pb-2.5 pt-2 font-body text-xs whitespace-nowrap transition-colors ${
                  isActive ? "text-foreground" : "text-foreground-muted hover:text-foreground"
                }`}
              >
                {tab.label}
                <span
                  className={`font-mono text-[11px] font-medium px-1.5 py-0.5 rounded-full ${
                    isActive
                      ? "bg-accent/15 text-accent"
                      : "bg-surface-raised text-foreground-muted"
                  }`}
                >
                  {countByTypeTab(tab.value)}
                </span>
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent rounded-t-full" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search
          size={13}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted pointer-events-none"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search communities…"
          className="w-full rounded-lg border border-border bg-surface pl-8 pr-4 py-2 font-body text-xs text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-1 focus:ring-accent/40"
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner className="h-5 w-5" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="font-body text-sm text-foreground-muted">No communities found</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-surface-raised">
                <th className="px-4 py-2.5 text-left font-body text-[11px] font-medium text-foreground-muted">Community</th>
                <th className="px-4 py-2.5 text-left font-body text-[11px] font-medium text-foreground-muted">Type</th>
                <th className="px-4 py-2.5 text-right font-body text-[11px] font-medium text-foreground-muted">Members</th>
                <th className="px-4 py-2.5 text-right font-body text-[11px] font-medium text-foreground-muted">Messages</th>
                <th className="px-4 py-2.5 text-right font-body text-[11px] font-medium text-foreground-muted">Status</th>
                <th className="px-4 py-2.5 text-right font-body text-[11px] font-medium text-foreground-muted">Created</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
                <CommunityRow
                  key={c.id}
                  community={c}
                  isLast={i === filtered.length - 1}
                  onClick={() => router.push(`/admin/communities/${c.id}`)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Reset All Chat confirmation modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-2xl">
            <h2 className="font-display text-base font-semibold text-foreground mb-1">
              Reset all community chat?
            </h2>
            <p className="font-body text-xs text-foreground-muted mb-5">
              This will permanently delete <span className="text-red-400 font-medium">every message</span> across{" "}
              <span className="text-foreground font-medium">all {communities.length} communities</span>. Members and communities themselves are kept. This cannot be undone.
            </p>
            {resetError && (
              <p className="mb-4 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 font-body text-xs text-red-400">
                {resetError}
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => { setShowResetConfirm(false); setResetError(null); }}
                className="flex-1 rounded-md border border-border py-2 font-body text-xs text-foreground-muted hover:bg-surface-raised transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleResetAllChat}
                disabled={resetLoading}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-md bg-red-600 py-2 font-body text-xs font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-60"
              >
                {resetLoading ? <Spinner className="h-3 w-3" /> : <Trash2 size={12} />}
                Yes, delete all
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
