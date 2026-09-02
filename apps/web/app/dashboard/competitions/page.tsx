"use client";

import { useState, useMemo } from "react";
import {
  Trophy,
  Palette,
  Monitor,
  Bot,
  User,
  Clock,
  Users,
  ChevronUp,
  Plus,
  Medal,
  ExternalLink,
} from "lucide-react";
import { SubmitEntryModal } from "@/components/competitions/SubmitEntryModal";

type Category = "visual" | "uiux" | "ai" | "portfolio";

interface Entry {
  id: string;
  title: string;
  description: string;
  authorName: string;
  authorAvatar: string | null;
  imageUrl: string;
  liveUrl?: string;
  votes: number;
  hasVoted: boolean;
  submittedAt: string;
  category: Category;
}

const CATEGORIES: { id: Category; label: string; emoji: string; icon: React.ReactNode; description: string }[] = [
  { id: "visual", label: "Best Visual Design", emoji: "🎨", icon: <Palette size={18} />, description: "Posters, branding, illustrations, graphics, social designs" },
  { id: "uiux", label: "Best UI/UX Design", emoji: "🖥️", icon: <Monitor size={18} />, description: "Websites, apps, dashboards, landing pages, product concepts" },
  { id: "ai", label: "Best AI Design", emoji: "🤖", icon: <Bot size={18} />, description: "AI-generated/AI-assisted visual & UI design projects" },
  { id: "portfolio", label: "Best Portfolio", emoji: "👤", icon: <User size={18} />, description: "Personal design portfolios and showcases" },
];

const CATEGORY_TABS = [
  { label: "All", value: "all" },
  ...CATEGORIES.map((c) => ({ label: `${c.emoji} ${c.label}`, value: c.id })),
] as const;

type TabValue = (typeof CATEGORY_TABS)[number]["value"];

