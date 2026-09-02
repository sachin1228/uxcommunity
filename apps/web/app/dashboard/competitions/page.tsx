"use client";

import { useState, useMemo, useRef, useEffect } from "react";
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
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Star,
} from "lucide-react";
import { SubmitEntryModal } from "@/components/competitions/SubmitEntryModal";

type Category = "visual" | "uiux" | "ai" | "portfolio";
type TimePeriod = "weekly" | "monthly" | "yearly";
type ViewFilter = "featured" | "all";

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
  category: Category;
  isFeatured?: boolean;
}

interface WeekRange {
  label: string;
  shortLabel: string;
  startDate: Date;
  endDate: Date;
}

const CATEGORIES: Record<Category, { label: string; emoji: string; icon: React.ReactNode }> = {
  visual: { label: "Visual Design", emoji: "🎨", icon: <Palette size={16} /> },
  uiux: { label: "UI/UX Design", emoji: "🖥️", icon: <Monitor size={16} /> },
  ai: { label: "AI Design", emoji: "🤖", icon: <Bot size={16} /> },
  portfolio: { label: "Portfolio", emoji: "👤", icon: <User size={16} /> },
};

function generateWeekRanges(): WeekRange[] {
  const weeks: WeekRange[] = [];
  const now = new Date(2026, 8, 2); // Sep 2, 2026 (Tue)

  // Go back 12 weeks
  for (let i = 0; i < 12; i++) {
    const end = new Date(now);
    end.setDate(now.getDate() - (i * 7));
    const start = new Date(end);
    start.setDate(end.getDate() - 6);

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    weeks.push({
      label: `${monthNames[start.getMonth()]} ${start.getDate()} — ${monthNames[end.getMonth()]} ${end.getDate()}`,
      shortLabel: start.getMonth() === end.getMonth()
        ? `${monthNames[start.getMonth()]} ${start.getDate()}—${end.getDate()}`
        : `${monthNames[start.getMonth()]} ${start.getDate()}—${monthNames[end.getMonth()]} ${end.getDate()}`,
      startDate: start,
      endDate: end,
    });
  }
  return weeks;
}

const WEEK_RANGES = generateWeekRanges();
const CURRENT_WEEK_INDEX = 0;

