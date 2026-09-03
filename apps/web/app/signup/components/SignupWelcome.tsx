"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { BrandLogo } from "@/components/ui/BrandLogo";

interface SignupWelcomeProps {
  phase: "loading" | "ready" | "error";
  firstName?: string;
  joinedCommunities?: number;
  errorMessage?: string | null;
  onGoToDashboard: () => void;
  onRetry: () => void;
  onClose: () => void;
}

const STEPS = [
  { at: 10, label: "Creating your account" },
  { at: 30, label: "Adding your profile details" },
  { at: 55, label: "Joining your communities" },
  { at: 80, label: "Preparing your dashboard" },
];

const RING_SIZE = 132;
const RING_STROKE = 6;
const RADIUS = (RING_SIZE - RING_STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function currentStepIndex(progress: number): number {
  let index = -1;
  for (let i = 0; i < STEPS.length; i++) {
    if (progress >= STEPS[i].at) index = i;
  }
  return index;
}

// Fake but believable progress: it rushes through the early steps, then
// crawls toward 92% while the real setup request is still in flight.
function LoadingPhase({ firstName }: { firstName?: string }) {
  const [progress, setProgress] = useState(4);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setProgress((prev) => {
        if (prev >= 92) return prev;
        const remaining = 92 - prev;
        const step = Math.max(
          1,
          Math.min(7, Math.round(remaining / 14) + (Math.random() > 0.7 ? 2 : 0))
        );
        return Math.min(92, prev + step);
      });
    }, 130);
    return () => window.clearInterval(timer);
  }, []);

  const stepIndex = currentStepIndex(progress);
  const dashOffset = CIRCUMFERENCE * (1 - progress / 100);

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
            className="transition-[stroke-dashoffset] duration-200 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-display text-2xl font-semibold text-foreground tabular-nums">
            {Math.round(progress)}%
          </span>
        </div>
      </div>

      <h1 className="mt-8 font-display text-2xl font-semibold text-foreground">
        Welcome{firstName ? `, ${firstName}` : ""}!
      </h1>
      <p className="mt-1.5 text-center font-body text-sm text-foreground-muted">
        Setting everything up for you — this will only take a moment.
      </p>

      <ul className="mt-8 w-full space-y-3">
        {STEPS.map((step, i) => {
          const done = progress >= step.at;
          const active = i === stepIndex && progress < 92;
          return (
            <li
              key={step.label}
              className={`flex items-center gap-3 rounded-lg border px-4 py-2.5 transition-colors ${
                done ? "border-border/60 bg-surface" : "border-transparent bg-transparent"
              }`}
            >
              {done ? (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </span>
              ) : active ? (
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
                  done || active ? "text-foreground" : "text-foreground-subtle"
                }`}
              >
                {step.label}
              </span>
            </li>
          );
        })}
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

      {phase === "loading" && <LoadingPhase firstName={firstName} />}
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