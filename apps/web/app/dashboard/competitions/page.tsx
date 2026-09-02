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
  Calendar,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { SubmitEntryModal } from "@/components/competitions/SubmitEntryModal";

type Category = "visual" | "uiux" | "ai" | "portfolio";

interface Entry {
  id: string;
  title: string;
  description: string;
  authorName: string;
  imageUrl: string;
  liveUrl?: string;
  votes: number;
  hasVoted: boolean;
  category: Category;
}

interface WeekCompetition {
  weekNumber: number;
  category: Category;
  title: string;
  emoji: string;
  description: string;
  entries: Entry[];
  startDate: string;
  endDate: string;
  status: "active" | "ended";
}

const CATEGORIES: Record<Category, { label: string; emoji: string; icon: React.ReactNode; description: string }> = {
  visual: { label: "Best Visual Design", emoji: "🎨", icon: <Palette size={20} />, description: "Posters, branding, illustrations, graphics, social designs" },
  uiux: { label: "Best UI/UX Design", emoji: "🖥️", icon: <Monitor size={20} />, description: "Websites, apps, dashboards, landing pages, product concepts" },
  ai: { label: "Best AI Design", emoji: "🤖", icon: <Bot size={20} />, description: "AI-generated/AI-assisted visual & UI design projects" },
  portfolio: { label: "Best Portfolio", emoji: "👤", icon: <User size={20} />, description: "Personal design portfolios and showcases" },
};

const CATEGORY_ORDER: Category[] = ["visual", "uiux", "ai", "portfolio"];

// Mock: current active week
const CURRENT_WEEK = 36;
const CURRENT_CATEGORY: Category = "visual";

