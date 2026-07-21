"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Search, Users, MessageSquare, Hash } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

interface Community {
  id: string;
  name: string;
  type: string;
  image_url: string | null;
  is_active: boolean;
  member_count: number;
  message_count: number;
  created_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  city:             "City",
  sector:           "Industry",
  interest:         "Interest",
  company:          "Company",
  experience_level: "Experience",
};

const TYPE_EMOJI: Record<string, string> = {
  city:             "📍",
  sector:           "🏢",
  interest:         "✦",
  company:          "🏬",
  experience_level: "🎯",
};

const TYPE_COLORS: Record<string, string> = {
  city:             "bg-blue-500/10 text-blue-400",
  sector:           "bg-purple-500/10 text-purple-400",
  interest:         "bg-pink-500/10 text-pink-400",
  company:          "bg-amber-500/10 text-amber-400",
  experience_level: "bg-green-500/10 text-green-400",
};

const TABS = [
  { label: "All",        value: "all"              },
  { label: "Company",    value: "company"          },
  { label: "Industry",   value: "sector"           },
  { label: "Interest",   value: "interest"         },
  { label: "Experience", value: "experience_level" },
  { label: "City",       value: "city"             },
] as const;

type TabValue = typeof TABS[number]["value"];

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function CommunityRow({
  community: c,
  isLast,
  onClick,
}: {
  community: Community;
  isLast: boolean;
  onClick: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const fallback = TYPE_EMOJI[c.type] ?? "💬";

  return (
    <tr
      onClick={onClick}
      className={`cursor-pointer transition-colors hover:bg-surface-raised ${
        !isLast ? "border-b border-border" : ""
      }`}
    >
      {/* Name + avatar */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {c.image_url && !imgFailed ? (
            <img
              src={c.image_url}
              alt={c.name}
              className="h-8 w-8 rounded-full object-cover shrink-0"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <div className="h-8 w-8 rounded-full bg-surface-raised flex items-center justify-center shrink-0 text-sm select-none">
              {fallback}
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="font-body text-sm text-foreground">{c.name}</span>
            {!c.is_active && (
              <span className="px-1.5 py-0.5 rounded-full font-body text-[10px] font-medium bg-orange-500/10 text-orange-400">
                Deactivated
              </span>
            )}
          </div>
        </div>
      </td>
      {/* Type badge */}
      <td className="px-4 py-3">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-body text-[11px] font-medium ${
          TYPE_COLORS[c.type] ?? "bg-surface-raised text-foreground-muted"
        }`}>
          {TYPE_LABELS[c.type] ?? c.type}
        </span>
      </td>
      {/* Members */}
      <td className="px-4 py-3 text-right">
        <span className="flex items-center justify-end gap-1 font-mono text-xs text-foreground-muted">
          <Users size={11} />
          {c.member_count.toLocaleString()}
        </span>
      </td>
      {/* Messages */}
      <td className="px-4 py-3 text-right">
        <span className="flex items-center justify-end gap-1 font-mono text-xs text-foreground-muted">
          <MessageSquare size={11} />
          {c.message_count.toLocaleString()}
        </span>
      </td>
      {/* Status */}
      <td className="px-4 py-3 text-right">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-body text-[11px] font-medium ${
          c.is_active
            ? "bg-green-500/10 text-green-400"
            : "bg-orange-500/10 text-orange-400"
        }`}>
          {c.is_active ? "Active" : "Deactivated"}
        </span>
      </td>
      {/* Created */}
      <td className="px-4 py-3 text-right font-body text-xs text-foreground-muted">
        {fmt(c.created_at)}
      </td>
      {/* Chevron */}
      <td className="px-4 py-3 text-right">
        <ChevronRight size={14} className="text-foreground-muted ml-auto" />
      </td>
    </tr>
  );
}

export default function AdminCommunitiesPage() {
  const router = useRouter();
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabValue>("all");
  const [search, setSearch] = useState("");

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
            {loading ? "Loading…" : `${communities.length} live communit${communities.length !== 1 ? "ies" : "y"}`}
          </p>
        </div>
      </div>

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
              <span className={`font-mono text-[11px] font-medium px-1.5 py-0.5 rounded-full ${
                isActive ? "bg-accent/15 text-accent" : "bg-surface-raised text-foreground-muted"
              }`}>
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
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted pointer-events-none" />
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
    </div>
  );
}
