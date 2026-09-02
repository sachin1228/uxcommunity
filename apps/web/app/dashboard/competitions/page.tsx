"use client";

import { useState } from "react";
import Link from "next/link";
import { Trophy, Palette, Monitor, Bot, User, Clock, Users, ChevronRight } from "lucide-react";

type CompetitionStatus = "active" | "upcoming" | "ended";

interface Competition {
  id: string;
  title: string;
  emoji: string;
  description: string;
  category: string;
  status: CompetitionStatus;
  entryCount: number;
  voteCount: number;
  deadline: string;
  icon: React.ReactNode;
}

const COMPETITIONS: Competition[] = [
  {
    id: "best-visual-design",
    title: "Best Visual Design",
    emoji: "🎨",
    description: "Posters, branding, illustrations, graphics, social designs",
    category: "visual",
    status: "active",
    entryCount: 24,
    voteCount: 156,
    deadline: "Sep 30, 2026",
    icon: <Palette size={20} />,
  },
  {
    id: "best-uiux-design",
    title: "Best UI/UX Design",
    emoji: "🖥️",
    description: "Websites, apps, dashboards, landing pages, product concepts",
    category: "uiux",
    status: "active",
    entryCount: 18,
    voteCount: 132,
    deadline: "Sep 30, 2026",
    icon: <Monitor size={20} />,
  },
  {
    id: "best-ai-design",
    title: "Best AI Design",
    emoji: "🤖",
    description: "AI-generated/AI-assisted visual & UI design projects",
    category: "ai",
    status: "active",
    entryCount: 31,
    voteCount: 203,
    deadline: "Sep 30, 2026",
    icon: <Bot size={20} />,
  },
  {
    id: "best-portfolio",
    title: "Best Portfolio",
    emoji: "👤",
    description: "Personal design portfolios and showcases",
    category: "portfolio",
    status: "active",
    entryCount: 15,
    voteCount: 98,
    deadline: "Sep 30, 2026",
    icon: <User size={20} />,
  },
];

const STATUS_TABS = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Upcoming", value: "upcoming" },
  { label: "Ended", value: "ended" },
] as const;

type TabValue = (typeof STATUS_TABS)[number]["value"];

const STATUS_STYLES: Record<CompetitionStatus, string> = {
  active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  upcoming: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  ended: "bg-gray-500/10 text-gray-400 border-gray-500/20",
};

function CompetitionCard({ competition }: { competition: Competition }) {
  return (
    <Link
      href={`/dashboard/competitions/${competition.id}`}
      className="group flex flex-col rounded-xl border border-white/[0.08] bg-surface-raised p-5 transition-all hover:border-white/[0.18] hover:shadow-lg cursor-pointer"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface text-foreground">
            {competition.icon}
          </div>
          <div>
            <h3 className="font-display text-sm font-semibold text-foreground group-hover:text-accent transition-colors">
              {competition.emoji} {competition.title}
            </h3>
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 font-body text-[10px] font-medium mt-1 ${
                STATUS_STYLES[competition.status]
              }`}
            >
              {competition.status === "active" && "● Active"}
              {competition.status === "upcoming" && "○ Upcoming"}
              {competition.status === "ended" && "○ Ended"}
            </span>
          </div>
        </div>
        <ChevronRight
          size={16}
          className="text-foreground-muted group-hover:text-foreground transition-colors mt-1"
        />
      </div>

      {/* Description */}
      <p className="font-body text-xs text-foreground-muted leading-relaxed mb-4 flex-1">
        {competition.description}
      </p>

      {/* Stats */}
      <div className="flex items-center gap-4 pt-3 border-t border-white/[0.06]">
        <div className="flex items-center gap-1.5">
          <Users size={12} className="text-foreground-muted" />
          <span className="font-body text-xs text-foreground-muted">
            {competition.entryCount} entries
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Trophy size={12} className="text-foreground-muted" />
          <span className="font-body text-xs text-foreground-muted">
            {competition.voteCount} votes
          </span>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <Clock size={12} className="text-foreground-muted" />
          <span className="font-body text-xs text-foreground-muted">
            {competition.deadline}
          </span>
        </div>
      </div>
    </Link>
  );
}

export default function CompetitionsPage() {
  const [activeTab, setActiveTab] = useState<TabValue>("all");

  const filtered = COMPETITIONS.filter((c) => {
    if (activeTab === "all") return true;
    return c.status === activeTab;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 shrink-0">
        <div className="flex items-center gap-3 mb-2">
          <Trophy size={24} className="text-accent" />
          <h1 className="font-display text-xl font-semibold text-foreground">
            Design Competitions
          </h1>
        </div>
        <p className="font-body text-sm text-foreground-muted mb-4">
          Submit your work, vote for your favorites, and compete to be the best.
        </p>

        {/* Status Tabs */}
        <div className="flex items-center gap-2">
          {STATUS_TABS.map((tab) => {
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

      {/* Competition Grid */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Trophy size={48} className="text-foreground-muted opacity-40 mb-4" />
            <p className="font-body text-sm text-foreground-muted">
              No competitions found
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filtered.map((competition) => (
              <CompetitionCard key={competition.id} competition={competition} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
