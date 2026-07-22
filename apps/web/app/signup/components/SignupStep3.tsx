"use client";

import { Spinner } from "@/components/ui/Spinner";
import { InterestsMultiSelect } from "./InterestsMultiSelect";

interface InterestOption { id: string; name: string; image_url?: string | null }

interface SignupStep3Props {
  options: InterestOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  loading: boolean;
  error: string | null;
  onContinue: () => void;
}

export function SignupStep3({
  options,
  selected,
  onChange,
  loading,
  error,
  onContinue,
}: SignupStep3Props) {
  return (
    <div className="rounded-xl border border-overlay-elevated bg-overlay-raised p-8 shadow-xl">
      <h2 className="font-display text-2xl font-semibold text-overlay-foreground mb-1">
        What are your design interests?
      </h2>
      <p className="font-body text-sm text-overlay-muted mb-1">Step 3 of 4</p>
      <p className="font-body text-xs text-overlay-muted mb-7">
        Pick the topics you care about most. You can always update these later.
      </p>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 mb-5">
          <p className="font-body text-sm text-red-400">{error}</p>
        </div>
      )}

      <div className="mb-6">
        <InterestsMultiSelect options={options} selected={selected} onChange={onChange} />
      </div>

      <button
        type="button"
        onClick={onContinue}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 rounded-md bg-accent py-2.5 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading && <Spinner className="h-4 w-4 text-white" />}
        {loading ? "Saving…" : "Continue →"}
      </button>
    </div>
  );
}
