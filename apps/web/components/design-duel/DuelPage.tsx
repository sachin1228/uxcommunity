"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Swords, Trophy, Users } from "lucide-react";
import type { DuelView } from "@/lib/design-duel/types";
import { VOTE_REASONS } from "@/lib/design-duel/types";
import { DesignPreview } from "./DesignPreview";
import { Spinner } from "@/components/ui/Spinner";
import { usePendingMutation } from "@/lib/use-mutation";

interface DuelPageProps {
  initialDuel: DuelView;
}

export function DuelPage({ initialDuel }: DuelPageProps) {
  const router = useRouter();
  const [duel, setDuel] = useState(initialDuel);
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);

  const castVote = useCallback(async () => {
    if (!selected) return;
    setVoteError(null);
    const response = await fetch(`/api/design-duel/duels/${duel.id}/vote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selected_submission_id: selected, reason }),
    });
    const data = (await response.json()) as { error?: string; duel?: DuelView };
    if (!response.ok) {
      setVoteError(data.error ?? "Could not record your vote.");
      return;
    }
    if (data.duel) setDuel(data.duel);
  }, [duel.id, selected, reason]);

  const { pending, run } = usePendingMutation(castVote);

  // Refresh open duels periodically so counts stay live and results appear.
  useEffect(() => {
    if (duel.status !== "open") return;
    let cancelled = false;
    const interval = window.setInterval(() => {
      fetch(`/api/design-duel/duels/${duel.id}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { duel?: DuelView } | null) => {
          if (!cancelled && data?.duel) setDuel(data.duel);
        })
        .catch(() => undefined);
    }, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [duel.id, duel.status]);

  const showVoteUI = !duel.revealed && !duel.i_am_participant;
  const showLiveUI = !duel.revealed && duel.i_am_participant;

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-8 md:px-8">
      <button
        type="button"
        onClick={() => router.back()}
        className="mb-6 inline-flex items-center gap-1.5 font-body text-sm text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft size={16} /> Back
      </button>

      <header className="flex flex-wrap items-center gap-3">
        <div>
          <p className="font-body text-[11px] font-semibold uppercase tracking-widest text-accent">
            Design Duel
          </p>
          <h1 className="mt-0.5 font-display text-2xl font-bold tracking-tight text-foreground">
            {duel.challenge_title}
          </h1>
        </div>
        <span
          className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-body text-xs font-bold ${
            duel.status === "resolved" ? "bg-slate-100 text-slate-600" : "bg-accent/10 text-accent"
          }`}
        >
          {duel.status === "resolved" ? "Resolved" : "Vote open"}
        </span>
      </header>

      <div className="mt-4 flex items-center gap-4 font-body text-xs text-foreground-subtle">
        <span className="inline-flex items-center gap-1.5">
          <Users size={14} />
          {duel.vote_count} votes · {duel.min_votes} to settle
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Swords size={14} />
          {duel.revealed ? "Identities revealed" : "Anonymous"}
        </span>
      </div>

      {/* ── Voting UI ─────────────────────────────────────────────────────── */}
      {showVoteUI && (
        <div className="mt-6">
          <p className="font-body text-sm font-medium text-foreground">
            Which design wins the duel? Pick the one you&apos;d ship.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <VoteCard
              label="Design A"
              view={duel.design_a}
              selected={selected === duel.design_a.submission_id}
              onSelect={() => setSelected(duel.design_a.submission_id)}
            />
            <VoteCard
              label="Design B"
              view={duel.design_b}
              selected={selected === duel.design_b.submission_id}
              onSelect={() => setSelected(duel.design_b.submission_id)}
            />
          </div>

          {selected && (
            <div className="mt-6 rounded-2xl border border-border bg-surface-raised p-5">
              <p className="font-body text-sm font-semibold text-foreground">
                Why did this one win your vote?
              </p>
              <p className="mt-0.5 font-body text-xs text-foreground-subtle">
                Optional — helps designers learn.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {VOTE_REASONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setReason(reason === option.value ? null : option.value)}
                    className={`rounded-full px-3 py-1.5 font-body text-xs font-semibold transition-colors ${
                      reason === option.value
                        ? "bg-accent text-white"
                        : "border border-border text-foreground-muted hover:border-accent hover:text-foreground"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {voteError && (
                <p className="mt-3 font-body text-xs font-medium text-red-500">{voteError}</p>
              )}
              <button
                type="button"
                onClick={() => void run()}
                disabled={pending}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-body text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? <Spinner size={16} className="text-white" /> : <Swords size={16} />}
                {pending ? "Voting…" : "Submit vote"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Participant live status ───────────────────────────────────────── */}
      {showLiveUI && (
        <div className="mt-6 rounded-2xl border border-border bg-surface-raised p-6 text-center">
          <Swords size={28} className="mx-auto text-accent" />
          <h2 className="mt-3 font-display text-lg font-semibold text-foreground">
            Your duel is live
          </h2>
          <p className="mx-auto mt-1 max-w-md font-body text-sm text-foreground-muted">
            Anonymous designers are voting on your design vs. your opponent&apos;s.
            {duel.vote_count < duel.min_votes
              ? ` ${duel.min_votes - duel.vote_count} more vote${duel.min_votes - duel.vote_count === 1 ? "" : "s"} needed to settle it.`
              : " Enough votes have come in — the result will appear shortly."}
          </p>
          <div className="mx-auto mt-4 h-2 w-full max-w-sm overflow-hidden rounded-full bg-surface">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${Math.min(100, (duel.vote_count / duel.min_votes) * 100)}%` }}
            />
          </div>
          <p className="mt-2 font-body text-xs text-foreground-subtle">
            {duel.vote_count}/{duel.min_votes} votes
          </p>
        </div>
      )}

      {/* ── Revealed result ───────────────────────────────────────────────── */}
      {duel.revealed && (
        <div className="mt-6">
          <div className="grid gap-4 md:grid-cols-2">
            <ResultCard
              view={duel.design_a}
              title={duel.design_a.name ?? "Design A"}
              subtitle={duel.design_a.rating != null ? `Rating ${duel.design_a.rating}` : undefined}
              winner={duel.design_a.is_winner}
            />
            <ResultCard
              view={duel.design_b}
              title={duel.design_b.name ?? "Design B"}
              subtitle={duel.design_b.rating != null ? `Rating ${duel.design_b.rating}` : undefined}
              winner={duel.design_b.is_winner}
            />
          </div>

          {duel.i_am_participant && (
            <div
              className={`mt-6 rounded-2xl border p-5 text-center ${
                duel.design_a.is_winner || duel.design_b.is_winner
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-border bg-surface-raised"
              }`}
            >
              <Trophy size={24} className="mx-auto text-emerald-600" />
              <p className="mt-2 font-display text-lg font-semibold text-foreground">
                {(duel.design_a.is_winner || duel.design_b.is_winner) ? "You won this duel!" : "It was a draw"}
              </p>
              <p className="mt-1 font-body text-xs text-foreground-muted">
                {duel.vote_count} votes counted · rating updated
              </p>
              <button
                type="button"
                onClick={() => router.push("/dashboard/design-duel")}
                className="mt-4 rounded-xl bg-accent px-5 py-2.5 font-body text-sm font-semibold text-white hover:opacity-90"
              >
                Back to Design Duel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function VoteCard({
  label,
  view,
  selected,
  onSelect,
}: {
  label: string;
  view: DuelView["design_a"];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`overflow-hidden rounded-2xl border bg-surface-raised text-left transition-all ${
        selected ? "border-accent ring-2 ring-accent/30" : "border-border hover:border-accent/50"
      }`}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <span className="font-body text-sm font-semibold text-foreground">{label}</span>
        {selected && (
          <span className="rounded-full bg-accent px-2.5 py-0.5 font-body text-[11px] font-bold text-white">
            Selected
          </span>
        )}
      </div>
      <DesignPreview design={view.design_json} imageUrl={view.preview_image} className="max-h-[420px]" />
    </button>
  );
}

function ResultCard({
  view,
  title,
  subtitle,
  winner,
}: {
  view: DuelView["design_a"];
  title: string;
  subtitle?: string;
  winner: boolean;
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border bg-surface-raised ${
        winner ? "border-emerald-300 ring-1 ring-emerald-200" : "border-border opacity-90"
      }`}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <p className="font-body text-sm font-semibold text-foreground">{title}</p>
          {subtitle && <p className="font-body text-[11px] text-foreground-subtle">{subtitle}</p>}
        </div>
        {winner ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 font-body text-[11px] font-bold text-emerald-700">
            <Trophy size={12} /> Winner
          </span>
        ) : (
          <span className="font-body text-[11px] text-foreground-subtle">Runner-up</span>
        )}
      </div>
      <DesignPreview design={view.design_json} imageUrl={view.preview_image} className="max-h-[420px]" />
      {view.percent != null && (
        <div className="px-4 py-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface">
            <div
              className={`h-full rounded-full ${winner ? "bg-emerald-500" : "bg-foreground-subtle/50"}`}
              style={{ width: `${view.percent}%` }}
            />
          </div>
          <p className="mt-1.5 text-right font-body text-sm font-bold text-foreground">
            {view.percent}%
          </p>
        </div>
      )}
    </div>
  );
}