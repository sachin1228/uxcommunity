"use client";

import { ArrowLeft } from "lucide-react";

/** The three signup steps, in order. */
const STEPS = [
  { n: 1, label: "Account" },
  { n: 2, label: "Profile" },
  { n: 3, label: "Picture" },
] as const;

interface SignupStepperProps {
  /** Currently visible step (1–3). */
  current: 1 | 2 | 3;
  /** Clicking a completed step returns to it (only steps before the current one are clickable). */
  onStepClick?: (step: 1 | 2 | 3) => void;
}

function StepDot({ state }: { state: "done" | "active" | "upcoming" }) {
  if (state === "done") {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
            clipRule="evenodd"
          />
        </svg>
      </span>
    );
  }
  const active = state === "active";
  return (
    <span
      aria-hidden="true"
      className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 font-body text-xs font-semibold tabular-nums transition-colors ${
        active
          ? "border-accent bg-accent text-accent-foreground"
          : "border-border bg-transparent text-foreground-muted"
      }`}
    >
      {active ? "•" : ""}
    </span>
  );
}

export function SignupStepper({ current, onStepClick }: SignupStepperProps) {
  return (
    <ol className="mb-6 flex w-full items-center" aria-label="Signup progress">
      {STEPS.map((step, i) => {
        const state = step.n < current ? "done" : step.n === current ? "active" : "upcoming";
        const clickable = Boolean(onStepClick) && step.n < current;

        return (
          <li
            key={step.n}
            className={`flex min-w-0 items-center ${i < STEPS.length - 1 ? "flex-1" : ""}`}
          >
            <button
              type="button"
              onClick={clickable ? () => onStepClick?.(step.n) : undefined}
              disabled={!clickable}
              aria-current={step.n === current ? "step" : undefined}
              aria-label={`${step.label} step${clickable ? " — go back" : ""}`}
              title={clickable ? `Back to ${step.label}` : undefined}
              className={`flex min-w-0 items-center gap-2 rounded-md py-1 pr-2 text-left ${
                clickable ? "cursor-pointer transition-opacity hover:opacity-80" : "cursor-default"
              }`}
            >
              <StepDot state={state} />
              <span
                className={`hidden truncate font-body text-xs font-medium sm:block ${
                  state === "active"
                    ? "text-foreground"
                    : state === "done"
                      ? "text-foreground-muted"
                      : "text-foreground-subtle"
                }`}
              >
                {step.label}
              </span>
            </button>

            {i < STEPS.length - 1 && (
              <span
                aria-hidden="true"
                className={`mx-1 h-px flex-1 transition-colors sm:mx-2 ${
                  step.n < current ? "bg-accent" : "bg-border"
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
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