const MOCK_ENTRIES: Record<number, Entry[]> = {
  0: [
    { id: "1", title: "Neon Brand Identity", description: "A vibrant brand identity system with neon colors and modern typography.", authorName: "Sarah Chen", authorAvatar: null, imageUrl: "https://images.unsplash.com/photo-1561070791-2526d30994b5?w=400&h=300&fit=crop", liveUrl: "https://example.com", votes: 42, hasVoted: false, category: "visual", isFeatured: true },
    { id: "2", title: "Minimalist Poster Series", description: "A series of minimalist posters exploring negative space and bold typography.", authorName: "Alex Rivera", authorAvatar: null, imageUrl: "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=400&h=300&fit=crop", votes: 38, hasVoted: true, category: "visual", isFeatured: true },
    { id: "3", title: "Retro Album Cover", description: "Vintage-inspired album cover design with bold colors and geometric shapes.", authorName: "Jordan Kim", authorAvatar: null, imageUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&h=300&fit=crop", votes: 28, hasVoted: false, category: "visual" },
    { id: "4", title: "Eco Packaging Design", description: "Sustainable packaging design for an organic skincare brand.", authorName: "Emma Wilson", authorAvatar: null, imageUrl: "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=400&h=300&fit=crop", votes: 25, hasVoted: false, category: "visual" },
    { id: "5", title: "Abstract Art Collection", description: "A collection of abstract digital art pieces exploring color and form.", authorName: "Chris Lee", authorAvatar: null, imageUrl: "https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=400&h=300&fit=crop", votes: 22, hasVoted: false, category: "visual" },
    { id: "6", title: "Geometric Patterns", description: "Bold geometric pattern system for a modern brand identity.", authorName: "Maya Patel", authorAvatar: null, imageUrl: "https://images.unsplash.com/photo-1618005198919-d3d4b5a92ead?w=400&h=300&fit=crop", votes: 19, hasVoted: false, category: "visual" },
  ],
  1: [
    { id: "w1-1", title: "SaaS Dashboard", description: "Clean analytics dashboard with data visualization.", authorName: "Maya Patel", authorAvatar: null, imageUrl: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=400&h=300&fit=crop", votes: 56, hasVoted: false, category: "uiux", isFeatured: true },
    { id: "w1-2", title: "Fitness App Redesign", description: "Mobile fitness app with gamification elements.", authorName: "Chris Lee", authorAvatar: null, imageUrl: "https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=400&h=300&fit=crop", votes: 45, hasVoted: false, category: "uiux" },
    { id: "w1-3", title: "E-commerce Landing", description: "Modern product landing page with smooth animations.", authorName: "Emma Wilson", authorAvatar: null, imageUrl: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=400&h=300&fit=crop", votes: 33, hasVoted: false, category: "uiux" },
  ],
  2: [
    { id: "w2-1", title: "AI Art Collection", description: "Abstract artworks generated using Midjourney.", authorName: "David Park", authorAvatar: null, imageUrl: "https://images.unsplash.com/photo-1686191128892-3b3705bcf941?w=400&h=300&fit=crop", votes: 61, hasVoted: false, category: "ai", isFeatured: true },
    { id: "w2-2", title: "AI-Assisted Branding", description: "Brand identity created with AI tools.", authorName: "Lisa Chang", authorAvatar: null, imageUrl: "https://images.unsplash.com/photo-1634986666676-ec8fd927c23d?w=400&h=300&fit=crop", votes: 47, hasVoted: false, category: "ai" },
  ],
};

const CATEGORY_CYCLE: Category[] = ["visual", "uiux", "ai", "portfolio"];

function EntryRow({ entry, onVote, rank }: { entry: Entry; onVote: (id: string) => void; rank: number }) {
  const cat = CATEGORIES[entry.category];
  return (
    <div className="group flex items-center gap-4 py-4 border-b border-white/[0.06] last:border-b-0 hover:bg-surface-raised/50 transition-colors px-2 -mx-2 rounded-lg">
      {/* Rank */}
      <span className="w-8 text-center font-display text-sm font-semibold text-foreground-muted">
        {rank}
      </span>

      {/* Thumbnail */}
      <div className="h-16 w-16 rounded-lg overflow-hidden bg-surface shrink-0">
        <img src={entry.imageUrl} alt={entry.title} className="h-full w-full object-cover" />
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <h3 className="font-display text-sm font-semibold text-foreground truncate group-hover:text-accent transition-colors">
            {entry.title}
          </h3>
          {entry.isFeatured && (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 border border-accent/20 px-2 py-0.5 font-body text-[10px] font-medium text-accent">
              <Star size={10} fill="currentColor" />
              Featured
            </span>
          )}
        </div>
        <p className="font-body text-xs text-foreground-muted line-clamp-1">{entry.description}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="font-body text-[11px] text-foreground-muted">{entry.authorName}</span>
          <span className="font-body text-[11px] text-foreground-muted">·</span>
          <span className="inline-flex items-center gap-1 font-body text-[11px] text-foreground-muted">
            {cat.emoji} {cat.label}
          </span>
        </div>
      </div>

      {/* Vote button */}
      <button
        onClick={() => onVote(entry.id)}
        className={`flex flex-col items-center gap-0.5 rounded-xl border px-4 py-2 font-body text-sm font-medium transition-all shrink-0 ${
          entry.hasVoted
            ? "border-accent/40 bg-accent/10 text-accent"
            : "border-border text-foreground-muted hover:border-border-strong hover:text-foreground hover:bg-surface-raised"
        }`}
      >
        <ChevronUp size={16} className={entry.hasVoted ? "text-accent" : ""} />
        {entry.votes}
      </button>
    </div>
  );
}

export default function CompetitionsPage() {
  const [selectedWeek, setSelectedWeek] = useState(CURRENT_WEEK_INDEX);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("weekly");
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [entries, setEntries] = useState<Entry[]>(MOCK_ENTRIES[0] || []);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);

  const currentWeek = WEEK_RANGES[selectedWeek];
  const currentCategory = CATEGORY_CYCLE[selectedWeek % 4];

  useEffect(() => {
    setEntries(MOCK_ENTRIES[selectedWeek] || []);
  }, [selectedWeek]);

  const filteredEntries = useMemo(() => {
    const sorted = [...entries].sort((a, b) => b.votes - a.votes);
    if (viewFilter === "featured") return sorted.filter((e) => e.isFeatured);
    return sorted;
  }, [entries, viewFilter]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setShowLeftArrow(scrollLeft > 10);
    setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 10);
  };

  useEffect(() => {
    handleScroll();
  }, []);

  function scrollWeeks(direction: "left" | "right") {
    if (!scrollRef.current) return;
    const scrollAmount = 200;
    scrollRef.current.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  }

  function handleVote(entryId: string) {
    setEntries((prev) =>
      prev.map((e) =>
        e.id === entryId
          ? { ...e, votes: e.hasVoted ? e.votes - 1 : e.votes + 1, hasVoted: !e.hasVoted }
          : e
      )
    );
  }

  function handleSubmit(title: string, description: string, imageUrl: string, liveUrl?: string) {
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
      category: currentCategory,
    };
    setEntries((prev) => [newEntry, ...prev]);
    setShowSubmitModal(false);
  }

  const formatFullDate = (d: Date) => {
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 pt-6 pb-8">
          {/* ── Title ── */}
          <div className="flex items-center gap-3 mb-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white">
              <Trophy size={20} />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-foreground">
                Best of UX Community
              </h1>
              <p className="font-body text-sm text-foreground-muted">
                Week of {formatFullDate(currentWeek.startDate)}
              </p>
            </div>
          </div>

          {/* ── Tabs Row: Period tabs (left) + Filter tabs (right) ── */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-1">
              {(["weekly", "monthly", "yearly"] as TimePeriod[]).map((period) => (
                <button
                  key={period}
                  onClick={() => setTimePeriod(period)}
                  className={`px-3 py-1.5 font-body text-sm font-medium capitalize transition-colors border-b-2 ${
                    timePeriod === period
                      ? "text-accent border-accent"
                      : "text-foreground-muted border-transparent hover:text-foreground"
                  }`}
                >
                  {period}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 text-sm">
                <button
                  onClick={() => setViewFilter("featured")}
                  className={`font-body font-medium transition-colors ${
                    viewFilter === "featured" ? "text-accent" : "text-foreground-muted hover:text-foreground"
                  }`}
                >
                  Featured
                </button>
                <span className="text-foreground-muted/40">|</span>
                <button
                  onClick={() => setViewFilter("all")}
                  className={`font-body font-medium transition-colors ${
                    viewFilter === "all" ? "text-accent" : "text-foreground-muted hover:text-foreground"
                  }`}
                >
                  All
                </button>
              </div>
              <button
                onClick={() => setShowSubmitModal(true)}
                className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 font-body text-sm font-medium text-white hover:bg-accent/90 transition-colors"
              >
                <Plus size={14} />
                Submit
              </button>
            </div>
          </div>

          {/* ── Week Scrubber ── */}
          <div className="relative mb-6">
            {/* Left arrow */}
            {showLeftArrow && (
              <button
                onClick={() => scrollWeeks("left")}
                className="absolute left-0 top-1/2 -translate-y-1/2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-background border border-border shadow-md text-foreground-muted hover:text-foreground transition-colors -ml-1"
              >
                <ChevronLeft size={16} />
              </button>
            )}

            {/* Scrollable week list */}
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="flex gap-2 overflow-x-auto scrollbar-hide py-2 px-1"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              {WEEK_RANGES.map((week, i) => {
                const isActive = i === selectedWeek;
                return (
                  <button
                    key={i}
                    onClick={() => setSelectedWeek(i)}
                    className={`shrink-0 rounded-full px-4 py-2 font-body text-sm font-medium transition-all whitespace-nowrap ${
                      isActive
                        ? "bg-accent/10 border border-accent/30 text-accent"
                        : "border border-white/[0.06] text-foreground-muted hover:border-white/[0.12] hover:text-foreground"
                    }`}
                  >
                    {week.shortLabel}
                  </button>
                );
              })}
            </div>

            {/* Right arrow */}
            {showRightArrow && (
              <button
                onClick={() => scrollWeeks("right")}
                className="absolute right-0 top-1/2 -translate-y-1/2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-background border border-border shadow-md text-foreground-muted hover:text-foreground transition-colors -mr-1"
              >
                <ChevronRight size={16} />
              </button>
            )}
          </div>

          {/* ── Entries List ── */}
          <div>
            {filteredEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 rounded-xl border border-dashed border-white/[0.1]">
                <Trophy size={40} className="text-foreground-muted opacity-40 mb-3" />
                <p className="font-body text-sm text-foreground-muted mb-2">
                  {viewFilter === "featured" ? "No featured entries this week" : "No entries yet"}
                </p>
                <button onClick={() => setShowSubmitModal(true)} className="font-body text-sm text-accent hover:underline">
                  Be the first to submit
                </button>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {filteredEntries.map((entry, i) => (
                  <EntryRow key={entry.id} entry={entry} onVote={handleVote} rank={i + 1} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Submit Modal */}
      {showSubmitModal && (
        <SubmitEntryModal
          onClose={() => setShowSubmitModal(false)}
          onSubmit={handleSubmit}
          competitionTitle={`Best of UX Community — ${currentWeek.shortLabel}`}
        />
      )}
    </div>
  );
}
