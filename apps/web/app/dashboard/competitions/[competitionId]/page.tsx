"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Trophy,
  ArrowLeft,
  Clock,
  Users,
  ChevronUp,
  Medal,
  ExternalLink,
  Plus,
} from "lucide-react";
import { SubmitEntryModal } from "@/components/competitions/SubmitEntryModal";

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
}

interface CompetitionData {
  id: string;
  title: string;
  emoji: string;
  description: string;
  deadline: string;
  totalVotes: number;
  totalEntries: number;
}

const COMPETITIONS_DATA: Record<string, CompetitionData> = {
  "best-visual-design": {
    id: "best-visual-design",
    title: "Best Visual Design",
    emoji: "🎨",
    description: "Posters, branding, illustrations, graphics, social designs",
    deadline: "Sep 30, 2026",
    totalVotes: 156,
    totalEntries: 24,
  },
  "best-uiux-design": {
    id: "best-uiux-design",
    title: "Best UI/UX Design",
    emoji: "🖥️",
    description: "Websites, apps, dashboards, landing pages, product concepts",
    deadline: "Sep 30, 2026",
    totalVotes: 132,
    totalEntries: 18,
  },
  "best-ai-design": {
    id: "best-ai-design",
    title: "Best AI Design",
    emoji: "🤖",
    description: "AI-generated/AI-assisted visual & UI design projects",
    deadline: "Sep 30, 2026",
    totalVotes: 203,
    totalEntries: 31,
  },
  "best-portfolio": {
    id: "best-portfolio",
    title: "Best Portfolio",
    emoji: "👤",
    description: "Personal design portfolios and showcases",
    deadline: "Sep 30, 2026",
    totalVotes: 98,
    totalEntries: 15,
  },
};

const MOCK_ENTRIES: Entry[] = [
  {
    id: "1",
    title: "Neon Brand Identity",
    description: "A vibrant brand identity system with neon colors and modern typography for a tech startup.",
    authorName: "Sarah Chen",
    authorAvatar: null,
    imageUrl: "https://images.unsplash.com/photo-1561070791-2526d30994b5?w=400&h=300&fit=crop",
    liveUrl: "https://example.com",
    votes: 42,
    hasVoted: false,
    submittedAt: "2 days ago",
  },
  {
    id: "2",
    title: "Minimalist Poster Series",
    description: "A series of minimalist posters exploring negative space and bold typography.",
    authorName: "Alex Rivera",
    authorAvatar: null,
    imageUrl: "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=400&h=300&fit=crop",
    votes: 38,
    hasVoted: true,
    submittedAt: "3 days ago",
  },
  {
    id: "3",
    title: "Social Media Campaign",
    description: "Complete social media design package for a fitness brand launch.",
    authorName: "Maya Patel",
    authorAvatar: null,
    imageUrl: "https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=400&h=300&fit=crop",
    votes: 35,
    hasVoted: false,
    submittedAt: "4 days ago",
  },
  {
    id: "4",
    title: "Retro Album Cover",
    description: "Vintage-inspired album cover design with bold colors and geometric shapes.",
    authorName: "Jordan Kim",
    authorAvatar: null,
    imageUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&h=300&fit=crop",
    votes: 28,
    hasVoted: false,
    submittedAt: "5 days ago",
  },
  {
    id: "5",
    title: "Eco-Friendly Packaging",
    description: "Sustainable packaging design for an organic skincare brand.",
    authorName: "Emma Wilson",
    authorAvatar: null,
    imageUrl: "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=400&h=300&fit=crop",
    votes: 25,
    hasVoted: false,
    submittedAt: "6 days ago",
  },
  {
    id: "6",
    title: "Abstract Art Collection",
    description: "A collection of abstract digital art pieces exploring color and form.",
    authorName: "Chris Lee",
    authorAvatar: null,
    imageUrl: "https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=400&h=300&fit=crop",
    votes: 22,
    hasVoted: false,
    submittedAt: "1 week ago",
  },
];