// Mock: past weeks data
const PAST_WEEKS: WeekCompetition[] = [
  {
    weekNumber: 11,
    category: "portfolio",
    title: "Best Portfolio",
    emoji: "👤",
    description: "Personal design portfolios and showcases",
    startDate: "Aug 18, 2026",
    endDate: "Aug 24, 2026",
    status: "ended",
    entries: [
      { id: "p1", title: "Minimal Portfolio", description: "Clean, typography-focused portfolio", authorName: "Ana Costa", imageUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=300&fit=crop", votes: 89, hasVoted: false, category: "portfolio" },
      { id: "p2", title: "Creative Agency Site", description: "Bold portfolio with immersive animations", authorName: "James Wu", imageUrl: "https://images.unsplash.com/photo-1467232004584-a241de8bcf5d?w=400&h=300&fit=crop", votes: 76, hasVoted: false, category: "portfolio" },
      { id: "p3", title: "Designer Showcase", description: "Interactive portfolio with case studies", authorName: "Kim Lee", imageUrl: "https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=400&h=300&fit=crop", votes: 64, hasVoted: false, category: "portfolio" },
    ],
  },
  {
    weekNumber: 10,
    category: "ai",
    title: "Best AI Design",
    emoji: "🤖",
    description: "AI-generated/AI-assisted visual & UI design projects",
    startDate: "Aug 11, 2026",
    endDate: "Aug 17, 2026",
    status: "ended",
    entries: [
      { id: "a1", title: "AI Art Collection", description: "Abstract artworks generated using Midjourney", authorName: "David Park", imageUrl: "https://images.unsplash.com/photo-1686191128892-3b3705bcf941?w=400&h=300&fit=crop", votes: 112, hasVoted: false, category: "ai" },
      { id: "a2", title: "AI-Assisted Branding", description: "Brand identity created with AI tools", authorName: "Lisa Chang", imageUrl: "https://images.unsplash.com/photo-1634986666676-ec8fd927c23d?w=400&h=300&fit=crop", votes: 95, hasVoted: false, category: "ai" },
      { id: "a3", title: "Generative Patterns", description: "Textile patterns generated with AI", authorName: "Tom Harris", imageUrl: "https://images.unsplash.com/photo-1558591710-4b4a1ae0f04d?w=400&h=300&fit=crop", votes: 83, hasVoted: false, category: "ai" },
    ],
  },
  {
    weekNumber: 9,
    category: "uiux",
    title: "Best UI/UX Design",
    emoji: "🖥️",
    description: "Websites, apps, dashboards, landing pages, product concepts",
    startDate: "Aug 4, 2026",
    endDate: "Aug 10, 2026",
    status: "ended",
    entries: [
      { id: "u1", title: "SaaS Dashboard", description: "Clean analytics dashboard with data viz", authorName: "Maya Patel", imageUrl: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=400&h=300&fit=crop", votes: 134, hasVoted: false, category: "uiux" },
      { id: "u2", title: "Fitness App", description: "Mobile app with gamification elements", authorName: "Chris Lee", imageUrl: "https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=400&h=300&fit=crop", votes: 118, hasVoted: false, category: "uiux" },
      { id: "u3", title: "E-commerce Landing", description: "Modern landing page with smooth animations", authorName: "Emma Wilson", imageUrl: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=400&h=300&fit=crop", votes: 102, hasVoted: false, category: "uiux" },
    ],
  },
];

// Mock: current week entries
const CURRENT_ENTRIES: Entry[] = [
  { id: "1", title: "Neon Brand Identity", description: "A vibrant brand identity system with neon colors and modern typography for a tech startup.", authorName: "Sarah Chen", imageUrl: "https://images.unsplash.com/photo-1561070791-2526d30994b5?w=400&h=300&fit=crop", liveUrl: "https://example.com", votes: 42, hasVoted: false, category: "visual" },
  { id: "2", title: "Minimalist Poster Series", description: "A series of minimalist posters exploring negative space and bold typography.", authorName: "Alex Rivera", imageUrl: "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=400&h=300&fit=crop", votes: 38, hasVoted: true, category: "visual" },
  { id: "3", title: "Retro Album Cover", description: "Vintage-inspired album cover design with bold colors and geometric shapes.", authorName: "Jordan Kim", imageUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&h=300&fit=crop", votes: 28, hasVoted: false, category: "visual" },
  { id: "4", title: "Eco Packaging Design", description: "Sustainable packaging design for an organic skincare brand.", authorName: "Emma Wilson", imageUrl: "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=400&h=300&fit=crop", votes: 25, hasVoted: false, category: "visual" },
  { id: "5", title: "Abstract Art Collection", description: "A collection of abstract digital art pieces exploring color and form.", authorName: "Chris Lee", imageUrl: "https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=400&h=300&fit=crop", votes: 22, hasVoted: false, category: "visual" },
];

function WinnerBadge({ rank }: { rank: number }) {
  const styles: Record<number, string> = {
    1: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    2: "bg-gray-300/10 text-gray-300 border-gray-400/20",
    3: "bg-amber-700/10 text-amber-600 border-amber-700/20",
  };
  const labels: Record<number, string> = { 1: "🥇 1st", 2: "🥈 2nd", 3: "🥉 3rd" };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-body text-[11px] font-semibold ${styles[rank]}`}>
      {labels[rank]}
    </span>
  );
}

function EntryCard({ entry, onVote, rank }: { entry: Entry; onVote: (id: string) => void; rank?: number }) {
  return (
    <div className="group flex flex-col rounded-xl border border-white/[0.08] bg-surface-raised overflow-hidden transition-all hover:border-white/[0.18] hover:shadow-lg">
      <div className="relative aspect-[4/3] overflow-hidden bg-surface">
        <img src={entry.imageUrl} alt={entry.title} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
        {rank !== undefined && <div className="absolute top-3 left-3"><WinnerBadge rank={rank} /></div>}
        {entry.liveUrl && (
          <a href={entry.liveUrl} target="_blank" rel="noopener noreferrer"
            className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm"
            onClick={(e) => e.stopPropagation()}>
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

function PastWinners({ week }: { week: WeekCompetition }) {
  const cat = CATEGORIES[week.category];
  const winners = [...week.entries].sort((a, b) => b.votes - a.votes).slice(0, 3);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-surface-raised/50 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">{week.emoji}</span>
        <div>
          <p className="font-display text-sm font-semibold text-foreground">Week {week.weekNumber}: {cat.label}</p>
          <p className="font-body text-[11px] text-foreground-muted">{week.startDate} — {week.endDate}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {winners.map((entry, i) => (
          <div key={entry.id} className="flex items-center gap-3 rounded-lg bg-surface px-3 py-2">
            <WinnerBadge rank={i + 1} />
            <div className="h-8 w-8 rounded-md overflow-hidden bg-surface-raised shrink-0">
              <img src={entry.imageUrl} alt="" className="h-full w-full object-cover" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-body text-xs font-medium text-foreground truncate">{entry.title}</p>
              <p className="font-body text-[10px] text-foreground-muted">{entry.authorName} · {entry.votes} votes</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CompetitionsPage() {
  const [entries, setEntries] = useState<Entry[]>(CURRENT_ENTRIES);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState(CURRENT_WEEK);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);

  const cat = CATEGORIES[CURRENT_CATEGORY];
  const sorted = [...entries].sort((a, b) => b.votes - a.votes);
  const totalVotes = entries.reduce((sum, e) => sum + e.votes, 0);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setShowLeftArrow(scrollLeft > 10);
    setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 10);
  };

  useEffect(() => { handleScroll(); }, []);

  function scrollWeeks(direction: "left" | "right") {
    if (!scrollRef.current) return;
    scrollRef.current.scrollBy({ left: direction === "left" ? -120 : 120, behavior: "smooth" });
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
      imageUrl,
      liveUrl,
      votes: 0,
      hasVoted: false,
      category: CURRENT_CATEGORY,
    };
    setEntries((prev) => [newEntry, ...prev]);
    setShowSubmitModal(false);
  }

  return (
    <div className="flex flex-col h-full relative overflow-hidden">
      {/* ── Floating decorative illustrations ── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        {/* Trophy */}
        <svg
          className="absolute"
          style={{
            width: "320px",
            height: "320px",
            left: "-5%",
            bottom: "-10%",
            opacity: 0,
            animation: "floatAcross 12s 0s ease-in-out infinite",
          }}
          viewBox="0 0 200 200"
          fill="none"
        >
          <path d="M100 20 C60 20 40 50 40 80 C40 110 60 130 80 140 L80 170 L120 170 L120 140 C140 130 160 110 160 80 C160 50 140 20 100 20Z" fill="var(--color-accent)" opacity="0.08"/>
          <rect x="75" y="170" width="50" height="10" rx="2" fill="var(--color-accent)" opacity="0.06"/>
          <rect x="65" y="178" width="70" height="8" rx="3" fill="var(--color-accent)" opacity="0.05"/>
        </svg>

        {/* Star / Sparkle */}
        <svg
          className="absolute"
          style={{
            width: "280px",
            height: "280px",
            right: "5%",
            top: "10%",
            opacity: 0,
            animation: "floatAcross 14s 2s ease-in-out infinite",
          }}
          viewBox="0 0 200 200"
          fill="none"
        >
          <path d="M100 10 L120 80 L190 80 L135 120 L155 190 L100 145 L45 190 L65 120 L10 80 L80 80Z" fill="var(--color-accent)" opacity="0.06"/>
        </svg>

        {/* Circle cluster */}
        <svg
          className="absolute"
          style={{
            width: "250px",
            height: "250px",
            left: "20%",
            top: "30%",
            opacity: 0,
            animation: "floatAcross 11s 4s ease-in-out infinite",
          }}
          viewBox="0 0 200 200"
          fill="none"
        >
          <circle cx="100" cy="100" r="60" stroke="var(--color-accent)" strokeWidth="3" opacity="0.06"/>
          <circle cx="100" cy="100" r="40" stroke="var(--color-accent)" strokeWidth="2" opacity="0.05"/>
          <circle cx="100" cy="100" r="20" fill="var(--color-accent)" opacity="0.04"/>
        </svg>

        {/* Diamond / Rhombus */}
        <svg
          className="absolute"
          style={{
            width: "200px",
            height: "200px",
            right: "15%",
            bottom: "5%",
            opacity: 0,
            animation: "floatAcross 13s 1s ease-in-out infinite",
          }}
          viewBox="0 0 200 200"
          fill="none"
        >
          <path d="M100 20 L180 100 L100 180 L20 100Z" fill="var(--color-accent)" opacity="0.05"/>
          <path d="M100 50 L150 100 L100 150 L50 100Z" stroke="var(--color-accent)" strokeWidth="2" opacity="0.06"/>
        </svg>

        {/* Hexagon */}
        <svg
          className="absolute"
          style={{
            width: "220px",
            height: "220px",
            left: "60%",
            top: "5%",
            opacity: 0,
            animation: "floatAcross 15s 3s ease-in-out infinite",
          }}
          viewBox="0 0 200 200"
          fill="none"
        >
          <path d="M100 10 L175 55 L175 145 L100 190 L25 145 L25 55Z" fill="var(--color-accent)" opacity="0.05"/>
        </svg>

        {/* Triangle */}
        <svg
          className="absolute"
          style={{
            width: "180px",
            height: "180px",
            left: "45%",
            bottom: "15%",
            opacity: 0,
            animation: "floatAcross 10s 5s ease-in-out infinite",
          }}
          viewBox="0 0 200 200"
          fill="none"
        >
          <path d="M100 20 L180 180 L20 180Z" fill="var(--color-accent)" opacity="0.05"/>
        </svg>
      </div>

      <div className="flex-1 overflow-y-auto relative z-10">
        {/* ── Title ── */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-3 mb-1">
            <Trophy size={24} className="text-accent" />
            <h1 className="font-display text-xl font-bold text-foreground">
              Design Competitions
            </h1>
          </div>
          <p className="font-body text-sm text-foreground-muted">
            Submit your work, vote for your favorites, and compete to be the best each week.
          </p>
        </div>

        {/* ── Week Scrubber ── */}
        <div className="px-6 pb-4">
          <div className="relative flex items-center">
            {showLeftArrow && (
              <button
                onClick={() => scrollWeeks("left")}
                className="absolute left-0 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-background text-foreground-muted hover:text-foreground transition-colors"
              >
                <ChevronLeft size={18} />
              </button>
            )}

            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="flex gap-3 overflow-x-auto mx-auto"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              {[34, 35, 36, 37, 38].map((week) => {
                const isActive = week === selectedWeek;
                const isFuture = week > CURRENT_WEEK;
                return (
                  <button
                    key={week}
                    onClick={() => !isFuture && setSelectedWeek(week)}
                    disabled={isFuture}
                    className={`shrink-0 rounded-full px-5 py-2 font-body text-sm font-semibold transition-all whitespace-nowrap ${
                      isActive
                        ? "bg-foreground text-background"
                        : isFuture
                        ? "text-foreground-muted/40 cursor-default"
                        : "text-foreground-muted hover:text-foreground"
                    }`}
                  >
                    Week {week}
                  </button>
                );
              })}
            </div>

            {showRightArrow && (
              <button
                onClick={() => scrollWeeks("right")}
                className="absolute right-0 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-background text-foreground-muted hover:text-foreground transition-colors"
              >
                <ChevronRight size={18} />
              </button>
            )}
          </div>
        </div>

        {/* ── Active Competition Hero ── */}
        <div className="px-6 pt-6 pb-6">
          <div className="rounded-2xl border border-white/[0.08] bg-surface-raised overflow-hidden">
            {/* Banner */}
            <div className="relative px-6 pt-6 pb-8 bg-gradient-to-br from-accent/20 via-accent/5 to-transparent">
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-body text-[11px] font-semibold text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Live Now
                </span>
                <span className="font-body text-xs text-foreground-muted">Week {CURRENT_WEEK}</span>
              </div>

              <div className="flex items-center gap-3 mb-2">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface text-foreground">
                  {cat.icon}
                </div>
                <div>
                  <h1 className="font-display text-xl font-semibold text-foreground">
                    {cat.emoji} {cat.label}
                  </h1>
                  <p className="font-body text-sm text-foreground-muted">{cat.description}</p>
                </div>
              </div>

              {/* Stats row */}
              <div className="flex items-center gap-5 mt-4">
                <div className="flex items-center gap-1.5">
                  <Users size={14} className="text-foreground-muted" />
                  <span className="font-body text-sm text-foreground-muted">{entries.length} entries</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Trophy size={14} className="text-foreground-muted" />
                  <span className="font-body text-sm text-foreground-muted">{totalVotes} votes</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock size={14} className="text-foreground-muted" />
                  <span className="font-body text-sm text-foreground-muted">Ends in 3 days</span>
                </div>
              </div>
            </div>

            {/* Submit CTA */}
            <div className="px-6 py-4 border-t border-white/[0.06] flex items-center justify-between">
              <p className="font-body text-sm text-foreground-muted">
                Submit your {cat.label.toLowerCase()} work before time runs out
              </p>
              <button
                onClick={() => setShowSubmitModal(true)}
                className="flex items-center gap-2 rounded-full bg-accent px-5 py-2 font-body text-sm font-medium text-white hover:bg-accent/90 transition-colors"
              >
                <Plus size={16} />
                Submit Entry
              </button>
            </div>
          </div>
        </div>

        {/* ── Entries Grid ── */}
        <div className="px-6 pb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-semibold text-foreground">
              All Entries
            </h2>
            <span className="font-body text-xs text-foreground-muted">Sorted by votes</span>
          </div>

          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 rounded-xl border border-dashed border-white/[0.1]">
              <Trophy size={40} className="text-foreground-muted opacity-40 mb-3" />
              <p className="font-body text-sm text-foreground-muted mb-2">No entries yet</p>
              <button onClick={() => setShowSubmitModal(true)} className="font-body text-sm text-accent hover:underline">
                Be the first to submit
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sorted.map((entry, i) => (
                <EntryCard key={entry.id} entry={entry} onVote={handleVote} rank={i < 3 ? i + 1 : undefined} />
              ))}
            </div>
          )}
        </div>

        {/* ── Past Winners ── */}
        <div className="px-6 pb-8">
          <div className="flex items-center gap-2 mb-4">
            <Calendar size={16} className="text-foreground-muted" />
            <h2 className="font-display text-base font-semibold text-foreground">Past Winners</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {PAST_WEEKS.map((week) => (
              <PastWinners key={week.weekNumber} week={week} />
            ))}
          </div>
        </div>
      </div>

      {/* Submit Modal */}
      {showSubmitModal && (
        <SubmitEntryModal
          onClose={() => setShowSubmitModal(false)}
          onSubmit={handleSubmit}
          competitionTitle={`${cat.emoji} ${cat.label} — Week ${CURRENT_WEEK}`}
        />
      )}
    </div>
  );
}
