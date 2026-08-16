"use client";

import Link from "next/link";
import {
  Award,
  Flame,
  Gauge,
  Swords,
  Timer,
  Trophy,
} from "lucide-react";
import type { DuelChallenge, DuelStats, DuelView } from "@/lib/design-duel/types";
import { DesignPreview } from "./DesignPreview";
import { Leaderboard } from "./Leaderboard";
import type { DuelLeaderboardEntry } from "@/lib/design-duel/types";

interface DesignDuelHomeProps {
  challenges: DuelChallenge[];
  stats: DuelStats | null;
  openDuels: DuelView[];
  myDuels: DuelView[];
  leaderboard: { entries: DuelLeaderboardEntry[]; myRank: number | null; total: number };
  userId: string;
}

const DIFFICULTY_STYLES: Record<string, string> = {
  easy: "bg-emerald-100 text-emerald-700",
  medium: "bg-amber-100 text-amber-700",
  hard: "bg-rose-100 text-rose-700",
};

export function DesignDuelHome({
  challenges,
  stats,
  openDuels,
  myDuels,
  leaderboard,
  userId,
}: DesignDuelHomeProps) {
  const featured = challenges.find((challenge) => challenge.featured) ?? challenges[0];
  const rest = challenges.filter((challenge) => challenge.id !== featured?.id);
  const voteableDuels = openDuels.filter((duel) => !duel.i_am_participant);

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 md:px-8">
      {/* Hero */}
      <header className="rounded-3xl border border-border bg-gradient-to-br from-accent/10 via-surface-raised to-surface-raised p-6 md:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-3 py-1 font-body text-xs font-bold text-accent">
            <Swords size={14} />
            Competitive design
          </span>
        </div>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          Design Duel
        </h1>
        <p className="mt-2 max-w-xl font-body text-sm leading-6 text-foreground-muted">
          Fix a broken UI under a 5-minute timer, get paired against another
          designer, and let the community pick the winner. Climb the Elo
          leaderboard and earn XP.
        </p>

        {stats && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatCard label="Rating" value={String(stats.rating)} icon={<Gauge size={16} />} />
            <StatCard
              label="Rank"
              value={stats.rank ? `#${stats.rank}` : "—"}
              icon={<Trophy size={16} />}
            />
            <StatCard label="XP" value={stats.xp.toLocaleString()} icon={<Award size={16} />} />
            <StatCard label="Wins" value={String(stats.wins)} icon={<Swords size={16} />} />
            <StatCard
              label="Streak"
              value={stats.win_streak > 0 ? `${stats.win_streak}🔥` : "—"}
              icon={<Flame size={16} />}
            />
          </div>
        )}
      </header>

      {/* Featured challenge */}
      {featured && (
        <section className="mt-10">
          <div className="flex items-center gap-2">
            <Timer size={16} className="text-accent" />
            <h2 className="font-display text-lg font-semibold text-foreground">Today&apos;s duel</h2>
          </div>
          <ChallengeCard challenge={featured} featured />
        </section>
      )}

      {/* Vote now */}
      {voteableDuels.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-lg font-semibold text-foreground">Vote now</h2>
          <p className="mt-1 font-body text-xs text-foreground-subtle">
            Anonymous head-to-heads waiting for your pick.
          </p>
          <ul className="mt-4 grid gap-4 md:grid-cols-2">
            {voteableDuels.map((duel) => (
              <li key={duel.id}>
                <Link
                  href={`/dashboard/design-duel/duels/${duel.id}`}
                  className="block rounded-2xl border border-border bg-surface-raised p-4 transition-colors hover:border-accent/50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate font-body text-sm font-semibold text-foreground">
                      {duel.challenge_title}
                    </p>
                    <span className="shrink-0 font-body text-[11px] text-foreground-subtle">
                      {duel.vote_count}/{duel.min_votes} votes
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <DesignPreview design={duel.design_a.design_json} imageUrl={duel.design_a.preview_image} className="rounded-lg border border-border" />
                    <DesignPreview design={duel.design_b.design_json} imageUrl={duel.design_b.preview_image} className="rounded-lg border border-border" />
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="font-body text-xs text-foreground-subtle">Design A vs Design B</span>
                    <span className="font-body text-xs font-bold text-accent">Vote →</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* My duels */}
      {myDuels.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-lg font-semibold text-foreground">Your duels</h2>
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {myDuels.map((duel) => (
              <li key={duel.id}>
                <Link
                  href={`/dashboard/design-duel/duels/${duel.id}`}
                  className="flex items-center gap-4 rounded-2xl border border-border bg-surface-raised p-4 transition-colors hover:border-accent/50"
                >
                  <DesignPreview design={duel.design_a.design_json} imageUrl={duel.design_a.preview_image} className="w-20 shrink-0 rounded-lg border border-border" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-body text-sm font-semibold text-foreground">{duel.challenge_title}</p>
                    <p className="mt-0.5 font-body text-xs text-foreground-subtle">
                      {duel.status === "resolved"
                        ? duel.design_a.is_winner
                          ? "You won this duel"
                          : duel.design_b.is_winner
                            ? "You lost this duel"
                            : "Draw"
                        : `Open · ${duel.vote_count}/${duel.min_votes} votes`}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 font-body text-[11px] font-bold ${
                      duel.status === "resolved"
                        ? duel.design_a.is_winner || duel.design_b.is_winner
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-600"
                        : "bg-accent/10 text-accent"
                    }`}
                  >
                    {duel.status === "resolved" ? "Result" : "Open"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Leaderboard */}
      <section className="mt-10">
        <Leaderboard
          initialEntries={leaderboard.entries}
          initialMyRank={leaderboard.myRank}
          initialTotal={leaderboard.total}
          userId={userId}
        />
      </section>

      {/* All challenges */}
      <section className="mt-10">
        <h2 className="font-display text-lg font-semibold text-foreground">All challenges</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {rest.map((challenge) => (
            <ChallengeCard key={challenge.id} challenge={challenge} />
          ))}
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-3">
      <div className="flex items-center gap-1.5 font-body text-[11px] font-medium text-foreground-subtle">
        {icon}
        {label}
      </div>
      <p className="mt-1 font-display text-xl font-bold text-foreground">{value}</p>
    </div>
  );
}

function ChallengeCard({
  challenge,
  featured = false,
}: {
  challenge: DuelChallenge;
  featured?: boolean;
}) {
  const buttonLabel =
    challenge.my_status === "submitted"
      ? "View your duel"
      : challenge.my_status === "in_progress"
        ? "Resume"
        : "Play";
  const href =
    challenge.my_status === "submitted"
      ? "/dashboard/design-duel"
      : `/dashboard/design-duel/challenges/${challenge.id}`;

  return (
    <Link
      href={href}
      className={`block rounded-2xl border border-border bg-surface-raised p-5 transition-colors hover:border-accent/50 ${
        featured ? "md:grid md:grid-cols-[1fr_220px] md:gap-6" : ""
      }`}
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-0.5 font-body text-[11px] font-bold ${
              DIFFICULTY_STYLES[challenge.difficulty] ?? "bg-slate-100 text-slate-600"
            }`}
          >
            {challenge.difficulty}
          </span>
          {challenge.my_status === "submitted" && (
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-body text-[11px] font-bold text-emerald-700">
              Played
            </span>
          )}
          {challenge.my_status === "in_progress" && (
            <span className="rounded-full bg-accent/10 px-2.5 py-0.5 font-body text-[11px] font-bold text-accent">
              In progress
            </span>
          )}
        </div>
        <h3 className="mt-2 font-display text-lg font-semibold text-foreground">{challenge.title}</h3>
        <p className="mt-1 line-clamp-2 font-body text-sm leading-6 text-foreground-muted">
          {challenge.description}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-body text-xs text-foreground-subtle">
          <span className="inline-flex items-center gap-1">
            <Timer size={13} />
            {Math.round(challenge.time_limit_seconds / 60)} min
          </span>
          <span>{challenge.submission_count} played</span>
          <span>{challenge.duel_count} duels</span>
        </div>
        <button
          type="button"
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 font-body text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          <Swords size={15} />
          {buttonLabel}
        </button>
      </div>
      {featured && (
        <div className="mt-5 md:mt-0">
          <DesignPreview
            design={challenge.starting_design}
            className="rounded-xl border border-border"
          />
          <p className="mt-2 text-center font-body text-[11px] text-foreground-subtle">
            Starting layout — make it better
          </p>
        </div>
      )}
    </Link>
  );
}