function WinnerBadge({ rank }: { rank: number }) {
  const colors = {
    1: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    2: "bg-gray-300/10 text-gray-300 border-gray-400/20",
    3: "bg-amber-700/10 text-amber-600 border-amber-700/20",
  };
  const labels = { 1: "🥇 1st", 2: "🥈 2nd", 3: "🥉 3rd" };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-body text-[10px] font-semibold ${colors[rank as keyof typeof colors]}`}
    >
      {labels[rank as keyof typeof labels]}
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
      {/* Image */}
      <div className="relative aspect-[4/3] overflow-hidden bg-surface">
        <img
          src={entry.imageUrl}
          alt={entry.title}
          className="h-full w-full object-cover transition-transform group-hover:scale-105"
        />
        {rank !== undefined && (
          <div className="absolute top-3 left-3">
            <WinnerBadge rank={rank} />
          </div>
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

      {/* Content */}
      <div className="flex flex-col flex-1 p-4">
        <h3 className="font-display text-sm font-semibold text-foreground mb-1 line-clamp-1">
          {entry.title}
        </h3>
        <p className="font-body text-xs text-foreground-muted leading-relaxed mb-3 flex-1 line-clamp-2">
          {entry.description}
        </p>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-white/[0.06]">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-full bg-surface flex items-center justify-center text-[10px] font-semibold text-foreground-muted">
              {entry.authorName.charAt(0)}
            </div>
            <span className="font-body text-xs text-foreground-muted">
              {entry.authorName}
            </span>
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

export default function CompetitionDetailPage() {
  const params = useParams();
  const competitionId = params.competitionId as string;
  const competition = COMPETITIONS_DATA[competitionId];

  const [entries, setEntries] = useState<Entry[]>(MOCK_ENTRIES);
  const [showSubmitModal, setShowSubmitModal] = useState(false);

  const sortedEntries = [...entries].sort((a, b) => b.votes - a.votes);
  const top3 = sortedEntries.slice(0, 3);
  const rest = sortedEntries.slice(3);

  function handleVote(entryId: string) {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== entryId) return e;
        return {
          ...e,
          votes: e.hasVoted ? e.votes - 1 : e.votes + 1,
          hasVoted: !e.hasVoted,
        };
      })
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
      submittedAt: "Just now",
    };
    setEntries((prev) => [newEntry, ...prev]);
    setShowSubmitModal(false);
  }

  if (!competition) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <Trophy size={48} className="text-foreground-muted opacity-40" />
        <div>
          <h1 className="font-body text-xl font-semibold text-foreground">
            Competition not found
          </h1>
          <Link
            href="/dashboard/competitions"
            className="mt-2 inline-flex items-center gap-1 font-body text-sm text-accent hover:underline"
          >
            <ArrowLeft size={14} />
            Back to competitions
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 shrink-0">
        <Link
          href="/dashboard/competitions"
          className="inline-flex items-center gap-1.5 font-body text-xs text-foreground-muted hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft size={14} />
          Back to competitions
        </Link>

        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="font-display text-xl font-semibold text-foreground mb-1">
              {competition.emoji} {competition.title}
            </h1>
            <p className="font-body text-sm text-foreground-muted">
              {competition.description}
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
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-foreground-muted" />
            <span className="font-body text-sm text-foreground-muted">
              {entries.length} entries
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Trophy size={16} className="text-foreground-muted" />
            <span className="font-body text-sm text-foreground-muted">
              {entries.reduce((sum, e) => sum + e.votes, 0)} votes
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-foreground-muted" />
            <span className="font-body text-sm text-foreground-muted">
              Ends {competition.deadline}
            </span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {/* Top 3 Winners */}
        {top3.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Medal size={18} className="text-yellow-400" />
              <h2 className="font-display text-sm font-semibold text-foreground">
                Top Entries
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {top3.map((entry, index) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  onVote={handleVote}
                  rank={index + 1}
                />
              ))}
            </div>
          </section>
        )}

        {/* All Entries */}
        <section>
          <h2 className="font-display text-sm font-semibold text-foreground mb-4">
            All Entries
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {rest.map((entry) => (
              <EntryCard key={entry.id} entry={entry} onVote={handleVote} />
            ))}
          </div>
        </section>
      </div>

      {/* Submit Modal */}
      {showSubmitModal && (
        <SubmitEntryModal
          onClose={() => setShowSubmitModal(false)}
          onSubmit={handleSubmit}
          competitionTitle={competition.title}
        />
      )}
    </div>
  );
}
