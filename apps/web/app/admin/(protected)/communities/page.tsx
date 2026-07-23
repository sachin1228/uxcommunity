"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { CommunityRow, type CommunityListItem } from "@/components/admin/communities/CommunityRow";

const TABS = [
  { label: "All",        value: "all"              },
  { label: "Company",    value: "company"          },
  { label: "Industry",   value: "sector"           },
  { label: "Interest",   value: "interest"         },
  { label: "Experience", value: "experience_level" },
  { label: "City",       value: "city"             },
] as const;

type TabValue = typeof TABS[number]["value"];

export default function AdminCommunitiesPage() {
  const router = useRouter();
  const [communities, setCommunities] = useState<CommunityListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabValue>("all");
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

  const filtered = communities
    .filter((c) => activeTab === "all" || c.type === activeTab)
    .filter((c) => {
      const q = search.trim().toLowerCase();
      return q ? c.name.toLowerCase().includes(q) : true;
    });

  const countByTab = (tab: TabValue) =>
    tab === "all"
      ? communities.length
      : communities.filter((c) => c.type === tab).length;

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

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto pb-0">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.value;
          const count = countByTab(tab.value);
          return (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`relative flex items-center gap-1.5 px-3 pb-2.5 font-body text-xs whitespace-nowrap transition-colors ${
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
                {count}
              </span>
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent rounded-t-full" />
              )}
            </button>
          );
        })}
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
            <Spinner className="h-5 w-5 text-foreground-muted" />
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
