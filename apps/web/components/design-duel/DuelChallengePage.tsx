"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Swords, Timer } from "lucide-react";
import type { DuelChallenge, DuelDesign, DuelView } from "@/lib/design-duel/types";
import { DesignPreview } from "./DesignPreview";
import { DuelEditor } from "./DuelEditor";
import { Spinner } from "@/components/ui/Spinner";
import { usePendingMutation } from "@/lib/use-mutation";

interface DuelChallengePageProps {
  challenge: DuelChallenge;
  submission: {
    id: string;
    status: "in_progress" | "submitted";
    started_at: string;
    design_json: DuelDesign | null;
  } | null;
  myDuel: DuelView | null;
}

type Phase = "intro" | "editor" | "waiting" | "duel";

const POLL_MS = 4000;
const WAIT_TIMEOUT_MS = 75_000;

export function DuelChallengePage({ challenge, submission, myDuel }: DuelChallengePageProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(
    myDuel ? "duel" : submission?.status === "submitted" ? "waiting" : submission ? "editor" : "intro",
  );
  const [submissionId, setSubmissionId] = useState<string | null>(submission?.id ?? null);
  const [deadline, setDeadline] = useState<string | null>(
    submission
      ? new Date(Date.parse(submission.started_at) + challenge.time_limit_seconds * 1000).toISOString()
      : null,
  );
  const [startError, setStartError] = useState<string | null>(null);
  const [waitingFor, setWaitingFor] = useState(false);

  const start = useCallback(async () => {
    setStartError(null);
    const response = await fetch(`/api/design-duel/challenges/${challenge.id}/start`, {
      method: "POST",
    });
    const data = (await response.json()) as {
      submission?: { id: string };
      deadline?: string;
      error?: string;
    };
    if (!response.ok || !data.submission) {
      setStartError(data.error ?? "Could not start the challenge.");
      return;
    }
    setSubmissionId(data.submission.id);
    setDeadline(data.deadline ?? null);
    setPhase("editor");
  }, [challenge.id]);

  const { pending, run } = usePendingMutation(start);

  const handleSubmitted = useCallback((duelId: string | null) => {
    if (duelId) {
      router.push(`/dashboard/design-duel/duels/${duelId}`);
      return;
    }
    setPhase("waiting");
    setWaitingFor(true);
  }, [router]);

  // Poll for the opponent while waiting for a duel to form.
  useEffect(() => {
    if (phase !== "waiting" || !submissionId) return;
    let cancelled = false;
    const startedAt = Date.now();
    const check = async () => {
      try {
        const response = await fetch(`/api/design-duel/challenges/${challenge.id}`);
        const data = (await response.json()) as { myDuel?: DuelView | null };
        if (!cancelled && data.myDuel) {
          setWaitingFor(false);
          router.push(`/dashboard/design-duel/duels/${data.myDuel.id}`);
          return;
        }
      } catch {
        // retry on next tick
      }
      if (!cancelled && Date.now() - startedAt >= WAIT_TIMEOUT_MS) {
        setWaitingFor(false);
      }
    };
    void check();
    const interval = window.setInterval(() => void check(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [phase, submissionId, challenge.id, router]);

  // ── Intro ────────────────────────────────────────────────────────────────
  if (phase === "intro") {
    return (
      <div className="mx-auto w-full max-w-4xl px-5 py-8 md:px-8">
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-6 inline-flex items-center gap-1.5 font-body text-sm text-foreground-muted hover:text-foreground"
        >
          <ArrowLeft size={16} /> Back to Design Duel
        </button>

        <div className="grid gap-6 md:grid-cols-[1fr_300px]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-accent/10 px-3 py-1 font-body text-xs font-bold text-accent capitalize">
                {challenge.difficulty} challenge
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-raised px-3 py-1 font-body text-xs font-semibold text-foreground">
                <Timer size={13} />
                {Math.round(challenge.time_limit_seconds / 60)} minutes
              </span>
            </div>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground">
              {challenge.title}
            </h1>
            <p className="mt-2 font-body text-sm leading-6 text-foreground-muted">{challenge.description}</p>

            <div className="mt-6 rounded-2xl border border-border bg-surface-raised p-5">
              <h2 className="font-display text-sm font-semibold text-foreground">Your goal</h2>
              <p className="mt-1 font-body text-sm leading-6 text-foreground">{challenge.goal}</p>
            </div>

            {challenge.constraints.length > 0 && (
              <div className="mt-4 rounded-2xl border border-border bg-surface-raised p-5">
                <h2 className="font-display text-sm font-semibold text-foreground">Constraints</h2>
                <ul className="mt-2 space-y-1.5">
                  {challenge.constraints.map((constraint, index) => (
                    <li key={index} className="flex items-start gap-2 font-body text-sm text-foreground-muted">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
                      {constraint}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-6 rounded-2xl border border-border bg-surface-raised p-4">
              <h2 className="mb-3 font-display text-sm font-semibold text-foreground">Starting layout</h2>
              <DesignPreview design={challenge.starting_design} className="max-w-sm rounded-xl border border-border" />
            </div>

            {startError && (
              <p className="mt-4 font-body text-xs font-medium text-red-500">{startError}</p>
            )}

            <button
              type="button"
              onClick={() => void run()}
              disabled={pending}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 font-body text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? <Spinner size={18} className="text-white" /> : <Swords size={18} />}
              {pending ? "Starting…" : "Start challenge"}
            </button>
            <p className="mt-2 font-body text-xs text-foreground-subtle">
              The timer starts the moment you press start.
            </p>
          </div>

          <div className="hidden md:block">
            <DesignPreview
              design={challenge.starting_design}
              className="rounded-2xl border border-border shadow-sm"
            />
          </div>
        </div>
      </div>
    );
  }

  // ── Submitted → waiting for opponent ─────────────────────────────────────
  if (phase === "waiting") {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/10">
          <Swords size={26} className="text-accent" />
        </div>
        <h1 className="mt-5 font-display text-xl font-semibold text-foreground">
          Design submitted!
        </h1>
        <p className="mt-2 max-w-sm font-body text-sm leading-6 text-foreground-muted">
          {waitingFor
            ? "Looking for another designer to duel with. We'll take you there when a match is found."
            : "No opponent matched yet. Check back soon — new duels appear as other designers finish."}
        </p>
        <div className="mt-6 flex items-center gap-2">
          {waitingFor && <Spinner size={18} className="text-foreground-muted" />}
          <span className="font-body text-xs text-foreground-subtle">
            {waitingFor ? "Matching…" : "Keep browsing"}
          </span>
        </div>
        {!waitingFor && (
          <button
            type="button"
            onClick={() => router.push("/dashboard/design-duel")}
            className="mt-4 rounded-xl border border-border px-5 py-2.5 font-body text-sm font-semibold text-foreground hover:bg-surface-raised"
          >
            Back to Design Duel
          </button>
        )}
      </div>
    );
  }

  // ── Duel ready (came back after a match was found) ───────────────────────
  if (phase === "duel" && myDuel) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
          <Swords size={26} className="text-emerald-600" />
        </div>
        <h1 className="mt-5 font-display text-xl font-semibold text-foreground">Duel found!</h1>
        <p className="mt-2 max-w-sm font-body text-sm text-foreground-muted">
          Your design is going head-to-head against another designer&apos;s work.
        </p>
        <button
          type="button"
          onClick={() => router.push(`/dashboard/design-duel/duels/${myDuel.id}`)}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 font-body text-base font-semibold text-white hover:opacity-90"
        >
          <Swords size={18} />
          View your duel
        </button>
      </div>
    );
  }

  // ── Editor ───────────────────────────────────────────────────────────────
  if (phase === "editor" && submissionId && deadline) {
    return (
      <div className="flex h-full min-h-[calc(100vh-3rem)] flex-col">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <button
            type="button"
            onClick={() => {
              if (confirm("Leave the editor? Your unsaved design will be kept on your submission.")) {
                router.push("/dashboard/design-duel");
              }
            }}
            className="inline-flex items-center gap-1 font-body text-xs text-foreground-muted hover:text-foreground"
          >
            <ArrowLeft size={14} /> Exit
          </button>
        </div>
        <DuelEditor
          challenge={challenge}
          submissionId={submissionId}
          deadline={deadline}
          initialDesign={submission?.design_json ?? challenge.starting_design}
          onSubmitted={handleSubmitted}
        />
      </div>
    );
  }

  // Fallback → intro
  return null;
}