const MOCK_ENTRIES: Entry[] = [
  // Visual Design
  { id: "1", title: "Neon Brand Identity", description: "A vibrant brand identity system with neon colors and modern typography for a tech startup.", authorName: "Sarah Chen", authorAvatar: null, imageUrl: "https://images.unsplash.com/photo-1561070791-2526d30994b5?w=400&h=300&fit=crop", liveUrl: "https://example.com", votes: 42, hasVoted: false, submittedAt: "2 days ago", category: "visual" },
  { id: "2", title: "Minimalist Poster Series", description: "A series of minimalist posters exploring negative space and bold typography.", authorName: "Alex Rivera", authorAvatar: null, imageUrl: "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=400&h=300&fit=crop", votes: 38, hasVoted: true, submittedAt: "3 days ago", category: "visual" },
  { id: "3", title: "Retro Album Cover", description: "Vintage-inspired album cover design with bold colors and geometric shapes.", authorName: "Jordan Kim", authorAvatar: null, imageUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&h=300&fit=crop", votes: 28, hasVoted: false, submittedAt: "5 days ago", category: "visual" },
  // UI/UX
  { id: "4", title: "SaaS Dashboard Concept", description: "A clean analytics dashboard with data visualization and dark mode.", authorName: "Maya Patel", authorAvatar: null, imageUrl: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=400&h=300&fit=crop", liveUrl: "https://figma.com", votes: 56, hasVoted: false, submittedAt: "1 day ago", category: "uiux" },
  { id: "5", title: "Fitness App Redesign", description: "Mobile fitness app with gamification elements and progress tracking.", authorName: "Chris Lee", authorAvatar: null, imageUrl: "https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=400&h=300&fit=crop", votes: 45, hasVoted: false, submittedAt: "2 days ago", category: "uiux" },
  { id: "6", title: "E-commerce Landing Page", description: "Modern product landing page with smooth animations and conversion focus.", authorName: "Emma Wilson", authorAvatar: null, imageUrl: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=400&h=300&fit=crop", votes: 33, hasVoted: false, submittedAt: "4 days ago", category: "uiux" },
  // AI Design
  { id: "7", title: "AI Art Collection", description: "Series of abstract artworks generated using Midjourney and refined in Photoshop.", authorName: "David Park", authorAvatar: null, imageUrl: "https://images.unsplash.com/photo-1686191128892-3b3705bcf941?w=400&h=300&fit=crop", votes: 61, hasVoted: false, submittedAt: "1 day ago", category: "ai" },
  { id: "8", title: "AI-Assisted Branding", description: "Complete brand identity created with AI tools for a sustainable fashion brand.", authorName: "Lisa Chang", authorAvatar: null, imageUrl: "https://images.unsplash.com/photo-1634986666676-ec8fd927c23d?w=400&h=300&fit=crop", votes: 47, hasVoted: false, submittedAt: "3 days ago", category: "ai" },
  { id: "9", title: "Generative Patterns", description: "Unique textile patterns generated with AI and adapted for product design.", authorName: "Tom Harris", authorAvatar: null, imageUrl: "https://images.unsplash.com/photo-1558591710-4b4a1ae0f04d?w=400&h=300&fit=crop", votes: 39, hasVoted: false, submittedAt: "4 days ago", category: "ai" },
  // Portfolio
  { id: "10", title: "Minimal Portfolio", description: "Clean, typography-focused portfolio showcasing brand and web work.", authorName: "Ana Costa", authorAvatar: null, imageUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=300&fit=crop", liveUrl: "https://portfolio.example.com", votes: 35, hasVoted: false, submittedAt: "2 days ago", category: "portfolio" },
  { id: "11", title: "Creative Agency Site", description: "Bold portfolio site with immersive animations and case studies.", authorName: "James Wu", authorAvatar: null, imageUrl: "https://images.unsplash.com/photo-1467232004584-a241de8bcf5d?w=400&h=300&fit=crop", votes: 29, hasVoted: false, submittedAt: "5 days ago", category: "portfolio" },
];

function WinnerBadge({ rank }: { rank: number }) {
  const styles: Record<number, string> = {
    1: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    2: "bg-gray-300/10 text-gray-300 border-gray-400/20",
    3: "bg-amber-700/10 text-amber-600 border-amber-700/20",
  };
  const labels: Record<number, string> = { 1: "🥇 1st", 2: "🥈 2nd", 3: "🥉 3rd" };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-body text-[10px] font-semibold ${styles[rank]}`}>
      {labels[rank]}
    </span>
  );
}

function EntryCard({
  entry,
  onVote,
  rank,
}: {
  entry: Entry;
  onVote: (id: string) => void;
  rank?: number;
}) {
  return (
    <div className="group flex flex-col rounded-xl border border-white/[0.08] bg-surface-raised overflow-hidden transition-all hover:border-white/[0.18] hover:shadow-lg">
      <div className="relative aspect-[4/3] overflow-hidden bg-surface">
        <img src={entry.imageUrl} alt={entry.title} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
        {rank !== undefined && (
          <div className="absolute top-3 left-3"><WinnerBadge rank={rank} /></div>
        )}
        {entry.liveUrl && (
          <a
            href={entry.liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink size={14} />
          </a>
        )}
      </div>
      <div className="flex flex-col flex-1 p-4">
        <h3 className="font-display text-sm font-semibold text-foreground mb-1 line-clamp-1">{entry.title}</h3>
        <p className="font-body text-xs text-foreground-muted leading-relaxed mb-3 flex-1 line-clamp-2">{entry.description}</p>
        <div className="flex items-center justify-between pt-3 border-t border-white/[0.06]">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-full bg-surface flex items-center justify-center text-[10px] font-semibold text-foreground-muted">
              {entry.authorName.charAt(0)}
            </div>
            <span className="font-body text-xs text-foreground-muted">{entry.authorName}</span>
          </div>
          <button
            onClick={() => onVote(entry.id)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 font-body text-xs font-medium transition-colors ${
              entry.hasVoted
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-border text-foreground-muted hover:border-border-strong hover:text-foreground"
            }`}
          >
            <ChevronUp size={14} className={entry.hasVoted ? "text-accent" : ""} />
            {entry.votes}
          </button>
        </div>
      </div>
    </div>
  );
}

function CategorySection({
  category,
  entries,
  onVote,
}: {
  category: (typeof CATEGORIES)[number];
  entries: Entry[];
  onVote: (id: string) => void;
}) {
  const sorted = [...entries].sort((a, b) => b.votes - a.votes);
  const top3 = sorted.slice(0, 3);
  const rest = sorted.slice(3);

  return (
    <section className="mb-10">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface text-foreground">
          {category.icon}
        </div>
        <div>
          <h2 className="font-display text-base font-semibold text-foreground">
            {category.emoji} {category.label}
          </h2>
          <p className="font-body text-xs text-foreground-muted">{category.description}</p>
        </div>
        <span className="ml-auto font-body text-xs text-foreground-muted">{entries.length} entries</span>
      </div>

      {/* Top 3 */}
      {top3.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
          {top3.map((entry, i) => (
            <EntryCard key={entry.id} entry={entry} onVote={onVote} rank={i + 1} />
          ))}
        </div>
      )}

      {/* Rest */}
      {rest.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rest.map((entry) => (
            <EntryCard key={entry.id} entry={entry} onVote={onVote} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function CompetitionsPage() {
  const [entries, setEntries] = useState<Entry[]>(MOCK_ENTRIES);
  const [activeTab, setActiveTab] = useState<TabValue>("all");
  const [showSubmitModal, setShowSubmitModal] = useState(false);

  const filtered = useMemo(() => {
    if (activeTab === "all") return entries;
    return entries.filter((e) => e.category === activeTab);
  }, [entries, activeTab]);

  const groupedByCategory = useMemo(() => {
    return CATEGORIES.map((cat) => ({
      ...cat,
      entries: filtered.filter((e) => e.category === cat.id),
    })).filter((g) => g.entries.length > 0);
  }, [filtered]);

  function handleVote(entryId: string) {
    setEntries((prev) =>
      prev.map((e) =>
        e.id === entryId
          ? { ...e, votes: e.hasVoted ? e.votes - 1 : e.votes + 1, hasVoted: !e.hasVoted }
          : e
      )
    );
  }

  function handleSubmit(title: string, description: string, imageUrl: string, category: Category, liveUrl?: string) {
    const newEntry: Entry = {
      id: String(Date.now()),
      title,
      description,
      authorName: "You",
      authorAvatar: null,
      imageUrl,
      liveUrl,
      votes: 0,
      hasVoted: false,
      submittedAt: "Just now",
      category,
    };
    setEntries((prev) => [newEntry, ...prev]);
    setShowSubmitModal(false);
  }

  const totalVotes = entries.reduce((sum, e) => sum + e.votes, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 shrink-0">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Trophy size={24} className="text-accent" />
              <h1 className="font-display text-xl font-semibold text-foreground">
                Design Competitions
              </h1>
            </div>
            <p className="font-body text-sm text-foreground-muted">
              Submit your work, vote for your favorites, and compete to be the best.
            </p>
          </div>
          <button
            onClick={() => setShowSubmitModal(true)}
            className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 font-body text-sm font-medium text-white hover:bg-accent/90 transition-colors shrink-0"
          >
            <Plus size={16} />
            Submit Entry
          </button>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-6 mb-4">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-foreground-muted" />
            <span className="font-body text-sm text-foreground-muted">{entries.length} entries</span>
          </div>
          <div className="flex items-center gap-2">
            <Trophy size={16} className="text-foreground-muted" />
            <span className="font-body text-sm text-foreground-muted">{totalVotes} votes</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-foreground-muted" />
            <span className="font-body text-sm text-foreground-muted">Ends Sep 30, 2026</span>
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {CATEGORY_TABS.map((tab) => {
            const isActive = activeTab === tab.value;
            return (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value as TabValue)}
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Trophy size={48} className="text-foreground-muted opacity-40 mb-4" />
            <p className="font-body text-sm text-foreground-muted">No entries yet</p>
            <button
              onClick={() => setShowSubmitModal(true)}
              className="mt-3 font-body text-sm text-accent hover:underline"
            >
              Be the first to submit
            </button>
          </div>
        ) : activeTab === "all" ? (
          groupedByCategory.map((group) => (
            <CategorySection
              key={group.id}
              category={group}
              entries={group.entries}
              onVote={handleVote}
            />
          ))
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered
              .sort((a, b) => b.votes - a.votes)
              .map((entry, i) => (
                <EntryCard key={entry.id} entry={entry} onVote={handleVote} rank={i < 3 ? i + 1 : undefined} />
              ))}
          </div>
        )}
      </div>

      {/* Submit Modal */}
      {showSubmitModal && (
        <SubmitEntryModal
          onClose={() => setShowSubmitModal(false)}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}
