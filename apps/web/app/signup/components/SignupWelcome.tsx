"use client";

import { Spinner } from "@/components/ui/Spinner";
import { BrandLogo } from "@/components/ui/BrandLogo";

export type WelcomeStepStatus = "pending" | "active" | "done";

export interface WelcomeStep {
  id: string;
  label: string;
  status: WelcomeStepStatus;
}

interface SignupWelcomeProps {
  phase: "loading" | "ready" | "error";
  firstName?: string;
  joinedCommunities?: number;
  errorMessage?: string | null;
  /** Real progress (0-100) derived from completed server-side steps. */
  percent?: number;
  /** Real step states driven by each request finishing. */
  steps?: WelcomeStep[];
  onGoToDashboard: () => void;
  onRetry: () => void;
  onClose: () => void;
}

const RING_SIZE = 132;
const RING_STROKE = 6;
const RADIUS = (RING_SIZE - RING_STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Presentational only — percent and step states are updated by the parent as
// each real server step (picture upload → account creation → community
// auto-join) completes. Nothing here is simulated.
function LoadingPhase({
  firstName,
  percent,
  steps,
}: {
  firstName?: string;
  percent: number;
  steps: WelcomeStep[];
}) {
  const dashOffset = CIRCUMFERENCE * (1 - percent / 100);

  return (
    <div className="flex w-full max-w-sm flex-col items-center animate-in fade-in duration-300">
      <div className="relative">
        <svg width={RING_SIZE} height={RING_SIZE} className="-rotate-90">
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth={RING_STROKE}
          />
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            className="transition-[stroke-dashoffset] duration-300 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-display text-2xl font-semibold text-foreground tabular-nums">
            {Math.round(percent)}%
          </span>
        </div>
      </div>

      <h1 className="mt-8 font-display text-2xl font-semibold text-foreground">
        Welcome{firstName ? `, ${firstName}` : ""}!
      </h1>
      <p className="mt-1.5 text-center font-body text-sm text-foreground-muted">
        Setting up your account — this is happening live, step by step.
      </p>

      <ul className="mt-8 w-full space-y-3">
        {steps.map((step) => (
          <li
            key={step.id}
            className={`flex items-center gap-3 rounded-lg border px-4 py-2.5 transition-colors ${
              step.status === "done"
                ? "border-border/60 bg-surface"
                : "border-transparent bg-transparent"
            }`}
          >
            {step.status === "done" ? (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>
            ) : step.status === "active" ? (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                <Spinner className="h-4 w-4" />
              </span>
            ) : (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                <span className="h-2 w-2 rounded-full bg-foreground-subtle/50" />
              </span>
            )}
            <span
              className={`font-body text-sm transition-colors ${
                step.status === "done" || step.status === "active"
                  ? "text-foreground"
                  : "text-foreground-subtle"
              }`}
            >
              {step.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReadyPhase({
  firstName,
  joinedCommunities,
  onGoToDashboard,
}: {
  firstName?: string;
  joinedCommunities?: number;
  onGoToDashboard: () => void;
}) {
  return (
    <div className="flex w-full max-w-sm flex-col items-center animate-in fade-in zoom-in-95 duration-300">
      <div className="relative">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-lg">
          <svg className="h-9 w-9" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <span className="absolute -right-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full bg-surface-raised text-base shadow animate-in fade-in zoom-in-95 duration-200">
          🎉
        </span>
      </div>

      <h1 className="mt-8 text-center font-display text-3xl font-semibold text-foreground">
        You&apos;re all set{firstName ? `, ${firstName}` : ""}!
      </h1>
      <p className="mt-2 text-center font-body text-sm text-foreground-muted">
        {typeof joinedCommunities === "number" && joinedCommunities > 0 ? (
          <>
            Your account is ready and you&apos;ve been added to{" "}
            <span className="font-medium text-foreground">
              {joinedCommunities === 1 ? "1 community" : `${joinedCommunities} communities`}
            </span>{" "}
            — your city, sector and interests are all waiting for you.
          </>
        ) : (
          "Your account is ready. Let's get you inside!"
        )}
      </p>

      <button
        type="button"
        onClick={onGoToDashboard}
        className="mt-8 w-full rounded-md bg-accent py-3 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
      >
        Go to Dashboard →
      </button>
    </div>
  );
}

function ErrorPhase({
  errorMessage,
  onRetry,
  onClose,
}: {
  errorMessage?: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex w-full max-w-sm flex-col items-center animate-in fade-in zoom-in-95 duration-300">
      <div className="flex h-16 w-16 items-center justify-center rounded-full border border-red-500/40 bg-red-500/10">
        <svg
          className="h-7 w-7 text-red-500 dark:text-red-400"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22Z"
            clipRule="evenodd"
          />
        </svg>
      </div>
      <h1 className="mt-6 font-display text-xl font-semibold text-foreground">
        Something went wrong
      </h1>
      <p className="mt-1.5 text-center font-body text-sm text-foreground-muted">
        {errorMessage ?? "We couldn't finish setting up your account. Please try again."}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-7 w-full rounded-md bg-accent py-3 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
      >
        Try Again
      </button>
      <button
        type="button"
        onClick={onClose}
        className="mt-3 font-body text-sm text-foreground-muted transition-colors hover:text-foreground"
      >
        Go back
      </button>
    </div>
  );
}

export function SignupWelcome({
  phase,
  firstName,
  joinedCommunities,
  errorMessage,
  percent,
  steps,
  onGoToDashboard,
  onRetry,
  onClose,
}: SignupWelcomeProps) {
  return (
    <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-background px-6">
      <BrandLogo
        className="fixed left-5 top-5 z-20"
        iconClassName="h-6 w-6"
        wordmarkClassName="text-lg"
      />

      {phase === "loading" && (
        <LoadingPhase firstName={firstName} percent={percent ?? 0} steps={steps ?? []} />
      )}
      {phase === "ready" && (
        <ReadyPhase
          firstName={firstName}
          joinedCommunities={joinedCommunities}
          onGoToDashboard={onGoToDashboard}
        />
      )}
      {phase === "error" && (
        <ErrorPhase errorMessage={errorMessage} onRetry={onRetry} onClose={onClose} />
      )}
    </div>
  );
}
