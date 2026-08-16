"use client";

import Link from "next/link";
import { Swords } from "lucide-react";

export function DesignDuelPromo() {
  return (
    <Link
      href="/dashboard/design-duel"
      className="mt-4 block rounded-2xl border border-accent/20 bg-gradient-to-br from-accent/10 to-surface-raised p-4 transition-colors hover:border-accent/50"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent text-white">
          <Swords size={16} />
        </span>
        <p className="font-display text-sm font-semibold text-foreground">Design Duel</p>
      </div>
      <p className="mt-2 font-body text-xs leading-5 text-foreground-muted">
        Fix a broken UI in 5 minutes, duel another designer, and let the community vote.
        Climb the leaderboard and earn XP.
      </p>
      <span className="mt-3 inline-flex items-center gap-1 font-body text-xs font-bold text-accent">
        Play now →
      </span>
    </Link>
  );
}