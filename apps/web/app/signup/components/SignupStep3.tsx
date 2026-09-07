"use client";
import { Button } from "@/components/ui/shadcn/button";


import { Spinner } from "@/components/ui/Spinner";
import { MAX_DESIGN_INTERESTS } from "@/lib/interests";
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
    <div className="p-8">
      <h2 className="font-display text-2xl font-semibold text-foreground mb-1">
        What are your design interests?
      </h2>
      <p className="font-body text-sm text-muted-foreground mb-1">Step 3 of 4</p>
      <p className="font-body text-xs text-muted-foreground mb-7">
        Pick up to {MAX_DESIGN_INTERESTS} topics you care about most. You can always update these later.
      </p>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 mb-5">
          <p className="font-body text-sm text-red-500 dark:text-red-400">{error}</p>
        </div>
      )}

      <div className="mb-6">
        <InterestsMultiSelect options={options} selected={selected} onChange={onChange} />
      </div>

      <Button variant="default"
        type="button"
        onClick={onContinue}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 py-2.5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading && <Spinner className="h-4 w-4 text-white" />}
        {loading ? "Saving…" : "Continue →"}
      </Button>
    </div>
  );
}
