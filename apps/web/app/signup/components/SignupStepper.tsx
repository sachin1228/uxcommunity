"use client";

import { ArrowLeft } from "lucide-react";

const TOTAL_STEPS = 3;

interface SignupStepperProps {
  /** Currently visible step (1–3). */
  current: 1 | 2 | 3;
}

/**
 * LinkedIn-style progress bar: a slim track at the top of the signup card,
 * spanning the card's width, with an accent fill proportional to progress.
 */
export function SignupStepper({ current }: SignupStepperProps) {
  const pct = Math.min(100, (current / TOTAL_STEPS) * 100);

  return (
    <div
      role="progressbar"
      aria-label="Signup progress"
      aria-valuemin={1}
      aria-valuemax={TOTAL_STEPS}
      aria-valuenow={current}
      className="mb-8 h-1 w-full overflow-hidden rounded-full bg-border"
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Shared back affordance for steps 2 and 3. */
export function SignupBackButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 font-body text-sm text-foreground-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
    >
      <ArrowLeft size={15} strokeWidth={2.5} aria-hidden="true" />
      Back
    </button>
  );
}
