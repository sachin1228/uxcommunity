"use client";

import { useCallback, useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import type { DuelLeaderboardEntry } from "@/lib/design-duel/types";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { Spinner } from "@/components/ui/Spinner";

type Period = "weekly" | "all";

interface LeaderboardProps {
  initialEntries: DuelLeaderboardEntry[];
  initialMyRank: number | null;
  initialTotal: number;
  userId: string;
}

const MEDALS = ["bg-amber-100 text-amber-700", "bg-slate-100 text-slate-600", "bg-orange-100 text-orange-700"];

export function Leaderboard({
  initialEntries,
  initialMyRank,
  initialTotal,
  userId,
}: LeaderboardProps) {
  const [period, setPeriod] = useState<Period>("weekly");
  const [entries, setEntries] = useState(initialEntries);
  const [myRank, setMyRank] = useState(initialMyRank);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/design-duel/leaderboard?period=${period}&limit=10`);
        const data = (await response.json()) as {
          entries?: DuelLeaderboardEntry[];
          myRank?: number | null;
          total?: number;
        };
        if (cancelled) return;
        setEntries(data.entries ?? []);
        setMyRank(data.myRank ?? null);
        setTotal(data.total ?? 0);
      } catch {
        // keep previous data on failure
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [period]);

  const renderRow = useCallback(
    (entry: DuelLeaderboardEntry) => {
      const medal = entry.rank >= 1 && entry.rank <= 3 ? MEDALS[entry.rank - 1] : null;
      return (
        <li
          key={`${entry.rank}-${entry.user_id}`}
          className={`flex items-center gap-3 px-3 py-2.5 ${
            entry.is_me ? "rounded-lg bg-accent/10" : ""
          }`}
        >
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-body text-xs font-bold ${
              medal ?? "bg-surface-raised text-foreground-muted"
            }`}
          >
            {entry.rank}
          </span>
          <AvatarImg url={entry.avatar_url} name={entry.name} size={32} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-body text-sm font-semibold text-foreground">
              {entry.name}
              {entry.is_me && (
                <span className="ml-1.5 font-body text-[10px] font-semibold text-accent">you</span>
              )}
            </p>
            <p className="font-body text-[11px] text-foreground-subtle">
              {entry.wins}W · {entry.duels_played} duels
              {entry.win_streak > 0 ? ` · 🔥${entry.win_streak}` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="font-body text-sm font-bold text-foreground">{entry.rating}</p>
            <p className="font-body text-[10px] text-foreground-subtle">
              {entry.xp.toLocaleString()} XP
            </p>
          </div>
        </li>
      );
    },
    [],
  );

  const myEntry = entries.find((entry) => entry.is_me && entry.my_rank_offset);

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Trophy size={16} className="text-accent" />
          <h3 className="font-display text-base font-semibold text-foreground">Leaderboard</h3>
        </div>
        <div className="flex rounded-lg border border-border p-0.5">
          {(["weekly", "all"] as Period[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setPeriod(option)}
              className={`rounded-md px-2.5 py-1 font-body text-xs font-semibold transition-colors ${
                period === option
                  ? "bg-accent text-white"
                  : "text-foreground-muted hover:text-foreground"
              }`}
            >
              {option === "weekly" ? "Weekly" : "All time"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner size={20} className="text-foreground-muted" />
        </div>
      ) : (
        <ul className="mt-3 space-y-0.5">
          {entries.map((entry) => renderRow(entry))}
          {myEntry && <div className="border-t border-border/60 pt-1">{renderRow(myEntry)}</div>}
        </ul>
      )}

      {myRank != null && (
        <p className="mt-3 border-t border-border/60 pt-3 text-center font-body text-[11px] text-foreground-subtle">
          You are #{myRank} of {total} designers this {period === "weekly" ? "week" : "period"}
        </p>
      )}
      {userId && myRank == null && (
        <p className="mt-3 border-t border-border/60 pt-3 text-center font-body text-[11px] text-foreground-subtle">
          Play your first duel to get rated.
        </p>
      )}
    </div>
  );
}